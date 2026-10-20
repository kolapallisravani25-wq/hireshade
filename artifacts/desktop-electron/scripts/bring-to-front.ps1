param([string[]]$Titles = @("Floating Mini-Screen","Launcher"))
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public class FrontWin {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  public static int Raise(int pid, string title) {
    int raised = 0;
    EnumWindows((hWnd, lp) => {
      uint wpid; GetWindowThreadProcessId(hWnd, out wpid);
      if (wpid == (uint)pid && IsWindowVisible(hWnd)) {
        var sb = new StringBuilder(256); GetWindowText(hWnd, sb, 256);
        if (sb.ToString() == title) {
          SetWindowPos(hWnd, new IntPtr(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0040); // HWND_TOPMOST, NOSIZE|NOMOVE|SHOWWINDOW
          SetForegroundWindow(hWnd);
          raised++;
        }
      }
      return true;
    }, IntPtr.Zero);
    return raised;
  }
}
"@
$pids = (Get-Process electron -ErrorAction SilentlyContinue).Id
if (-not $pids) { Write-Output "NO_ELECTRON_PROCESS"; exit 1 }
foreach ($title in $Titles) { foreach ($p in $pids) { $n = [FrontWin]::Raise($p, $title); if ($n -gt 0) { Write-Output "raised '$title' in pid $p" } } }
Start-Sleep -Milliseconds 800
