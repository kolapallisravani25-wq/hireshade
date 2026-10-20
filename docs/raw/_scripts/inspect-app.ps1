$app = 'docs\raw\desktop\mac-unpacked\ParakeetAI.app'
Write-Host '=== top ==='
Get-ChildItem $app -Force | Select-Object Name,Length,Mode | Format-Table -AutoSize
Write-Host '=== Contents ==='
Get-ChildItem "$app\Contents" -Force | Select-Object Name,Length,Mode | Format-Table -AutoSize
Write-Host '=== Contents/MacOS ==='
Get-ChildItem "$app\Contents\MacOS" -Force -ErrorAction SilentlyContinue | Select-Object Name,Length | Format-Table -AutoSize
Write-Host '=== Contents/Frameworks ==='
Get-ChildItem "$app\Contents\Frameworks" -Force -ErrorAction SilentlyContinue | Select-Object Name | Format-Table -AutoSize
Write-Host '=== Contents/Resources biggest ==='
Get-ChildItem "$app\Contents\Resources" -Force -ErrorAction SilentlyContinue | Select-Object Name,Length | Sort-Object Length -Descending | Select-Object -First 25 | Format-Table -AutoSize
Write-Host '=== Info.plist keys of interest ==='
$plist = "$app\Contents\Info.plist"
$txt = Get-Content $plist -Raw
foreach ($k in @('LSUIElement','LSBackgroundOnly','NSMicrophoneUsageDescription','NSScreenCaptureUsageDescription','NSAppleEventsUsageDescription','CFBundleIdentifier','CFBundleName','CFBundleExecutable','CFBundleShortVersionString','NSSystemAudioCaptureUsageDescription','LSMinimumSystemVersion','ElectronAsarIntegrity','NSHumanReadableCopyright')) {
  $i = $txt.IndexOf($k)
  if ($i -ge 0) { Write-Host ('[HIT] ' + $k + ' @' + $i + ' :: ' + $txt.Substring($i, [Math]::Min(260, $txt.Length-$i)).Replace([char]10,' ').Replace([char]13,' ')) } else { Write-Host ('[miss] ' + $k) }
}