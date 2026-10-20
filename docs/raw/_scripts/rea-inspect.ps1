rea inspect-artifact 'docs\raw\desktop\ParakeetAI-3.9.126-universal-mac.zip' --format json 2> docs\rea-evidence\rea-inspect-artifact.stderr.txt > docs\rea-evidence\rea-inspect-artifact.json
Write-Host ('inspect exit=' + $LASTEXITCODE)
if (Test-Path docs\rea-evidence\rea-inspect-artifact.json) { Get-Item docs\rea-evidence\rea-inspect-artifact.json | Select-Object Length | Format-List }
Write-Host '=== try evidence-export ==='
rea evidence-export docs\rea-evidence\rea-inspect-artifact.json docs\rea-evidence\evidence-bundle.json --overwrite 2>&1 | Select-Object -First 12
Write-Host ('export exit=' + $LASTEXITCODE)
Write-Host '=== head of inspect ==='
$j = Get-Content docs\rea-evidence\rea-inspect-artifact.json -Raw -ErrorAction SilentlyContinue
if ($j) { Write-Host $j.Substring(0,[Math]::Min(800,$j.Length)) }