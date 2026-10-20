$files = @(
 'docs\raw\desktop\mac-unpacked\ParakeetAI.app\Contents\Resources\app.asar',
 'docs\raw\desktop\asar-extracted\dist\main\main.js',
 'docs\raw\desktop\asar-extracted\dist\main\preload.js',
 'docs\raw\desktop\asar-extracted\dist\main\mic-monitor-worker.js',
 'docs\raw\desktop\asar-extracted\dist\renderer\renderer.js',
 'docs\raw\desktop\mac-unpacked\ParakeetAI.app\Contents\Info.plist',
 'docs\raw\desktop\latest.yml',
 'docs\raw\desktop\latest-mac.yml',
 'docs\raw\desktop\mac-unpacked\ParakeetAI.app\Contents\Resources\app-update.yml',
 'docs\raw\desktop\ParakeetAI-3.9.126-universal-mac.zip',
 'docs\raw\desktop\mac-unpacked\ParakeetAI.app\Contents\Resources\app.asar.unpacked\dist\main\parakeetai-native.win32-x64-msvc.node',
 'docs\raw\desktop\mac-unpacked\ParakeetAI.app\Contents\Resources\app.asar.unpacked\dist\main\parakeetai-native.darwin-arm64.node',
 'docs\raw\probes\trpc-latestRelease.json',
 'docs\raw\probes\trpc-billing.getPrices.json'
)
$rows = @('| file | bytes | sha256 |','|---|---|---|')
foreach ($f in $files) {
  if (Test-Path $f) {
    $i = Get-Item $f
    $h = (Get-FileHash $f -Algorithm SHA256).Hash.ToLower()
    $rows += ('| ' + ($f -replace 'docs\\raw\\','') + ' | ' + $i.Length + ' | ' + $h + ' |')
  } else { $rows += ('| ' + $f + ' | MISSING | - |') }
}
$rows | Set-Content -Encoding utf8 docs\rea-evidence\artifact-hashes.md
$rows | ForEach-Object { Write-Host $_ }