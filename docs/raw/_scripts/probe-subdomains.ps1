
$ErrorActionPreference = 'Continue'
$UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
$ProgressPreference='SilentlyContinue'
$subs = @('www','app','api','dashboard','docs','status','blog','cdn','auth','ws','admin','staging','dev','beta','myp','meet','download','get','assets','static','media','socket','realtime','pay','billing','login','account','help','support','feedback','community','careers','investors','partners','affiliates','mail','smtp','demo','sandbox','test','v1','v2')
$out = @()
$out += "# Subdomain enumeration - parakeet-ai.com"
$out += ""
$out += ("Observed: " + (Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK'))
$out += "UA: $UA"
$out += ""
$out += "| host | DNS | HTTP status | server | content-type | location/note |"
$out += "|---|---|---|---|---|---|"
foreach ($s in $subs) {
  $host_ = "$s.parakeet-ai.com"
  $dns = '-'
  try {
    $rec = Resolve-DnsName -Name $host_ -Type A -ErrorAction Stop -DnsOnly | Where-Object { $_.IPAddress } | Select-Object -First 2
    if ($rec) { $dns = ($rec | ForEach-Object { $_.IPAddress }) -join ',' } else { $dns = 'NO-A' }
  } catch { $dns = 'NXDOMAIN' }
  if ($dns -eq 'NXDOMAIN' -or $dns -eq 'NO-A') {
    $out += ("| {0} | {1} | - | - | - | - |" -f $host_, $dns)
    Write-Host ("{0}  {1}" -f $host_, $dns)
    continue
  }
  $hdrFile = "docs\raw\headers\sub_" + ($s) + ".headers.txt"
  $res = curl.exe -sS -I -A $UA --max-time 20 -o $hdrFile -w "%{http_code}|%{redirect_url}" ("https://" + $host_ + "/") 2>&1
  $server = (Select-String -Path $hdrFile -Pattern '^Server:' -ErrorAction SilentlyContinue | Select-Object -First 1).Line
  $ctype = (Select-String -Path $hdrFile -Pattern '^Content-Type:' -ErrorAction SilentlyContinue | Select-Object -First 1).Line
  $out += ("| {0} | {1} | {2} | {3} | {4} | {5} |" -f $host_, $dns, $res, $server, $ctype, $hdrFile)
  Write-Host ("{0}  dns={1}  {2}  {3}" -f $host_, $dns, $res, $server)
  Start-Sleep -Milliseconds 200
}
$out | Set-Content -Encoding utf8 docs\raw\subdomains.md
Get-Content docs\raw\subdomains.md | Select-Object -First 12
