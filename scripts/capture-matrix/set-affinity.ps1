param(
  [Parameter(Mandatory = $true)][string]$Affinity,
  [string]$Title = "Floating Mini-Screen",
  [int[]]$Pids = @(),
  [string]$OutFile = "",
  [switch]$Restore
)

# S1: set GetWindowDisplayAffinity on the overlay HWND from OUTSIDE the app.
# Accepts 0x00 / 0x01 / 0x11 or none/monitor/exclude/restore.
Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public class O2SetAffinity {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint affinity);
    [DllImport("user32.dll")] public static extern uint GetWindowDisplayAffinity(IntPtr hWnd, out uint affinity);

    public class Result {
        public List<long> hwnds = new List<long>();
        public List<string> titles = new List<string>();
        public bool ok;
        public uint requested;
        public List<uint> applied = new List<uint>();
        public List<uint> readback = new List<uint>();
        public List<int> lastError = new List<int>();
        public int matched = 0;
    }

    public static Result Apply(string wantedTitle, int[] pids, uint affinity) {
        var set = new HashSet<uint>();
        foreach (var p in pids) set.Add((uint)p);
        var result = new Result();
        result.requested = affinity;
        EnumWindows((hWnd, lParam) => {
            uint wpid;
            GetWindowThreadProcessId(hWnd, out wpid);
            if (set.Count > 0 && !set.Contains(wpid)) return true;
            var sb = new StringBuilder(512);
            GetWindowText(hWnd, sb, 512);
            var title = sb.ToString();
            bool wildcard = string.IsNullOrEmpty(wantedTitle) || wantedTitle == "*";
            if (!wildcard && title.IndexOf(wantedTitle, StringComparison.OrdinalIgnoreCase) < 0) return true;
            if (!IsWindowVisible(hWnd)) return true;
            if (title.StartsWith("Default IME", StringComparison.OrdinalIgnoreCase) ||
                title.StartsWith("MSCTFIME", StringComparison.OrdinalIgnoreCase) ||
                title.Length == 0) return true;
            result.matched += 1;
            result.hwnds.Add(hWnd.ToInt64());
            result.titles.Add(title);
            bool ok = SetWindowDisplayAffinity(hWnd, affinity);
            int err = System.Runtime.InteropServices.Marshal.GetLastWin32Error();
            result.applied.Add(ok ? 1u : 0u);
            result.lastError.Add(err);
            uint readback;
            GetWindowDisplayAffinity(hWnd, out readback);
            result.readback.Add(readback);
            return true;
        }, IntPtr.Zero);
        result.ok = result.matched > 0;
        for (int i = 0; i < result.readback.Count; i++) {
            if (result.readback[i] != affinity) result.ok = false;
        }
        return result;
    }
}
"@

$value = $Affinity.Trim().ToLowerInvariant()
$mode = switch ($value) {
    "none" { 0 }
    "0x00" { 0 }
    "0" { 0 }
    "monitor" { 1 }
    "0x01" { 1 }
    "1" { 1 }
    "exclude" { 17 }
    "0x11" { 17 }
    "17" { 17 }
    "restore" { 17 }
    default { throw "unknown affinity: $Affinity" }
}
if ($Restore) { $mode = 17 }
$result = [O2SetAffinity]::Apply($Title, $Pids, [uint32]$mode)
$matching = @()
for ($i = 0; $i -lt $result.matched; $i++) {
    $matching += [ordered]@{
        hwnd = ("0x{0:X}" -f $result.hwnds[$i])
        title = $result.titles[$i]
        requested = ("0x{0:X}" -f $result.requested)
        applied_ok = ($result.applied[$i] -eq 1)
        readback = ("0x{0:X}" -f $result.readback[$i])
        last_error = $result.lastError[$i]
    }
}
$payload = [ordered]@{
    captured_at = (Get-Date).ToString("o")
    method = "user32.SetWindowDisplayAffinity on the live overlay HWND (external S1 experiment)"
    title_filter = $Title
    requested = ("0x{0:X}" -f $result.requested)
    matched = $result.matched
    matching = $matching
    ok = $result.ok
    last_error_codes = @($result.lastError)
}
$json = $payload | ConvertTo-Json -Depth 6
if ($OutFile) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $OutFile) | Out-Null
    $json | Set-Content -Path $OutFile -Encoding UTF8
}
Write-Output $json
exit 0
