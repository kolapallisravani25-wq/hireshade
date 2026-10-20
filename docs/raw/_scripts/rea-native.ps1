$node = 'docs\raw\desktop\mac-unpacked\ParakeetAI.app\Contents\Resources\app.asar.unpacked\dist\main\parakeetai-native.win32-x64-msvc.node'
rea analyze $node --format json 2> docs\rea-evidence\rea-analyze-native.stderr.txt > docs\rea-evidence\rea-analyze-native-win32.json
Write-Host ('analyze exit=' + $LASTEXITCODE)
Get-Item docs\rea-evidence\rea-analyze-native-win32.json | Select-Object Length | Format-List
$j = Get-Content docs\rea-evidence\rea-analyze-native-win32.json -Raw
if ($j) { Write-Host $j.Substring(0,[Math]::Min(1200,$j.Length)) }
Write-Host '=== stderr ==='
Get-Content docs\rea-evidence\rea-analyze-native.stderr.txt -Tail 6