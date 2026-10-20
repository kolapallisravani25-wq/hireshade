import Foundation
import ScreenCaptureKit
import CoreGraphics
import ImageIO
import UniformTypeIdentifiers

// SCK probe: capture the main display through ScreenCaptureKit and report the
// average colour inside a supplied rectangle. This is the API Zoom/Meet use on
// macOS 13+, not the legacy CGWindowList path.
// Usage: sck-probe <x> <y> <w> <h> [out.png]

struct Args {
    let x: Int; let y: Int; let w: Int; let h: Int; let out: String?
}

func parseArgs() -> Args {
    let a = CommandLine.arguments
    let x = a.count > 1 ? Int(a[1]) ?? 0 : 0
    let y = a.count > 2 ? Int(a[2]) ?? 0 : 0
    let w = a.count > 3 ? Int(a[3]) ?? 200 : 200
    let h = a.count > 4 ? Int(a[4]) ?? 200 : 200
    let out = a.count > 5 ? a[5] : nil
    return Args(x: x, y: y, w: w, h: h, out: out)
}

func sample(_ image: CGImage, _ rect: CGRect) -> (Double, Double, Double, Double) {
    let width = image.width, height = image.height
    var pixels = [UInt8](repeating: 0, count: width * height * 4)
    let cs = CGColorSpaceCreateDeviceRGB()
    guard let ctx = CGContext(data: &pixels, width: width, height: height, bitsPerComponent: 8,
                              bytesPerRow: width * 4, space: cs,
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        return (0,0,0,0)
    }
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    let scaleX = Double(width) / Double(CGDisplayPixelsWide(CGMainDisplayID()))
    let scaleY = Double(height) / Double(CGDisplayPixelsHigh(CGMainDisplayID()))
    let rx = max(0, min(width - 1, Int(Double(rect.origin.x) * scaleX)))
    let ry = max(0, min(height - 1, Int(Double(rect.origin.y) * scaleY)))
    let rw = max(1, min(width - rx, Int(Double(rect.width) * scaleX)))
    let rh = max(1, min(height - ry, Int(Double(rect.height) * scaleY)))
    var r = 0.0, g = 0.0, b = 0.0, n = 0.0
    var step = 1
    if rw * rh > 200000 { step = 3 }
    for yy in stride(from: ry, to: ry + rh, by: step) {
        for xx in stride(from: rx, to: rx + rw, by: step) {
            let i = (yy * width + xx) * 4
            r += Double(pixels[i]); g += Double(pixels[i+1]); b += Double(pixels[i+2]); n += 1
        }
    }
    return (r/n, g/n, b/n, n)
}

let args = parseArgs()
let sem = DispatchSemaphore(value: 0)
var exitCode: Int32 = 3

if #available(macOS 14.0, *) {
    SCShareableContent.getExcludingDesktopWindows(false, onScreenWindowsOnly: true) { content, error in
        if let error = error {
            print("{\"ok\":false,\"stage\":\"SCShareableContent\",\"error\":\"\(error.localizedDescription)\"}")
            sem.signal(); return
        }
        guard let content = content else {
            print("{\"ok\":false,\"stage\":\"content\",\"error\":\"no content\"}")
            sem.signal(); return
        }
        let useWindow = CommandLine.arguments.contains("--window")
        var filter: SCContentFilter
        var captureW = 0
        var captureH = 0
        var targetDescription = ""
        if useWindow {
            // Window-scoped SCContentFilter: capturing our own window may need a
            // weaker permission than whole-display capture and is the X2 fallback.
            guard let win = content.windows.first(where: {
                let app = $0.owningApplication?.applicationName ?? ""
                return app.contains("Electron") || $0.title.contains("HireShade") || $0.title.contains("PROTECTED")
            }) else {
                print("{\"ok\":false,\"stage\":\"window\",\"error\":\"no matching window\"}")
                sem.signal(); return
            }
            filter = SCContentFilter(desktopIndependentWindow: win)
            captureW = max(1, Int(win.frame.width))
            captureH = max(1, Int(win.frame.height))
            targetDescription = "window:" + win.title
        } else {
            guard let display = content.displays.first else {
                print("{\"ok\":false,\"stage\":\"displays\",\"error\":\"no display\"}")
                sem.signal(); return
            }
            filter = SCContentFilter(display: display, excludingWindows: [])
            captureW = display.width
            captureH = display.height
            targetDescription = "display:" + String(display.displayID)
        }
        let cfg = SCStreamConfiguration()
        cfg.width = captureW
        cfg.height = captureH
        cfg.pixelFormat = kCVPixelFormatType_32BGRA
        cfg.showsCursor = false
        Task {
            do {
                let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: cfg)
                let sampleRect = useWindow ? CGRect(x: 0, y: 0, width: image.width, height: image.height) : CGRect(x: args.x, y: args.y, width: args.w, height: args.h)
                let (r,g,b,n) = sample(image, sampleRect)
                var json = "{\"ok\":true,\"api\":\"ScreenCaptureKit\",\"target\":\"\(targetDescription)\",\"mode\":\"\(useWindow ? "window" : "display")\",\"width\":\(image.width),\"height\":\(image.height),\"sample\":{\"r\":\(r),\"g\":\(g),\"b\":\(b),\"n\":\(n)}}"
                if let out = args.out, let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: out) as CFURL, UTType.png.identifier as CFString, 1, nil) {
                    CGImageDestinationAddImage(dest, image, nil); CGImageDestinationFinalize(dest)
                    json = json.dropLast() + ",\"file\":\"\(out)\"}"
                }
                print(json)
                exitCode = 0; sem.signal()
            } catch {
                print("{\"ok\":false,\"stage\":\"SCScreenshotManager\",\"error\":\"\(error.localizedDescription)\"}")
                sem.signal()
            }
        }
    }
} else {
    print("{\"ok\":false,\"stage\":\"os\",\"error\":\"macOS 14+ required for SCScreenshotManager\"}")
    sem.signal()
}
_ = sem.wait(timeout: .now() + 25)
exit(exitCode)
