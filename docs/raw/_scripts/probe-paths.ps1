
$ErrorActionPreference = 'Continue'
$UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
$ProgressPreference='SilentlyContinue'
[xml]$sm = Get-Content docs\raw\pages\sitemap.xml -Raw
$sitemapUrls = @($sm.urlset.url | ForEach-Object { $_.loc })
Write-Host ("sitemap URL count: " + $sitemapUrls.Count)
$requested = @('/pricing','/how-it-works','/features','/mock-interview','/blog','/terms','/privacy','/faq','/login','/signup','/sign-in','/register','/dashboard','/app','/download','/desktop','/refund','/refund-policy','/cookies','/security','/changelog','/about','/contact','/affiliate','/students','/careers')
$lines = @()
foreach ($p in $requested) {
  $code = curl.exe -sS -A $UA -o NUL -w "%{http_code}|%{size_download}|%{redirect_url}" ("https://www.parakeet-ai.com" + $p)
  $line = ("{0}|{1}" -f $p, $code)
  $lines += $line
  Write-Host $line
}
$lines | Set-Content -Encoding utf8 docs\raw\probes\requested-paths.txt
$sitemapUrls | Set-Content -Encoding utf8 docs\raw\probes\sitemap-urls.txt
Write-Host ("saved sitemap-urls: " + $sitemapUrls.Count)
