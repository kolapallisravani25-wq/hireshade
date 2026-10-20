param(
  [Parameter(Mandatory = $true)][string]$In,
  [string]$Rect = "",
  [int]$R = 1,
  [int]$G = 254,
  [int]$B = 1,
  [int]$Tolerance = 8,
  [string]$Label = "",
  [string]$OutFile = ""
)
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing @"
using System;
using System.Drawing;
public class V1Marker {
    public static string Analyze(string path, Rectangle? rect, int r, int g, int b, int tol) {
        using (var raw = new Bitmap(path)) {
            Bitmap img = raw;
            if (rect.HasValue) {
                var safe = new Rectangle(Math.Max(0, rect.Value.X), Math.Max(0, rect.Value.Y),
                    Math.Max(1, Math.Min(rect.Value.Width, raw.Width - Math.Max(0, rect.Value.X))),
                    Math.Max(1, Math.Min(rect.Value.Height, raw.Height - Math.Max(0, rect.Value.Y))));
                img = raw.Clone(safe, raw.PixelFormat);
            }
            long matched = 0; long total = 0;
            int stepX = Math.Max(1, img.Width / 600);
            int stepY = Math.Max(1, img.Height / 600);
            for (int y = 0; y < img.Height; y += stepY) {
                for (int x = 0; x < img.Width; x += stepX) {
                    Color c = img.GetPixel(x, y);
                    total++;
                    if (Math.Abs(c.R - r) <= tol && Math.Abs(c.G - g) <= tol && Math.Abs(c.B - b) <= tol) matched++;
                }
            }
            if (rect.HasValue) img.Dispose();
            return matched + "|" + total;
        }
    }
}
"@
$rectObj = $null
if ($Rect) { $p = $Rect.Split(","); if ($p.Count -eq 4) { $rectObj = New-Object System.Drawing.Rectangle([int]$p[0],[int]$p[1],[int]$p[2],[int]$p[3]) } }
$value = [V1Marker]::Analyze((Resolve-Path $In).Path, $rectObj, $R, $G, $B, $Tolerance)
$parts = $value.Split("|")
$matched = [long]$parts[0]; $total = [long]$parts[1]
$payload = [ordered]@{
    captured_at = (Get-Date).ToString("o")
    label = $Label
    input = $In
    rect = $Rect
    marker_rgb = @($R, $G, $B)
    tolerance = $Tolerance
    matched_pixels = $matched
    sampled_pixels = $total
    fraction = if ($total -gt 0) { [Math]::Round($matched / $total, 5) } else { 0 }
    present = ($total -gt 0 -and ($matched / $total) -ge 0.2)
}
$json = $payload | ConvertTo-Json -Depth 5
if ($OutFile) { $json | Set-Content -Path $OutFile -Encoding UTF8 }
Write-Output $json
exit 0
