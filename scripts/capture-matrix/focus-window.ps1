param(
  [int[]]$Pids = @(),
  [string]$Title = "Floating",
  [string]$OutFile = ""
)
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class V1Focus {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr GetWindowLongPtrW(IntPtr hWnd, int index);
    public class Result { public long hwnd; public string title; public bool visible; public bool foreground; public bool topmost; }
    public static Result Apply(int[] pids, string wanted) {
        var set = new HashSet<uint>(); foreach (var p in pids) set.Add((uint)p);
        var result = new Result();
        EnumWindows((hWnd, lParam) => {
            uint pid; GetWindowThreadProcessId(hWnd, out pid);
            if (set.Count > 0 && !set.Contains(pid)) return true;
            var sb = new StringBuilder(512); GetWindowText(hWnd, sb, 512);
            if (sb.ToString().IndexOf(wanted, StringComparison.OrdinalIgnoreCase) < 0) return true;
            ShowWindow(hWnd, 5); // SW_SHOW
            // HWND_TOPMOST = -1, SWP_NOMOVE|SWP_NOSIZE = 0x0002|0x0001
            SetWindowPos(hWnd, new IntPtr(-1), 0, 0, 0, 0, 0x0003);
            SetForegroundWindow(hWnd);
            long ex = GetWindowLongPtrW(hWnd, -20).ToInt64();
            result.hwnd = hWnd.ToInt64(); result.title = sb.ToString();
            result.visible = IsWindowVisible(hWnd);
            result.foreground = GetForegroundWindow() == hWnd;
            result.topmost = (ex & 0x8L) != 0;
            return false;
        }, IntPtr.Zero);
        return result;
    }
}
"@
$r = [V1Focus]::Apply([int[]]$Pids, $Title)
$payload = [ordered]@{
    captured_at = (Get-Date).ToString("o")
    method = "user32 ShowWindow(SW_SHOW)+SetWindowPos(HWND_TOPMOST)+SetForegroundWindow"
    matched = ($r.hwnd -ne 0)
    window = if ($r.hwnd -ne 0) { [ordered]@{ hwnd = ("0x{0:X}" -f $r.hwnd); title = $r.title; visible = $r.visible; foreground = $r.foreground; topmost = $r.topmost } } else { $null }
}
$json = $payload | ConvertTo-Json -Depth 5
if ($OutFile) { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutFile) | Out-Null; $json | Set-Content -Path $OutFile -Encoding UTF8 }
Write-Output $json
exit 0
