param(
  [Parameter(Mandatory = $true)][string]$Baseline,
  [Parameter(Mandatory = $true)][string]$On,
  [Parameter(Mandatory = $true)][string]$OutDir,
  [Parameter(Mandatory = $true)][string]$Label,
  [int]$Zoom = 6,
  [int]$Threshold = 12,
  [int]$BandPx = 8
)

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing @"
using System;
using System.Drawing;
using System.Drawing.Imaging;

public class O2ZoomResult {
    public int width;
    public int height;
    public double edge1_fraction;
    public double edge2_fraction;
    public double edge4_fraction;
    public double edge8_fraction;
    public double interior_fraction;
    public int max_diff;
    public double max_diff_edge1;
    public double max_diff_interior;
    public int contiguous_band_left;
    public int contiguous_band_right;
    public int contiguous_band_top;
    public int contiguous_band_bottom;
    public string filenames;
}

public class O2Zoom {
    static int MaxDiff(Color a, Color b) {
        return Math.Max(Math.Abs(a.R - b.R), Math.Max(Math.Abs(a.G - b.G), Math.Abs(a.B - b.B)));
    }

    static Rectangle EdgeRect(string edge, int w, int h, int thickness) {
        switch (edge) {
            case "top": return new Rectangle(0, 0, w, Math.Min(thickness, h));
            case "bottom": return new Rectangle(0, Math.Max(0, h - thickness), w, Math.Min(thickness, h));
            case "left": return new Rectangle(0, 0, Math.Min(thickness, w), h);
            case "right": return new Rectangle(Math.Max(0, w - thickness), 0, Math.Min(thickness, w), h);
            default: return new Rectangle(0, 0, w, h);
        }
    }

    static double FractionChanged(Bitmap a, Bitmap b, Rectangle rect, int threshold) {
        long changed = 0; long total = 0;
        for (int y = rect.Top; y < rect.Bottom; y++) {
            for (int x = rect.Left; x < rect.Right; x++) {
                total++;
                if (MaxDiff(a.GetPixel(x, y), b.GetPixel(x, y)) > threshold) changed++;
            }
        }
        return total > 0 ? (double)changed / total : 0;
    }

    static int BandWidth(Bitmap a, Bitmap b, string edge, int threshold, int maxBand) {
        int w = Math.Min(a.Width, b.Width);
        int h = Math.Min(a.Height, b.Height);
        int band = 0;
        for (int step = 0; step < maxBand; step++) {
            bool any = false;
            if (edge == "left" || edge == "right") {
                int x = edge == "left" ? step : w - 1 - step;
                for (int y = 0; y < h && !any; y++) {
                    if (MaxDiff(a.GetPixel(x, y), b.GetPixel(x, y)) > threshold) any = true;
                }
            } else {
                int y = edge == "top" ? step : h - 1 - step;
                for (int x = 0; x < w && !any; x++) {
                    if (MaxDiff(a.GetPixel(x, y), b.GetPixel(x, y)) > threshold) any = true;
                }
            }
            if (any) band = step + 1; else break;
        }
        return band;
    }

