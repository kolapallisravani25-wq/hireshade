param(
  [string]$Action = 'state',
  [string]$Hwnd = '0',
  [int]$ExpectedTransparent = -1,
  [string]$ExpectedForegroundHwnd = '0',
  [int]$TimeoutMs = 3000,
  [int]$IntervalMs = 50,
  [int]$X = 0,
  [int]$Y = 0
)
$ErrorActionPreference = 'Stop'
$src = @'
using System;
using System.Text;
using System.Runtime.InteropServices;

public class U4VWin32 {
  [DllImport("user32.dll", EntryPoint = "GetWindowLongPtrW")]
  public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
  public static extern int GetWindowLong(IntPtr hWnd, int nIndex);
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetClassName(IntPtr hWnd, StringBuilder name, int maxCount);
  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);
  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, IntPtr processId);
  [DllImport("user32.dll")]
  public static extern bool AttachThreadInput(uint attach, uint attachTo, bool value);
  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr hWnd);
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")]
  public static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")]
  public static extern IntPtr GetAncestor(IntPtr hWnd, uint flags);
  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(IntPtr hWnd, IntPtr insertAfter, int x, int y, int cx, int cy, uint flags);
  public static IntPtr RootWindowAt(int x, int y) {
    POINT point = new POINT(); point.X = x; point.Y = y;
    return GetAncestor(WindowFromPoint(point), 2);
  }

  public static long ExStyle(IntPtr hWnd) {
    if (IntPtr.Size == 8) return GetWindowLongPtr(hWnd, -20).ToInt64();
    return (long)GetWindowLong(hWnd, -20);
  }
  public static string Title(IntPtr hWnd) {
    StringBuilder sb = new StringBuilder(512);
    GetWindowText(hWnd, sb, sb.Capacity);
    return sb.ToString();
  }
  public static string ClassName(IntPtr hWnd) {
    StringBuilder sb = new StringBuilder(256);
    GetClassName(hWnd, sb, sb.Capacity);
    return sb.ToString();
  }
}
'@
Add-Type -TypeDefinition $src -Language CSharp | Out-Null

$overlay = [System.IntPtr]([int64]$Hwnd)
$expectedForeground = [System.IntPtr]([int64]$ExpectedForegroundHwnd)
$WS_EX_TRANSPARENT = 0x20

function HexOf([System.IntPtr]$ptr) { return ('0x{0:X}' -f $ptr.ToInt64()) }

function Get-State {
  $exStyle = [U4VWin32]::ExStyle($overlay)
  $foreground = [U4VWin32]::GetForegroundWindow()
  $transparent = (($exStyle -band $WS_EX_TRANSPARENT) -ne 0)
  $foregroundMatches = ($ExpectedForegroundHwnd -eq '0') -or ($foreground.ToInt64() -eq $expectedForeground.ToInt64())
  $hit = [U4VWin32]::RootWindowAt($X, $Y)
  $hitMatches = ($ExpectedForegroundHwnd -eq '0') -or ($hit.ToInt64() -eq $expectedForeground.ToInt64())
  return [pscustomobject]@{
    overlayHwnd = HexOf $overlay
    overlayTitle = [U4VWin32]::Title($overlay)
    overlayClass = [U4VWin32]::ClassName($overlay)
    exStyle = ('0x{0:X}' -f $exStyle)
    wsExTransparent = [bool]$transparent
    foregroundHwnd = HexOf $foreground
    foregroundTitle = [U4VWin32]::Title($foreground)
    foregroundClass = [U4VWin32]::ClassName($foreground)
    foregroundMatches = [bool]$foregroundMatches
    hitHwnd = HexOf $hit
    hitTitle = [U4VWin32]::Title($hit)
    hitClass = [U4VWin32]::ClassName($hit)
    hitMatches = [bool]$hitMatches
  }
}

function Test-Expectations($state) {
  $transparentOk = ($ExpectedTransparent -lt 0) -or ([bool]$state.wsExTransparent -eq [bool]($ExpectedTransparent -eq 1))
  $foregroundOk = $state.foregroundMatches
  # The click point must resolve to the expected foreground window (target for
  # ON, overlay for OFF). WindowFromPoint skips the WS_EX_TRANSPARENT overlay on
  # ON, so the target is the expected hit there. This prevents clicking a foreign
  # always-on-top window that covers the point.
  $hitOk = $state.hitMatches
  return ($transparentOk -and $foregroundOk -and $hitOk)
}

if ($Action -eq 'state') {
  Write-Output (ConvertTo-Json (Get-State) -Compress)
  exit 0
}

