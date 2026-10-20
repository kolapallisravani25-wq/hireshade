param(
  [Parameter(Mandatory = $true)][string]$OutDir,
  [Parameter(Mandatory = $true)][string]$Label,
  [string]$Title = "Floating Mini-Screen"
)

Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing @"
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Text;

public class O2PrintWindowResult {
    public string title;
    public long hwnd;
    public bool printwindow_ok;
    public uint flag_used;
    public string path;
    public int width;
    public int height;
    public double mean_luma;
    public double std_luma;
    public int unique_colors;
    public double black_fraction;
}

public class O2PrintWindow {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc cb, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder sb, int max);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdc, uint flags);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    public static IntPtr Find(string wanted) {
        IntPtr found = IntPtr.Zero;
        EnumWindows((hWnd, lParam) => {
            var sb = new StringBuilder(512);
            GetWindowText(hWnd, sb, 512);
            if (sb.ToString().Contains(wanted)) { found = hWnd; return false; }
            return true;
        }, IntPtr.Zero);
        return found;
    }

    public static O2PrintWindowResult Capture(string wanted, string path) {
        var result = new O2PrintWindowResult();
        result.title = "";
        result.path = path;
        IntPtr hWnd = Find(wanted);
        result.hwnd = hWnd.ToInt64();
        if (hWnd == IntPtr.Zero) { result.printwindow_ok = false; return result; }
        var sb = new StringBuilder(512);
        GetWindowText(hWnd, sb, 512);
        result.title = sb.ToString();
        RECT r;
        GetWindowRect(hWnd, out r);
        int w = Math.Max(1, r.Right - r.Left);
        int h = Math.Max(1, r.Bottom - r.Top);
        result.width = w; result.height = h;
        // Try PW_RENDERFULLCONTENT (2) first, then 0.
        foreach (uint flag in new uint[] { 2, 0 }) {
            using (var bmp = new Bitmap(w, h))
            using (var g = Graphics.FromImage(bmp)) {
                IntPtr hdc = g.GetHdc();
                bool ok = false;
                try { ok = PrintWindow(hWnd, hdc, flag); } catch { ok = false; }
                finally { g.ReleaseHdc(hdc); }
                if (!ok) continue;
                long sum = 0; double sumSq = 0; long black = 0; long sampled = 0;
                var colors = new HashSet<int>();
                int stepX = Math.Max(1, w / 300);
                int stepY = Math.Max(1, h / 300);
                double maxLuma = 0;
                for (int y = 0; y < h; y += stepY) {
                    for (int x = 0; x < w; x += stepX) {
                        Color c = bmp.GetPixel(x, y);
                        int luma = (int)(0.2126 * c.R + 0.7152 * c.G + 0.0722 * c.B);
                        sum += luma; sumSq += (double)luma * luma; sampled++;
                        if (luma < 8) black++;
                        if (luma > maxLuma) maxLuma = luma;
                        colors.Add((c.R << 16) | (c.G << 8) | c.B);
                    }
                }
                bmp.Save(path, ImageFormat.Png);
                result.printwindow_ok = true;
                result.flag_used = flag;
                result.mean_luma = sampled > 0 ? (double)sum / sampled : 0;
                double mean = result.mean_luma;
                result.std_luma = sampled > 0 ? Math.Sqrt(Math.Max(0, sumSq / sampled - mean * mean)) : 0;
                result.unique_colors = colors.Count;
                result.black_fraction = sampled > 0 ? (double)black / sampled : 1;
                if (maxLuma > 8 || flag == 0) return result;
            }
        }
        return result;
    }
}
"@

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$path = Join-Path $OutDir ("printwindow-" + $Label + ".png")
$result = [O2PrintWindow]::Capture($Title, $path)
$payload = [ordered]@{
    captured_at = (Get-Date).ToString("o")
    label = $Label
    method = "PrintWindow (user32!PrintWindow, PW_RENDERFULLCONTENT=2 first)"
    title = $result.title
    hwnd = ("0x{0:X}" -f $result.hwnd)
    printwindow_ok = $result.printwindow_ok
    flag_used = $result.flag_used
    path = $result.path
    width = $result.width
    height = $result.height
    stats = [ordered]@{
        mean_luma = [Math]::Round($result.mean_luma, 2)
        std_luma = [Math]::Round($result.std_luma, 2)
        unique_colors_sampled = $result.unique_colors
        black_fraction = [Math]::Round($result.black_fraction, 4)
    }
}
$json = $payload | ConvertTo-Json -Depth 6
$json | Set-Content -Path (Join-Path $OutDir ("printwindow-" + $Label + ".json")) -Encoding UTF8
Write-Output $json
exit 0
