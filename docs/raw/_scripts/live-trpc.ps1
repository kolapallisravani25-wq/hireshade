$ProgressPreference='SilentlyContinue'
$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
$base = 'https://www.parakeet-ai.com'
$uPrice = '/api/trpc/billing.getPrices?batch=1&input=%7B%220%22%3A%7B%22json%22%3A%7B%22code%22%3Anull%7D%2C%22meta%22%3A%7B%22values%22%3A%7B%22code%22%3A%5B%22undefined%22%5D%7D%2C%22v%22%3A1%7D%7D%7D'
$uRel = '/api/trpc/configuration.getLatestRelease,billing.getPrices?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%2C%22meta%22%3A%7B%22values%22%3A%5B%22undefined%22%5D%2C%22v%22%3A1%7D%7D%2C%221%22%3A%7B%22json%22%3A%7B%22code%22%3Anull%7D%2C%22meta%22%3A%7B%22values%22%3A%7B%22code%22%3A%5B%22undefined%22%5D%7D%2C%22v%22%3A1%7D%7D%7D'
Write-Host '=== LIVE billing.getPrices ==='
$code = curl.exe -sS -A $UA --max-time 40 -D docs\raw\headers\trpc-billing.headers.txt -o docs\raw\probes\trpc-billing.getPrices.json -w '%{http_code}|%{size_download}|%{content_type}' ($base + $uPrice)
Write-Host $code
Get-Content docs\raw\probes\trpc-billing.getPrices.json -Raw
Write-Host ''
Write-Host '=== LIVE configuration.getLatestRelease ==='
$code = curl.exe -sS -A $UA --max-time 40 -D docs\raw\headers\trpc-release.headers.txt -o docs\raw\probes\trpc-latestRelease.json -w '%{http_code}|%{size_download}|%{content_type}' ($base + $uRel)
Write-Host $code
Get-Content docs\raw\probes\trpc-latestRelease.json -Raw
Write-Host ''
Write-Host '=== LIVE user.getCountryCode ==='
curl.exe -sS -A $UA --max-time 30 -o docs\raw\probes\trpc-countrycode.json -w 'code=%{http_code} size=%{size_download}' ($base + '/api/trpc/user.getCountryCode?batch=1&input=%7B%220%22%3A%7B%22json%22%3Anull%2C%22meta%22%3A%7B%22values%22%3A%5B%22undefined%22%5D%7D%7D%7D')
Write-Host ''
Get-Content docs\raw\probes\trpc-countrycode.json -Raw