    public static O2ZoomResult Analyze(string aPath, string bPath, string outDir, string label, int zoom, int threshold, int bandPx) {
        using (var a = new Bitmap(aPath))
        using (var b = new Bitmap(bPath)) {
            int w = Math.Min(a.Width, b.Width);
            int h = Math.Min(a.Height, b.Height);
            var r = new O2ZoomResult();
            r.width = w; r.height = h;
            r.edge1_fraction = FractionChanged(a, b, EdgeRect("top", w, h, 1), threshold);
            r.edge2_fraction = FractionChanged(a, b, EdgeRect("top", w, h, 2), threshold);
            r.edge4_fraction = FractionChanged(a, b, EdgeRect("top", w, h, 4), threshold);
            r.edge8_fraction = FractionChanged(a, b, EdgeRect("top", w, h, 8), threshold);
            var interior = new Rectangle(8, 8, Math.Max(1, w - 16), Math.Max(1, h - 16));
            r.interior_fraction = FractionChanged(a, b, interior, threshold);
            int maxDiff = 0; double edgeMax = 0; double interiorMax = 0;
            for (int y = 0; y < h; y++) {
                for (int x = 0; x < w; x++) {
                    int d = MaxDiff(a.GetPixel(x, y), b.GetPixel(x, y));
                    if (d > maxDiff) maxDiff = d;
                    if ((x < 2 || y < 2 || x >= w - 2 || y >= h - 2) && d > edgeMax) edgeMax = d;
                    if (x >= 8 && y >= 8 && x < w - 8 && y < h - 8 && d > interiorMax) interiorMax = d;
                }
            }
            r.max_diff = maxDiff;
            r.max_diff_edge1 = edgeMax;
            r.max_diff_interior = interiorMax;
            r.contiguous_band_left = BandWidth(a, b, "left", threshold, bandPx);
            r.contiguous_band_right = BandWidth(a, b, "right", threshold, bandPx);
            r.contiguous_band_top = BandWidth(a, b, "top", threshold, bandPx);
            r.contiguous_band_bottom = BandWidth(a, b, "bottom", threshold, bandPx);

            // Zoomed montages: baseline strip / current strip / diff strip.
            var files = new System.Collections.Generic.List<string>();
            foreach (var edge in new string[] { "top", "bottom", "left", "right" }) {
                int thickness = 10;
                Rectangle rect = EdgeRect(edge, w, h, thickness);
                int stripW = rect.Width; int stripH = rect.Height;
                bool horizontal = edge == "top" || edge == "bottom";
                int canvasW = horizontal ? stripW : stripW * 3;
                int canvasH = horizontal ? stripH * 3 : stripH;
                using (var canvas = new Bitmap(canvasW * zoom, canvasH * zoom))
                using (var g = Graphics.FromImage(canvas)) {
                    g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.NearestNeighbor;
                    g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.Half;
                    Bitmap[] sources = new Bitmap[] { a, b, null };
                    for (int i = 0; i < 3; i++) {
                        using (var strip = new Bitmap(stripW, stripH))
                        using (var sg = Graphics.FromImage(strip)) {
                            if (i < 2) sg.DrawImage(sources[i], new Rectangle(0, 0, stripW, stripH), rect, GraphicsUnit.Pixel);
                            else {
                                for (int y = 0; y < stripH; y++) {
                                    for (int x = 0; x < stripW; x++) {
                                        int d = MaxDiff(a.GetPixel(rect.Left + x, rect.Top + y), b.GetPixel(rect.Left + x, rect.Top + y));
                                        int v = Math.Min(255, d * 4);
                                        strip.SetPixel(x, y, Color.FromArgb(255, v, v, v));
                                    }
                                }
                            }
                            int destX = horizontal ? 0 : i * stripW * zoom;
                            int destY = horizontal ? i * stripH * zoom : 0;
                            g.DrawImage(strip, new Rectangle(destX, destY, stripW * zoom, stripH * zoom));
                        }
                    }
                    var file = System.IO.Path.Combine(outDir, "zoom-" + label + "-" + edge + ".png");
                    canvas.Save(file, ImageFormat.Png);
                    files.Add(file);
                }
            }
            // Top-left corner (40x40) montage.
            int cs = Math.Min(40, Math.Min(w, h));
            using (var canvas = new Bitmap(cs * zoom * 3, cs * zoom))
            using (var g = Graphics.FromImage(canvas)) {
                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.NearestNeighbor;
                g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.Half;
                for (int i = 0; i < 3; i++) {
                    using (var piece = new Bitmap(cs, cs)) {
                        for (int y = 0; y < cs; y++) {
                            for (int x = 0; x < cs; x++) {
                                if (i == 0) piece.SetPixel(x, y, a.GetPixel(x, y));
                                else if (i == 1) piece.SetPixel(x, y, b.GetPixel(x, y));
                                else {
                                    int d = MaxDiff(a.GetPixel(x, y), b.GetPixel(x, y));
                                    int v = Math.Min(255, d * 4);
                                    piece.SetPixel(x, y, Color.FromArgb(255, v, v, v));
                                }
                            }
                        }
                        g.DrawImage(piece, new Rectangle(i * cs * zoom, 0, cs * zoom, cs * zoom));
                    }
                }
                var file = System.IO.Path.Combine(outDir, "zoom-" + label + "-corner-topleft.png");
                canvas.Save(file, ImageFormat.Png);
                files.Add(file);
            }
            r.filenames = string.Join(";", files);
            return r;
        }
    }
}
"@

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$result = [O2Zoom]::Analyze((Resolve-Path $Baseline).Path, (Resolve-Path $On).Path, $OutDir, $Label, $Zoom, $Threshold, $BandPx)
$maxBand = [Math]::Max([Math]::Max($result.contiguous_band_left, $result.contiguous_band_right), [Math]::Max($result.contiguous_band_top, $result.contiguous_band_bottom))
$classification = "INCONCLUSIVE"
if ($result.interior_fraction -le 0.0005 -and $result.edge1_fraction -ge 0.3 -and $result.edge4_fraction -le 0.05 -and $maxBand -le 2 -and $result.max_diff_edge1 -le 80) {
    $classification = "BORDER_ANTIALIASING_OR_EDGE_SUBSAMPLING (changed pixels confined to the outer 1-2 px; no interior change)"
} elseif ($maxBand -ge 3 -or ($result.edge4_fraction -gt 0.05 -and $result.edge4_fraction -lt 0.9)) {
    $classification = "VISIBLE_EDGE_BAND (changed pixels form a band of " + $maxBand + " px at the window edge)"
} elseif ($result.interior_fraction -ge 0.01) {
    $classification = "VISIBLE_CONTENT_OR_LARGE_EDGE (interior fraction " + $result.interior_fraction + ")"
}
$payload = [ordered]@{
    captured_at = (Get-Date).ToString("o")
    label = $Label
    baseline = $Baseline
    on = $On
    method = "Per-edge pixel-ring analysis (threshold " + $Threshold + ") of the GDI ON-vs-baseline crops; zoomed montages baseline|ON|diff saved for manual review"
    size = @{ width = $result.width; height = $result.height }
    fractions = [ordered]@{
        edge_ring_1px = [Math]::Round($result.edge1_fraction, 5)
        edge_ring_2px = [Math]::Round($result.edge2_fraction, 5)
        edge_ring_4px = [Math]::Round($result.edge4_fraction, 5)
        edge_ring_8px = [Math]::Round($result.edge8_fraction, 5)
        interior_8px_inset = [Math]::Round($result.interior_fraction, 5)
    }
    max_diff = $result.max_diff
    max_diff_edge_2px = [Math]::Round($result.max_diff_edge1, 2)
    max_diff_interior = [Math]::Round($result.max_diff_interior, 2)
    contiguous_band_px = [ordered]@{
        left = $result.contiguous_band_left
        right = $result.contiguous_band_right
        top = $result.contiguous_band_top
        bottom = $result.contiguous_band_bottom
        max = $maxBand
    }
    classification = $classification
    zoomed_images = $result.filenames
}
$json = $payload | ConvertTo-Json -Depth 6
$json | Set-Content -Path (Join-Path $OutDir ("zoom-" + $Label + ".json")) -Encoding UTF8
Write-Output $json
exit 0
