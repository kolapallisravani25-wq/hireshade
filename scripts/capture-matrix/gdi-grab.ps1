param(
  [Parameter(Mandatory = $true)][string]$OutDir,
  [Parameter(Mandatory = $true)][string]$Label,
  [string]$Bounds = "",
  [string]$Note = ""
)

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -ReferencedAssemblies System.Drawing,System.Windows.Forms @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Windows.Forms;

public class O2GrabResult {
    public string full_path;
    public string crop_path;
    public int x;
    public int y;
    public int width;
    public int height;
    public double mean_luma;
    public double std_luma;
    public int unique_colors;
    public double high_contrast_fraction;
    public double non_black_fraction;
}

public class O2Grab {
    public static O2GrabResult Capture(string fullPath, string cropPath, int x, int y, int w, int h) {
        var screen = SystemInformation.VirtualScreen;
        using (var full = new Bitmap(screen.Width, screen.Height))
        using (var g = Graphics.FromImage(full)) {
            g.CopyFromScreen(screen.Left, screen.Top, 0, 0, full.Size);
            full.Save(fullPath, ImageFormat.Png);
            int sx = Math.Max(0, x - screen.Left);
            int sy = Math.Max(0, y - screen.Top);
            int cw = Math.Min(w, full.Width - sx);
            int ch = Math.Min(h, full.Height - sy);
            if (cw <= 0 || ch <= 0) throw new Exception("crop bounds outside screen: " + x + "," + y + "," + w + "," + h);
            using (var crop = new Bitmap(cw, ch))
            using (var cg = Graphics.FromImage(crop)) {
                cg.DrawImage(full, new Rectangle(0, 0, cw, ch), new Rectangle(sx, sy, cw, ch), GraphicsUnit.Pixel);
                crop.Save(cropPath, ImageFormat.Png);
                var result = new O2GrabResult();
                result.full_path = fullPath;
                result.crop_path = cropPath;
                result.x = sx; result.y = sy; result.width = cw; result.height = ch;
                long sum = 0; double sumSq = 0; long nonBlack = 0; long highContrast = 0;
                var colors = new HashSet<int>();
                int stepX = Math.Max(1, cw / 400);
                int stepY = Math.Max(1, ch / 400);
                long sampled = 0;
                for (int py = 0; py < ch; py += stepY) {
                    for (int px = 0; px < cw; px += stepX) {
                        Color c = crop.GetPixel(px, py);
                        int luma = (int)(0.2126 * c.R + 0.7152 * c.G + 0.0722 * c.B);
                        sum += luma; sumSq += (double)luma * luma; sampled++;
                        if (luma < 12) nonBlack++;
                        if (luma < 40 || luma > 220) highContrast++;
                        colors.Add((c.R << 16) | (c.G << 8) | c.B);
                    }
                }
                result.mean_luma = sampled > 0 ? (double)sum / sampled : 0;
                double mean = result.mean_luma;
                result.std_luma = sampled > 0 ? Math.Sqrt(Math.Max(0, sumSq / sampled - mean * mean)) : 0;
                result.unique_colors = colors.Count;
                result.high_contrast_fraction = sampled > 0 ? (double)highContrast / sampled : 0;
                result.non_black_fraction = sampled > 0 ? (double)nonBlack / sampled : 0;
                return result;
            }
        }
    }
}
"@

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
if (-not $Bounds) {
    # Find the overlay window rect (physical pixels) from the Electron process.
    Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class O2FindWin {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
    public static string FindOverlay() {
        string found = "";
        EnumWindows((hWnd, lParam) => {
            var sb = new StringBuilder(512);
            GetWindowText(hWnd, sb, 512);
            var title = sb.ToString();
            if (title.Contains("Floating Mini-Screen") || title.Contains("HireShade Floating Screen")) {
                RECT r; GetWindowRect(hWnd, out r);
                found = r.Left + "," + r.Top + "," + (r.Right - r.Left) + "," + (r.Bottom - r.Top);
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return found;
    }
}
"@
    $Bounds = [O2FindWin]::FindOverlay()
    if (-not $Bounds) { Write-Output '{"error":"NO_OVERLAY_WINDOW_FOUND"}'; exit 0 }
}
$parts = $Bounds.Split(",")
$x = [int]$parts[0]; $y = [int]$parts[1]; $w = [int]$parts[2]; $h = [int]$parts[3]
$fullPath = Join-Path $OutDir ("gdi-" + $Label + "-full.png")
$cropPath = Join-Path $OutDir ("gdi-" + $Label + "-crop.png")
$result = [O2Grab]::Capture($fullPath, $cropPath, $x, $y, $w, $h)
$payload = [ordered]@{
    captured_at = (Get-Date).ToString("o")
    label = $Label
    note = $Note
    method = "GDI BitBlt (System.Drawing.Graphics.CopyFromScreen)"
    bounds = @{ x = $result.x; y = $result.y; width = $result.width; height = $result.height }
    full_path = $result.full_path
    crop_path = $result.crop_path
    stats = [ordered]@{
        mean_luma = [Math]::Round($result.mean_luma, 2)
        std_luma = [Math]::Round($result.std_luma, 2)
        unique_colors_sampled = $result.unique_colors
        high_contrast_fraction = [Math]::Round($result.high_contrast_fraction, 4)
        non_black_fraction = [Math]::Round($result.non_black_fraction, 4)
    }
}
$json = $payload | ConvertTo-Json -Depth 6
$json | Set-Content -Path (Join-Path $OutDir ("gdi-" + $Label + ".json")) -Encoding UTF8
Write-Output $json
exit 0
