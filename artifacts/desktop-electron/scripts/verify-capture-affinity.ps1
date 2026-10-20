Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class WinEnum {
    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lp);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern uint GetWindowDisplayAffinity(IntPtr hWnd, out uint aff);

    public static List<string> ForPids(int[] pids) {
        var pset = new HashSet<uint>();
        foreach (var p in pids) pset.Add((uint)p);
        var results = new List<string>();
        EnumWindows((hWnd, lp) => {
            uint wpid; GetWindowThreadProcessId(hWnd, out wpid);
            if (pset.Contains(wpid)) {
                var sb = new StringBuilder(256);
                GetWindowText(hWnd, sb, 256);
                var title = sb.ToString();
                if (title.Length > 0) {
                    bool vis = IsWindowVisible(hWnd);
                    uint aff; GetWindowDisplayAffinity(hWnd, out aff);
                    results.Add(String.Format("HWND={0} pid={1} visible={2} aff=0x{3:X} title={4}", hWnd, wpid, vis, aff, title));
                }
            }
            return true;
        }, IntPtr.Zero);
        return results;
    }
}
"@

$electronPids = (Get-Process electron -ErrorAction SilentlyContinue).Id
if (-not $electronPids) { Write-Output "NO_ELECTRON_PROCESS"; exit 1 }
Write-Output ("Electron PIDs: " + ($electronPids -join ','))
[WinEnum]::ForPids([int[]]$electronPids) | ForEach-Object { Write-Output $_ }
