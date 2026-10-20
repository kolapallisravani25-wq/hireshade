$ProgressPreference='SilentlyContinue'
$UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0.0.0 Safari/537.36'
# small manifests first
curl.exe -sS -L --max-time 60 -o docs\raw\desktop\latest.yml -w 'latest.yml code=%{http_code} size=%{size_download}' https://github.com/ParakeetAI/parakeetai-desktop-releases/releases/download/v3.9.126/latest.yml
Write-Host ''
curl.exe -sS -L --max-time 60 -o docs\raw\desktop\latest-mac.yml -w 'latest-mac.yml code=%{http_code} size=%{size_download}' https://github.com/ParakeetAI/parakeetai-desktop-releases/releases/download/v3.9.126/latest-mac.yml
Write-Host ''
Write-Host '=== latest.yml ==='
Get-Content docs\raw\desktop\latest.yml -Raw
Write-Host '=== latest-mac.yml ==='
Get-Content docs\raw\desktop\latest-mac.yml -Raw
Write-Host '=== 7z availability ==='
Get-Command 7z,7za,7zr -ErrorAction SilentlyContinue | Select-Object Name,Source | Format-Table -AutoSize
foreach ($p in @('C:\Program Files\7-Zip\7z.exe','C:\Program Files (x86)\7-Zip\7z.exe',"$env:LOCALAPPDATA\Programs\7-Zip\7z.exe")) { if (Test-Path $p) { Write-Host ('FOUND ' + $p) } }