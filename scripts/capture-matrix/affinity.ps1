param(
  [string]$OutFile = "",
  [string]$Expect = "0x11",
  [string[]]$Titles = @("Floating Mini-Screen", "HireShade Floating Screen", "Launcher", "HireShade"),
  [int[]]$Pids = @(),
  [string]$Note = ""
)

# O2: enumerate Electron top-level windows and report GetWindowDisplayAffinity.
# Exit code is always 0; callers read the JSON "pass" field.
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class O2Affinity {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowDisplayAffinity(IntPtr hWnd, out uint aff);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    public class WinInfo {
        public long hwnd;
        public int pid;
        public string title;
        public bool visible;
        public uint affinity;
        public int left;
        public int top;
        public int right;
        public int bottom;
    }

    public static List<WinInfo> ForPids(int[] pids) {
        var set = new HashSet<uint>();
        foreach (var pid in pids) set.Add((uint)pid);
        var results = new List<WinInfo>();
        EnumWindows((hWnd, lParam) => {
            uint wpid;
            GetWindowThreadProcessId(hWnd, out wpid);
            if (set.Contains(wpid)) {
                var sb = new StringBuilder(512);
                GetWindowText(hWnd, sb, 512);
                var title = sb.ToString();
                if (title.Length > 0) {
                    RECT r;
                    GetWindowRect(hWnd, out r);
                    uint aff;
                    GetWindowDisplayAffinity(hWnd, out aff);
                    results.Add(new WinInfo {
                        hwnd = hWnd.ToInt64(),
                        pid = (int)wpid,
                        title = title,
                        visible = IsWindowVisible(hWnd),
                        affinity = aff,
                        left = r.Left,
                        top = r.Top,
                        right = r.Right,
                        bottom = r.Bottom
                    });
                }
            }
            return true;
        }, IntPtr.Zero);
        return results;
    }
}
"@

if ($Pids.Count -gt 0) {
    # Scoped to the app under test: shared desktops can run other Electron apps
    # whose window titles would otherwise be matched accidentally.
    $electronPids = @($Pids)
} else {
    $electronPids = @(Get-Process electron -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
}
if ($electronPids.Count -eq 0) {
    $payload = [ordered]@{
        captured_at = (Get-Date).ToString("o")
        expect      = $Expect
        note        = $Note
        error       = "NO_ELECTRON_PROCESS"
        windows     = @()
        matching    = @()
        pass        = $false
    }
    $json = $payload | ConvertTo-Json -Depth 6
    if ($OutFile) { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutFile) | Out-Null; $json | Set-Content -Path $OutFile -Encoding UTF8 }
    Write-Output $json
    exit 0
}

$all = @([O2Affinity]::ForPids([int[]]$electronPids))
$matching = @()
foreach ($winner in $all) {
    $isMatch = $false
    foreach ($title in $Titles) {
        if ($winner.title -eq $title -or $winner.title -like ("*" + $title + "*")) { $isMatch = $true; break }
    }
    if ($isMatch) {
        $affHex = "0x{0:X}" -f $winner.affinity
        $ok = $true
        if ($Expect -ne "any") { $ok = ($affHex -eq $Expect) }
        $matching += [ordered]@{
            title    = $winner.title
            hwnd     = ("0x{0:X}" -f $winner.hwnd)
            pid      = $winner.pid
            visible  = $winner.visible
            affinity = $affHex
            bounds   = @{ x = $winner.left; y = $winner.top; width = ($winner.right - $winner.left); height = ($winner.bottom - $winner.top) }
            expected = $Expect
            pass     = $ok
        }
    }
}

$visibleMatches = @($matching | Where-Object { $_.visible })
$pass = ($visibleMatches.Count -gt 0) -and (@($visibleMatches | Where-Object { -not $_.pass }).Count -eq 0)
$payload = [ordered]@{
    captured_at = (Get-Date).ToString("o")
    expect      = $Expect
    note        = $Note
    electron_pids = $electronPids
    windows     = @($all | ForEach-Object {
        [ordered]@{
            title    = $_.title
            hwnd     = ("0x{0:X}" -f $_.hwnd)
            pid      = $_.pid
            visible  = $_.visible
            affinity = ("0x{0:X}" -f $_.affinity)
            bounds   = @{ x = $_.left; y = $_.top; width = ($_.right - $_.left); height = ($_.bottom - $_.top) }
        }
    })
    matching    = $matching
    pass        = $pass
}
$json = $payload | ConvertTo-Json -Depth 6
if ($OutFile) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutFile) | Out-Null
    $json | Set-Content -Path $OutFile -Encoding UTF8
}
Write-Output $json
exit 0
