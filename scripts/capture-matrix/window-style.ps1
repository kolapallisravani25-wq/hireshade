param(
  [int[]]$Pids = @(),
  [string]$Title = "Floating Mini-Screen",
  [string]$OutFile = ""
)
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class U2WindowStyle {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtrW(IntPtr hWnd, int index);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] public static extern uint GetWindowDisplayAffinity(IntPtr hWnd, out uint affinity);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr hWnd, int attr, out int value, int size);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    public class Info {
        public long hwnd; public int pid; public string title; public bool visible;
        public long style; public long exstyle; public bool layered; public uint affinity;
        public int left; public int top; public int width; public int height;
        public int cloaked; public bool dwmComposition;
    }
    public static List<Info> ForPids(int[] pids, string wanted) {
        var set = new HashSet<uint>();
        foreach (var p in pids) set.Add((uint)p);
        var list = new List<Info>();
        EnumWindows((hWnd, lParam) => {
            uint pid; GetWindowThreadProcessId(hWnd, out pid);
            if (set.Count > 0 && !set.Contains(pid)) return true;
            var sb = new StringBuilder(512); GetWindowText(hWnd, sb, 512);
            var title = sb.ToString();
            if (wanted.Length > 0 && title.IndexOf(wanted, StringComparison.OrdinalIgnoreCase) < 0) return true;
            RECT r; GetWindowRect(hWnd, out r);
            var info = new Info();
            info.hwnd = hWnd.ToInt64(); info.pid = (int)pid; info.title = title; info.visible = IsWindowVisible(hWnd);
            info.style = GetWindowLongPtrW(hWnd, -16).ToInt64();
            info.exstyle = GetWindowLongPtrW(hWnd, -20).ToInt64();
            info.layered = (info.exstyle & 0x80000L) != 0; // WS_EX_LAYERED
            uint aff; GetWindowDisplayAffinity(hWnd, out aff); info.affinity = aff;
            info.left = r.Left; info.top = r.Top; info.width = r.Right - r.Left; info.height = r.Bottom - r.Top;
            int cloaked = 0; DwmGetWindowAttribute(hWnd, 14, out cloaked, 4); info.cloaked = cloaked;
            int comp = 0; try { DwmGetWindowAttribute(hWnd, 1, out comp, 4); } catch { comp = 0; } info.dwmComposition = comp != 0;
            list.Add(info);
            return true;
        }, IntPtr.Zero);
        return list;
    }
}
"@
$all = @([U2WindowStyle]::ForPids([int[]]$Pids, $Title))
$windows = @()
foreach ($w in $all) {
    $windows += [ordered]@{
        title = $w.title
        hwnd = ("0x{0:X}" -f $w.hwnd)
        pid = $w.pid
        visible = $w.visible
        style = ("0x{0:X}" -f $w.style)
        exstyle = ("0x{0:X}" -f $w.exstyle)
        WS_EX_LAYERED = $w.layered
        affinity = ("0x{0:X}" -f $w.affinity)
        bounds = @{ x = $w.left; y = $w.top; width = $w.width; height = $w.height }
        DWM_cloaked = $w.cloaked
        DWM_composition = $w.dwmComposition
    }
}
$payload = [ordered]@{
    captured_at = (Get-Date).ToString("o")
    method = "user32 GetWindowLongPtr(GWL_EXSTYLE) + GetWindowDisplayAffinity + DwmGetWindowAttribute"
    layered_means_transparent_surface = $true
    windows = $windows
}
$json = $payload | ConvertTo-Json -Depth 6
if ($OutFile) { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutFile) | Out-Null; $json | Set-Content -Path $OutFile -Encoding UTF8 }
Write-Output $json
exit 0
