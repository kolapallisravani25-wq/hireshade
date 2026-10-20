param(
    [string]$OutDir = "docs/evidence/stealth"
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class StealthWin {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lp);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowDisplayAffinity(IntPtr hWnd, out uint aff);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    public static List<WinInfo> ForPids(int[] pids) {
        var pset = new HashSet<uint>();
        foreach (var p in pids) pset.Add((uint)p);
        var results = new List<WinInfo>();
        EnumWindows((hWnd, lp) => {
            uint wpid; GetWindowThreadProcessId(hWnd, out wpid);
            if (pset.Contains(wpid)) {
                var sb = new StringBuilder(256); GetWindowText(hWnd, sb, 256);
                var title = sb.ToString();
                if (title.Length > 0) {
                    RECT r; GetWindowRect(hWnd, out r);
                    uint aff; GetWindowDisplayAffinity(hWnd, out aff);
                    results.Add(new WinInfo { Hwnd = hWnd.ToInt64(), Pid = (int)wpid, Visible = IsWindowVisible(hWnd), Affinity = aff, Title = title, Left = r.Left, Top = r.Top, Right = r.Right, Bottom = r.Bottom });
                }
            }
            return true;
        }, IntPtr.Zero);
        return results;
    }
    public class WinInfo { public long Hwnd; public int Pid; public bool Visible; public uint Affinity; public string Title; public int Left; public int Top; public int Right; public int Bottom; }
}
"@

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$pids = (Get-Process electron -ErrorAction SilentlyContinue).Id
if (-not $pids) { Write-Output "NO_ELECTRON_PROCESS"; exit 1 }
$wins = [StealthWin]::ForPids([int[]]$pids) | Where-Object { $_.Visible -and $_.Title -in @('Floating Mini-Screen','Launcher','HireShade Floating Screen','HireShade') }
if (-not $wins) { Write-Output "NO_MATCHING_WINDOW"; exit 1 }

$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
$bmp = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Left, $bounds.Top, 0, 0, $bmp.Size)
$fullPath = Join-Path $OutDir ("desktop-capture-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".png")
$bmp.Save($fullPath, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()

$results = @()
foreach ($w in $wins) {
    $x = [Math]::Max($w.Left - $bounds.Left, 0); $y = [Math]::Max($w.Top - $bounds.Top, 0)
    $wd = [Math]::Min($w.Right - $w.Left, $bounds.Width - $x); $ht = [Math]::Min($w.Bottom - $w.Top, $bounds.Height - $y)
    if ($wd -le 0 -or $ht -le 0) { continue }
    $crop = New-Object System.Drawing.Bitmap($wd, $ht)
    $cg = [System.Drawing.Graphics]::FromImage($crop)
    $cg.DrawImage($bmp, (New-Object System.Drawing.Rectangle(0,0,$wd,$ht)), (New-Object System.Drawing.Rectangle($x,$y,$wd,$ht)), [System.Drawing.GraphicsUnit]::Pixel)
    $cg.Dispose()
    $cropPath = Join-Path $OutDir ("window-region-" + ($w.Title -replace '[^A-Za-z0-9]+','-') + "-" + (Get-Date -Format "HHmmss") + ".png")
    $crop.Save($cropPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $results += [ordered]@{ title = $w.Title; hwnd = ("0x{0:X}" -f $w.Hwnd); pid = $w.Pid; affinity = ("0x{0:X}" -f $w.Affinity); rect = @{ left=$w.Left; top=$w.Top; right=$w.Right; bottom=$w.Bottom }; capture_region = $cropPath }
}
$bmp.Dispose()

$payload = [ordered]@{
    captured_at = (Get-Date).ToString("o")
    screen = @{ left=$bounds.Left; top=$bounds.Top; width=$bounds.Width; height=$bounds.Height }
    full_capture = $fullPath
    windows = $results
    note = "WDA_EXCLUDEFROMCAPTURE (0x11) windows should be absent from the captured pixels while still visible on the physical desktop."
}
$json = $payload | ConvertTo-Json -Depth 6
$jsonPath = Join-Path $OutDir "capture-proof.json"
[System.IO.File]::WriteAllText($jsonPath, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Output $json
