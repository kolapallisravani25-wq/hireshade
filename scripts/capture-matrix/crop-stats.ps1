param(
  [Parameter(Mandatory = $true)][string]$In,
  [Parameter(Mandatory = $true)][string]$Rect,
  [string]$OutFile = "",
  [string]$Label = ""
)
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing @"
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Collections.Generic;
public class O2CropStats {
    public int width; public int height;
    public double mean_luma; public double std_luma;
    public int unique_colors_sampled;
    public double black_fraction;
    public double high_contrast_fraction;
    public string crop_path;
    public static O2CropStats Run(string inPath, Rectangle rect, string cropPath) {
        using (var src = new Bitmap(inPath)) {
            var safe = new Rectangle(Math.Max(0, rect.X), Math.Max(0, rect.Y), Math.Max(1, Math.Min(rect.Width, src.Width - Math.Max(0, rect.X))), Math.Max(1, Math.Min(rect.Height, src.Height - Math.Max(0, rect.Y))));
            using (var crop = src.Clone(safe, src.PixelFormat)) {
                crop.Save(cropPath, ImageFormat.Png);
                var r = new O2CropStats(); r.width = crop.Width; r.height = crop.Height; r.crop_path = cropPath;
                long sum = 0; double sumSq = 0; long black = 0; long high = 0; long sampled = 0;
                var colors = new HashSet<int>();
                int stepX = Math.Max(1, crop.Width / 500);
                int stepY = Math.Max(1, crop.Height / 500);
                for (int y = 0; y < crop.Height; y += stepY) {
                    for (int x = 0; x < crop.Width; x += stepX) {
                        Color c = crop.GetPixel(x, y);
                        int luma = (int)(0.2126 * c.R + 0.7152 * c.G + 0.0722 * c.B);
                        sum += luma; sumSq += (double)luma * luma; sampled++;
                        if (luma < 12) black++;
                        if (luma < 40 || luma > 220) high++;
                        colors.Add((c.R << 16) | (c.G << 8) | c.B);
                    }
                }
                r.mean_luma = sampled > 0 ? (double)sum / sampled : 0;
                double mean = r.mean_luma;
                r.std_luma = sampled > 0 ? Math.Sqrt(Math.Max(0, sumSq / sampled - mean * mean)) : 0;
                r.unique_colors_sampled = colors.Count;
                r.black_fraction = sampled > 0 ? (double)black / sampled : 0;
                r.high_contrast_fraction = sampled > 0 ? (double)high / sampled : 0;
                return r;
            }
        }
    }
}
"@
$parts = $Rect.Split(",")
$rect = New-Object System.Drawing.Rectangle([int]$parts[0], [int]$parts[1], [int]$parts[2], [int]$parts[3])
$cropPath = $null
$outDir = if ($OutFile) { Split-Path -Parent $OutFile } else { "" }
if ($outDir) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }
$cropPath = if ($OutFile) { [System.IO.Path]::ChangeExtension($OutFile, ".png") } else { [System.IO.Path]::ChangeExtension($In, ".crop.png") }
$result = [O2CropStats]::Run((Resolve-Path $In).Path, $rect, $cropPath)
$payload = [ordered]@{
    captured_at = (Get-Date).ToString("o")
    label = $Label
    input = $In
    rect = $Rect
    crop_path = $result.crop_path
    width = $result.width
    height = $result.height
    mean_luma = [Math]::Round($result.mean_luma, 2)
    std_luma = [Math]::Round($result.std_luma, 2)
    unique_colors_sampled = $result.unique_colors_sampled
    black_fraction = [Math]::Round($result.black_fraction, 4)
    high_contrast_fraction = [Math]::Round($result.high_contrast_fraction, 4)
}
$json = $payload | ConvertTo-Json -Depth 6
if ($OutFile) { $json | Set-Content -Path $OutFile -Encoding UTF8 }
Write-Output $json
exit 0
