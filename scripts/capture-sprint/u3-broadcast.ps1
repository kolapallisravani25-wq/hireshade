param(
  [int]$LogPixels = 144,
  [int]$Win8DpiScaling = 1,
  [switch]$Broadcast,
  [switch]$ReadOnly
)
$ErrorActionPreference = 'Continue'
$src = @'
using System;
using System.Runtime.InteropServices;
public class U3Broadcast {
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint msg, UIntPtr wParam, string lParam, uint flags, uint timeout, out UIntPtr result);
}
'@
Add-Type -TypeDefinition $src -Language CSharp | Out-Null
if (-not $ReadOnly) {
  reg add 'HKCU\Control Panel\Desktop' /v LogPixels /t REG_DWORD /d $LogPixels /f | Out-Null
  reg add 'HKCU\Control Panel\Desktop' /v Win8DpiScaling /t REG_DWORD /d $Win8DpiScaling /f | Out-Null
}
$broadcasts = @()
if ($Broadcast) {
  foreach ($section in @('Display', 'WindowMetrics')) {
    $result = [UIntPtr]::Zero
    $ok = [U3Broadcast]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, $section, 2, 2000, [ref]$result)
    $broadcasts += [pscustomobject]@{ section = $section; sent = ($ok -ne [IntPtr]::Zero); result = $result.ToString() }
  }
}
$logPixelsNow = (Get-ItemProperty 'HKCU:\Control Panel\Desktop' -Name LogPixels -ErrorAction SilentlyContinue).LogPixels
$win8Now = (Get-ItemProperty 'HKCU:\Control Panel\Desktop' -Name Win8DpiScaling -ErrorAction SilentlyContinue).Win8DpiScaling
Write-Output (ConvertTo-Json @{ ok = $true; logPixels = $logPixelsNow; win8DpiScaling = $win8Now; broadcasts = $broadcasts } -Compress -Depth 5)
