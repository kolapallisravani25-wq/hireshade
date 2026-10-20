$ErrorActionPreference = 'Continue'
$UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
$ProgressPreference='SilentlyContinue'
Write-Host '=== wildcard DNS check ==='
foreach ($t in @('zzz-not-real-12345.parakeet-ai.com','random-sub-9876.parakeet-ai.com')) {
  try { $r = Resolve-DnsName -Name $t -Type A -ErrorAction Stop -DnsOnly | Where-Object {$_.IPAddress} | Select-Object -First 1; Write-Host ('{0} -> {1}' -f $t, $r.IPAddress) } catch { Write-Host ('{0} -> NXDOMAIN' -f $t) }
}
Write-Host '=== auth/api GET probes ==='
$paths = @('/auth/signin','/auth/error','/auth/signout','/api/auth/providers','/api/auth/session','/api/auth/csrf','/api/auth/callback/credentials','/api/health','/api/healthz','/api/me','/api/user','/api/config','/api/credits','/api/sessions','/api/calls','/api/trpc')
foreach ($p in $paths) {
  $f = 'docs\raw\probes\api' + ($p -replace '[\\/:*?"<>|]','_') + '.txt'
  $code = curl.exe -sS -A $UA --max-time 20 -D ('docs\raw\headers\probe' + ($p -replace '[\\/:*?"<>|]','_') + '.headers.txt') -o $f -w '%{http_code}|%{size_download}|%{content_type}|%{redirect_url}' ('https://www.parakeet-ai.com' + $p)
  Write-Host ('{0}  ->  {1}' -f $p, $code)
}
Write-Host '=== auth/signin body head ==='
$h = Get-Content 'docs\raw\probes\api_auth_signin.txt' -TotalCount 1
if ($h) { Write-Host $h.Substring(0,[Math]::Min(600,$h.Length)) }
Write-Host ''
Write-Host '=== api/auth/providers body ==='
Get-Content 'docs\raw\probes\api_api_auth_providers.txt'
Write-Host '=== api/auth/session body ==='
Get-Content 'docs\raw\probes\api_api_auth_session.txt'
Write-Host '=== blog subdomain ==='
curl.exe -sS -A $UA --max-time 30 -D docs\raw\headers\blog-root.headers.txt -o docs\raw\pages\blog-root.html -w 'blog http_code=%{http_code} size=%{size_download}' https://blog.parakeet-ai.com/
Write-Host ''
Get-Content docs\raw\headers\blog-root.headers.txt
$b = Get-Content docs\raw\pages\blog-root.html -TotalCount 1
if ($b) { Write-Host $b.Substring(0,[Math]::Min(1200,$b.Length)) }