$UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
Write-Host '=== unauthenticated API probes (expect 401/403) ==='
foreach ($p in @('/api/chat','/api/callSession/transcript','/api/company-logo?domain=google.com','/api/trpc/callSession.create')) {
  $n = ($p -replace '[\\/:*?"<>|?=&]','_')
  $code = curl.exe -sS -A $UA --max-time 25 -X POST -H 'content-type: application/json' -d '{"messages":[]}' -D ("docs\raw\headers\probe" + $n + ".headers.txt") -o ("docs\raw\probes\probe" + $n + ".txt") -w '%{http_code}|%{size_download}|%{content_type}' ('https://www.parakeet-ai.com' + $p)
  Write-Host ('POST {0} -> {1}' -f $p, $code)
}
Write-Host '=== GET /api/chat ==='
curl.exe -sS -A $UA --max-time 20 -o NUL -w 'GET /api/chat -> %{http_code}`n' https://www.parakeet-ai.com/api/chat
Write-Host '=== bodies ==='
Get-Content 'docs\raw\probes\probe_api_chat.txt' -Raw
Write-Host ''
Get-Content 'docs\raw\probes\probe_api_callSession_transcript.txt' -Raw
Write-Host ''
Write-Host '=== company-logo headers ==='
Get-Content 'docs\raw\headers\probe_api_company-logo_domain_google.com.headers.txt' | Select-Object -First 12