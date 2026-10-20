$raw = Get-Content 'docs\rea-evidence\rea-inspect-artifact.json' -Raw
$enc = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText((Join-Path (Get-Location) 'docs\rea-evidence\rea-inspect-artifact.json'), $raw, $enc)
Write-Host '=== retry evidence-export ==='
rea evidence-export 'docs\rea-evidence\rea-inspect-artifact.json' 'docs\rea-evidence\evidence-bundle.json' --overwrite 2>&1 | Select-Object -First 15
Write-Host ('export exit=' + $LASTEXITCODE)
if (Test-Path docs\rea-evidence\evidence-bundle.json) { Get-Item docs\rea-evidence\evidence-bundle.json | Select-Object Length | Format-List }
Write-Host '=== evidence ids in inspect output ==='
$ids = [regex]::Matches($raw, 'ev_[0-9a-f]{64}') | ForEach-Object { $_.Value } | Select-Object -Unique
$ids | Select-Object -First 10
Write-Host ('count=' + $ids.Count)
Write-Host '=== normalized_result keys ==='
$m = [regex]::Matches($raw, '"(inspection_id|manifest_id|digest|format|architecture|entry_count|entries|signatures|observations)"')
$m | ForEach-Object { $_.Value } | Group-Object | Select-Object Name,Count | Format-Table -AutoSize