if ($Action -eq 'forceForeground') {
  # Bring our harness window to the foreground reliably even when another app
  # owns the foreground lock: attach to the foreground thread, raise the window,
  # then detach. This is a test-harness action only.
  $startedForce = [System.Diagnostics.Stopwatch]::StartNew()
  $foreground = [U4VWin32]::GetForegroundWindow()
  $fgThread = [U4VWin32]::GetWindowThreadProcessId($foreground, [IntPtr]::Zero)
  $targetThread = [U4VWin32]::GetWindowThreadProcessId($overlay, [IntPtr]::Zero)
  $attached = $false
  try {
    if ($fgThread -ne 0 -and $targetThread -ne 0 -and $fgThread -ne $targetThread) {
      $attached = [U4VWin32]::AttachThreadInput($fgThread, $targetThread, $true)
    }
    # Raise to the very top of the topmost band before taking foreground.
    $HWND_TOPMOST = [IntPtr](-1)
    $SWP_FLAGS = 0x0001 -bor 0x0002 -bor 0x0040  # NOSIZE | NOMOVE | SHOWWINDOW
    [U4VWin32]::SetWindowPos($overlay, $HWND_TOPMOST, 0, 0, 0, 0, $SWP_FLAGS) | Out-Null
    [U4VWin32]::ShowWindow($overlay, 9) | Out-Null
    [U4VWin32]::BringWindowToTop($overlay) | Out-Null
    $setOk = [U4VWin32]::SetForegroundWindow($overlay)
    Start-Sleep -Milliseconds 150
  } finally {
    if ($attached) { [U4VWin32]::AttachThreadInput($fgThread, $targetThread, $false) | Out-Null }
  }
  Write-Output (ConvertTo-Json @{
    ok = [U4VWin32]::IsWindow($overlay)
    action = 'forceForeground'
    attached = $attached
    setForegroundWindow = $setOk
    elapsedMs = [int]$startedForce.ElapsedMilliseconds
    state = (Get-State)
  } -Compress -Depth 5)
  exit 0
}

function Raise-Expected {
  if ($ExpectedForegroundHwnd -eq '0') { return }
  # Raise OUR overlay above foreign always-on-top windows (both phases). The
  # overlay is the window whose style the test controls; for ON it is transparent
  # so the click still reaches the target beneath, and we then set foreground to
  # the expected HWND (target for ON, overlay for OFF).
  $HWND_TOPMOST = [IntPtr](-1)
  $SWP_FLAGS = 0x0001 -bor 0x0002 -bor 0x0040
  [U4VWin32]::SetWindowPos($overlay, $HWND_TOPMOST, 0, 0, 0, 0, $SWP_FLAGS) | Out-Null
  [U4VWin32]::ShowWindow($overlay, 9) | Out-Null
  [U4VWin32]::BringWindowToTop($overlay) | Out-Null
  [U4VWin32]::SetForegroundWindow($expectedForeground) | Out-Null
}

$started = [System.Diagnostics.Stopwatch]::StartNew()
$attempts = 0
$last = $null
while ($started.ElapsedMilliseconds -lt $TimeoutMs) {
  $attempts++
  $last = Get-State
  if (Test-Expectations $last) {
    if ($Action -eq 'assertAndClick') {
      # Re-verify after moving the cursor and immediately before mouse_event: a
      # competing topmost window (observed: "Launcher") may re-assert itself.
      [U4VWin32]::SetCursorPos($X, $Y) | Out-Null
      Start-Sleep -Milliseconds 15
      $preClick = Get-State
      if (-not (Test-Expectations $preClick)) {
        $last = $preClick
        Raise-Expected
        Start-Sleep -Milliseconds 20
        continue
      }
      [U4VWin32]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 60
      [U4VWin32]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
      Start-Sleep -Milliseconds 200
    }
    $stateAtClick = Get-State
    Write-Output (ConvertTo-Json @{
      ok = $true
      action = $Action
      clicked = ($Action -eq 'assertAndClick')
      elapsedMs = [int]$started.ElapsedMilliseconds
      attempts = $attempts
      point = @{ x = $X; y = $Y }
      state = $stateAtClick
      stateAtAssert = $last
    } -Compress -Depth 5)
    exit 0
  }
  # Another always-on-top window is above ours: re-raise our expected window and
  # retry within the same bounded window instead of clicking blind.
  Raise-Expected
  Start-Sleep -Milliseconds $IntervalMs
}
Write-Output (ConvertTo-Json @{
  ok = $false
  action = $Action
  clicked = $false
  elapsedMs = [int]$started.ElapsedMilliseconds
  attempts = $attempts
  expectedTransparent = $ExpectedTransparent
  expectedForegroundHwnd = ('0x{0:X}' -f $expectedForeground.ToInt64())
  point = @{ x = $X; y = $Y }
  state = $last
} -Compress -Depth 5)
exit 3
