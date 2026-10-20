param(
  [Parameter(Mandatory = $true)][ValidateSet("hide", "show")][string]$Action,
  [int[]]$Pids = @(),
  [string]$Title = "Floating",
  [string]$OutFile = ""
)
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public class V1ShowWindow {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
    public class Result { public List<long> hwnds = new List<long>(); public List<string> titles = new List<string>(); public int matched; }
    public static Result Apply(int[] pids, string wanted, int cmd) {
        var set = new HashSet<uint>(); foreach (var p in pids) set.Add((uint)p);
        var r = new Result();
        EnumWindows((hWnd, lParam) => {
            uint pid; GetWindowThreadProcessId(hWnd, out pid);
            if (set.Count > 0 && !set.Contains(pid)) return true;
            var sb = new StringBuilder(512); GetWindowText(hWnd, sb, 512);
            if (sb.ToString().IndexOf(wanted, StringComparison.OrdinalIgnoreCase) < 0) return true;
            r.matched++; r.hwnds.Add(hWnd.ToInt64()); r.titles.Add(sb.ToString());
            ShowWindow(hWnd, cmd);
            return true;
        }, IntPtr.Zero);
        return r;
    }
}
"@
$cmd = if ($Action -eq "hide") { 0 } else { 5 } # SW_HIDE / SW_SHOW
$result = [V1ShowWindow]::Apply([int[]]$Pids, $Title, $cmd)
$payload = [ordered]@{
    captured_at = (Get-Date).ToString("o")
    action = $Action
    matched = $result.matched
    matching = @()
    method = "user32!ShowWindow (out-of-process window visibility toggle; used only if CDP dies after hiding)"
}
for ($i = 0; $i -lt $result.matched; $i++) {
    $payload.matching += [ordered]@{ hwnd = ("0x{0:X}" -f $result.hwnds[$i]); title = $result.titles[$i] }
}
$json = $payload | ConvertTo-Json -Depth 5
if ($OutFile) { $json | Set-Content -Path $OutFile -Encoding UTF8 }
Write-Output $json
exit 0
