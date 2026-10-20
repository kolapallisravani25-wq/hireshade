
$ErrorActionPreference = 'Continue'
$UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
$ProgressPreference='SilentlyContinue'
$urls = Get-Content docs\raw\probes\sitemap-urls.txt
$extra = @('https://www.parakeet-ai.com/dashboard/callSessions','https://www.parakeet-ai.com/404-test-nonexistent')
$all = @($urls) + $extra
$log = @()
foreach ($u in $all) {
  if ([string]::IsNullOrWhiteSpace($u)) { continue }
  $rel = $u -replace '^https?://www\.parakeet-ai\.com','' -replace '^/',''
  if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'home' }
  $name = ($rel -replace '[\\/:*?"<>|]','_') + '.html'
  $hdr = ($rel -replace '[\\/:*?"<>|]','_') + '.headers.txt'
  $res = curl.exe -sS -A $UA -L --max-redirs 5 -D ("docs\raw\headers\" + $hdr) -o ("docs\raw\pages\" + $name) -w "%{http_code}|%{size_download}|%{url_effective}" $u
  $line = ("{0}|{1}|{2}" -f $u, $res, $name)
  $log += $line
  Write-Host $line
  Start-Sleep -Milliseconds 250
}
$log | Set-Content -Encoding utf8 docs\raw\probes\page-fetch-log.txt
Write-Host '--- files ---'
Get-ChildItem docs\raw\pages | Select-Object Name,Length | Format-Table -AutoSize
