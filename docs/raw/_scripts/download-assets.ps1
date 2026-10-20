$ErrorActionPreference = 'Continue'
$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
$ProgressPreference='SilentlyContinue'
$urls = Get-Content docs\raw\probes\static-asset-urls.txt
$log = @()
$i = 0
foreach ($u in $urls) {
  if ([string]::IsNullOrWhiteSpace($u)) { continue }
  $i++
  $name = ($u -replace '^/_next/static/immutable/','') -replace '[\\/:*?"<>|]','_'
  $dest = 'docs\raw\assets\' + $name
  $res = curl.exe -sS -A $UA --max-time 45 -o $dest -w '%{http_code}|%{size_download}' ('https://www.parakeet-ai.com' + $u)
  $log += ('{0}|{1}|{2}' -f $u, $res, $name)
  Write-Host ('{0} -> {1}' -f $u, $res)
}
$log | Set-Content -Encoding utf8 docs\raw\probes\asset-download-log.txt
Write-Host '--- total ---'
Get-ChildItem docs\raw\assets | Measure-Object -Property Length -Sum | ForEach-Object { Write-Host ('files=' + $_.Count + ' bytes=' + $_.Sum) }