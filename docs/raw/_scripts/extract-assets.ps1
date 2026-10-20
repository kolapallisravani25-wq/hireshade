$ErrorActionPreference = 'Continue'
$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
$ProgressPreference='SilentlyContinue'
$set = New-Object System.Collections.Generic.SortedSet[string]
Get-ChildItem docs\raw\pages\*.html | ForEach-Object {
  $txt = Get-Content $_.FullName -Raw
  $ms = [regex]::Matches($txt, '/_next/static/[A-Za-z0-9_\-./%]+?\.(?:js|css|woff2?)')
  foreach ($m in $ms) { [void]$set.Add($m.Value) }
}
Write-Host ('unique static assets referenced: ' + $set.Count)
$set | Set-Content -Encoding utf8 docs\raw\probes\static-asset-urls.txt
Write-Host '--- sample ---'
$set | Select-Object -First 15 | ForEach-Object { Write-Host $_ }
Write-Host '--- js count ---'
($set | Where-Object { $_ -like '*.js' }).Count
Write-Host '--- css count ---'
($set | Where-Object { $_ -like '*.css' }).Count
Write-Host '--- font count ---'
($set | Where-Object { $_ -like '*.woff*' }).Count