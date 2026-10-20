param(
  [Parameter(Mandatory = $true)][string]$A,
  [Parameter(Mandatory = $true)][string]$B,
  [string]$OutFile = "",
  [int]$Threshold = 16,
  [string]$Label = ""
)

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing @"
using System;
using System.Drawing;
using System.Drawing.Imaging;

public class O2DiffResult {
    public int width;
    public int height;
    public double mean_abs_diff;
    public double fraction_diff_gt_threshold;
    public double mean_diff_where_changed;
    public string diff_path;
}

public class O2Diff {
    public static O2DiffResult Compare(string aPath, string bPath, int threshold, string diffPath) {
        using (var a = new Bitmap(aPath))
        using (var b = new Bitmap(bPath)) {
            int w = Math.Min(a.Width, b.Width);
            int h = Math.Min(a.Height, b.Height);
            long sum = 0;
            long changed = 0;
            long changedSum = 0;
            using (var heat = diffPath != null ? new Bitmap(w, h) : null) {
                for (int y = 0; y < h; y++) {
                    for (int x = 0; x < w; x++) {
                        Color ca = a.GetPixel(x, y);
                        Color cb = b.GetPixel(x, y);
                        int dr = Math.Abs(ca.R - cb.R);
                        int dg = Math.Abs(ca.G - cb.G);
                        int db = Math.Abs(ca.B - cb.B);
                        int maxd = Math.Max(dr, Math.Max(dg, db));
                        sum += (dr + dg + db) / 3;
                        if (maxd > threshold) { changed++; changedSum += maxd; }
                        if (heat != null) {
                            int v = Math.Min(255, maxd * 4);
                            heat.SetPixel(x, y, Color.FromArgb(255, v, v, v));
                        }
                    }
                }
                if (heat != null) heat.Save(diffPath, ImageFormat.Png);
            }
            long pixels = (long)w * h;
            var result = new O2DiffResult();
            result.width = w; result.height = h;
            result.mean_abs_diff = pixels > 0 ? (double)sum / pixels : 0;
            result.fraction_diff_gt_threshold = pixels > 0 ? (double)changed / pixels : 0;
            result.mean_diff_where_changed = changed > 0 ? (double)changedSum / changed : 0;
            result.diff_path = diffPath;
            return result;
        }
    }
}
"@

if (-not (Test-Path $A)) { Write-Output ('{"error":"MISSING_A","path":"' + $A + '"}'); exit 0 }
if (-not (Test-Path $B)) { Write-Output ('{"error":"MISSING_B","path":"' + $B + '"}'); exit 0 }
$diffPath = $null
if ($OutFile) {
    $diffDir = Split-Path -Parent $OutFile
    if ($diffDir) { New-Item -ItemType Directory -Force -Path $diffDir | Out-Null }
    $diffPath = [System.IO.Path]::ChangeExtension($OutFile, ".png")
}
$result = [O2Diff]::Compare((Resolve-Path $A).Path, (Resolve-Path $B).Path, $Threshold, $diffPath)
$payload = [ordered]@{
    captured_at = (Get-Date).ToString("o")
    label = $Label
    a = $A
    b = $B
    threshold = $Threshold
    width = $result.width
    height = $result.height
    mean_abs_diff = [Math]::Round($result.mean_abs_diff, 3)
    fraction_diff_gt_threshold = [Math]::Round($result.fraction_diff_gt_threshold, 5)
    mean_diff_where_changed = [Math]::Round($result.mean_diff_where_changed, 2)
    diff_path = $result.diff_path
}
$json = $payload | ConvertTo-Json -Depth 6
if ($OutFile) { $json | Set-Content -Path $OutFile -Encoding UTF8 }
Write-Output $json
exit 0
