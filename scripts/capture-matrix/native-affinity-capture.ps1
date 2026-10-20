param([string]$OutDir = "docs/evidence/capture-sprint")
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$repo = (Resolve-Path ".").Path
$electron = Join-Path $repo "artifacts\desktop-electron\node_modules\electron\dist\electron.exe"
$desktop = Join-Path $repo "artifacts\desktop-electron"
$out = Join-Path $repo $OutDir
New-Item -ItemType Directory -Force -Path $out | Out-Null
$results = @()

function Get-WindowRect([string]$jsonPath) {
  $j = Get-Content $jsonPath -Raw | ConvertFrom-Json
  $w = $j.windows | Where-Object { $_.title -eq "Floating Mini-Screen" -and $_.visible } | Select-Object -First 1
  return $w
}

foreach ($mode in @("0x00","0x01","0x11")) {
  Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Milliseconds 1200
  $env:HIRESHADE_AFFINITY_MODE = $mode
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  Start-Process -FilePath $electron -ArgumentList "." -WorkingDirectory $desktop | Out-Null
  Start-Sleep -Seconds 9
  $aff = Join-Path $out ("native-" + $mode + "-affinity.json")
  & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $repo "scripts\capture-matrix\affinity.ps1") -Expect $mode -OutFile $aff -Note ("native " + $mode) | Out-Null
  $win = Get-WindowRect $aff
  $mp4 = Join-Path $out ("native-" + $mode + "-dxgi.mp4")
  $png = Join-Path $out ("native-" + $mode + "-dxgi-frame.png")
  & ffmpeg -hide_banner -loglevel error -y -f lavfi -i "ddagrab=0:framerate=10" -t 1 -vf "hwdownload,format=bgra" $mp4 2>$null
  & ffmpeg -hide_banner -loglevel error -y -i $mp4 -frames:v 1 $png 2>$null
  $stats = $null
  if ($win) {
    $bmp = [System.Drawing.Bitmap]::FromFile($png)
    $rect = New-Object System.Drawing.Rectangle([int]$win.bounds.x, [int]$win.bounds.y, [int]$win.bounds.width, [int]$win.bounds.height)
    $rect.Intersect((New-Object System.Drawing.Rectangle(0,0,$bmp.Width,$bmp.Height)))
    $crop = $bmp.Clone($rect, $bmp.PixelFormat)
    $dark = 0; $sum = 0; $n = 0
    for ($y = 0; $y -lt $crop.Height; $y += 4) {
      for ($x = 0; $x -lt $crop.Width; $x += 4) {
        $c = $crop.GetPixel($x, $y)
        $l = 0.2126*$c.R + 0.7152*$c.G + 0.0722*$c.B
        $sum += $l; $n++
        if ($l -lt 16) { $dark++ }
      }
    }
    $stats = [ordered]@{ meanLuma = [math]::Round($sum / [math]::Max(1,$n),2); blackFraction = [math]::Round($dark / [math]::Max(1,$n),4); sampled = $n; width = $crop.Width; height = $crop.Height }
    $crop.Save((Join-Path $out ("native-" + $mode + "-crop.png")), [System.Drawing.Imaging.ImageFormat]::Png)
    $crop.Dispose(); $bmp.Dispose()
  }
  $results += [ordered]@{ mode = $mode; affinity = $(if ($win) { $win.affinity } else { "missing" }); bounds = $(if ($win) { $win.bounds } else { $null }); dxgiCrop = $stats }
  Write-Output ("[" + $mode + "] affinity=" + $(if ($win) { $win.affinity } else { "missing" }) + " dxgi=" + ($stats | ConvertTo-Json -Compress))
}
Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force
[ordered]@{ generatedAt = (Get-Date).ToString("o"); method = "native HIRESHADE_AFFINITY_MODE per launch; ddagrab DXGI frame cropped to the Floating window rect; mean luma / black fraction"; results = $results } | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $out "native-affinity-dxgi.json") -Encoding UTF8
