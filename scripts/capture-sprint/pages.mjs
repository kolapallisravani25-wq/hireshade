/** S4 capture-sprint pages: click target, protected overlay, browser share + app tab. */

export function buildTargetHtml() {
  return [
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\" /><title>S4 click target</title>",
    "<style>",
    "html,body{height:100%;margin:0;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;background:#053b1f;color:#d1fae5;}",
    "body{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;}",
    "#clicks{font-size:96px;font-weight:800;color:#4ade80;line-height:1;}",
    ".hint{opacity:.65;font-size:13px;max-width:520px;text-align:center;}",
    ".marker{position:absolute;left:25%;top:15%;width:50%;height:55%;background:#1d4ed8;border-radius:18px;opacity:.85;}",
    "</style></head><body>",
    '<div class="marker" id="app-tab-marker"></div>',
    '<div style="position:relative;z-index:2;text-align:center"><h1>Click target window</h1><div id="clicks">0</div></div>',
    '<p class="hint" style="position:relative;z-index:2">Clicks that pass through the protected overlay land here.</p>',
    "<script>",
    "window.__targetClicks = 0;",
    "document.addEventListener('click', function (event) { window.__targetClicks += 1; document.getElementById('clicks').textContent = String(window.__targetClicks); window.__lastTargetClick = { x: event.clientX, y: event.clientY, at: Date.now() }; });",
    "window.__targetReady = true;",
    "</script></body></html>",
  ].join("\n");
}

export function buildOverlayHtml() {
  return [
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\" /><title>S4 protected overlay</title>",
    "<style>",
    "html,body{height:100%;margin:0;background:transparent;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif;}",
    "#overlay-card{position:absolute;left:60px;top:60px;right:60px;bottom:60px;background:#ff00ff;border-radius:18px;",
    "  box-shadow:0 0 0 2px rgba(255,255,255,.35) inset;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;}",
    "#overlay-card h1{font-size:26px;margin:0;letter-spacing:.02em;}",
    "#overlay-button{font-size:18px;font-weight:700;padding:14px 26px;border-radius:999px;border:2px solid #fff;background:rgba(0,0,0,.25);color:#fff;cursor:pointer;}",
    "#overlay-clicks{font-size:44px;font-weight:800;}",
    ".note{font-size:12px;opacity:.85;}",
    "</style></head><body>",
    '<div id="overlay-card">',
    "  <h1>PROTECTED OVERLAY</h1>",
    '  <button id="overlay-button" data-testid="overlay-button">Overlay control</button>',
    '  <div id="overlay-clicks" data-testid="overlay-clicks">0</div>',
    '  <div class="note">setContentProtection(true) · magenta signal region</div>',
    "</div>",
    "<script>",
    "window.__overlayClicks = 0;",
    "document.getElementById('overlay-button').addEventListener('click', function (event) { event.stopPropagation(); window.__overlayClicks += 1; document.getElementById('overlay-clicks').textContent = String(window.__overlayClicks); window.__lastOverlayClick = { at: Date.now() }; });",
    "window.__overlayReady = true;",
    "</script></body></html>",
  ].join("\n");
}

export function buildShareHtml() {
  return [
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\" /><title>S4 browser share probe</title>",
    "<style>html,body{margin:0;background:#052e16;color:#dcfce7;font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden;}",
    "#preview{position:fixed;inset:0;display:block;}",
    "#status{position:fixed;left:10px;bottom:10px;font-size:12px;background:rgba(0,0,0,.6);padding:6px 10px;border-radius:8px;}",
    "</style></head><body><canvas id=\"preview\"></canvas><div id=\"status\">share probe idle</div>",
    "<script>",
    "window.__share = {",
    "  async start(mode, points) {",
    "    try {",
    "      document.getElementById('status').textContent = 'requesting ' + mode;",
    "      var constraints = mode === 'tab' ? { video: { displaySurface: 'browser', frameRate: 5 }, audio: false } : { video: { displaySurface: 'monitor', frameRate: 5 }, audio: false };",
    "      var stream = await navigator.mediaDevices.getDisplayMedia(constraints);",
    "      var track = stream.getVideoTracks()[0];",
    "      var settings = track.getSettings ? track.getSettings() : {};",
    "      var video = document.createElement('video');",
    "      video.muted = true; video.playsInline = true; video.srcObject = stream;",
    "      await video.play();",
    "      await new Promise(function (resolve) { setTimeout(resolve, 900); });",
    "      var canvas = document.getElementById('preview');",
    "      canvas.width = settings.width || video.videoWidth || 1280;",
    "      canvas.height = settings.height || video.videoHeight || 720;",
    "      var ctx = canvas.getContext('2d');",
    "      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);",
    "      var samples = [];",
    "      for (var i = 0; i < points.length; i++) {",
    "        var point = points[i];",
    "        var x = Math.max(0, Math.min(canvas.width - 1, Math.round(point.xRel * canvas.width)));",
    "        var y = Math.max(0, Math.min(canvas.height - 1, Math.round(point.yRel * canvas.height)));",
    "        var data = ctx.getImageData(x, y, 1, 1).data;",
    "        samples.push({ name: point.name, xRel: point.xRel, yRel: point.yRel, x: x, y: y, rgb: [data[0], data[1], data[2]], alpha: data[3] });",
    "      }",
    "      window.__shareLast = { settings: settings, canvas: [canvas.width, canvas.height], samples: samples };",
    "      stream.getTracks().forEach(function (t) { t.stop(); });",
    "      document.getElementById('status').textContent = 'captured ' + canvas.width + 'x' + canvas.height;",
    "      return { ok: true, displaySurface: settings.displaySurface || mode, canvas: [canvas.width, canvas.height], settings: settings, samples: samples };",
    "    } catch (error) {",
    "      document.getElementById('status').textContent = 'error: ' + String(error);",
    "      return { ok: false, error: String(error && error.name ? error.name + ': ' + error.message : error) };",
    "    }",
    "  }",
    "};",
    "window.__shareReady = true;",
    "</script></body></html>",
  ].join("\n");
}

/** App tab captured by the browser tab-share picker; the blue marker sits where
 *  the Electron overlay sits on screen (relative coordinates), proving that tab
 *  capture contains tab DOM only, never the overlay window. */
export function buildAppTabHtml() {
  return [
    "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\" /><title>HireShade App Tab</title>",
    "<style>",
    "html,body{height:100%;margin:0;overflow:hidden;background:#3b0764;font-family:'Segoe UI',system-ui,sans-serif;color:#f3e8ff;}",
    ".app-marker{position:absolute;left:25%;top:15%;width:50%;height:55%;background:#1d4ed8;border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:#dbeafe;}",
    "h1{position:absolute;left:24px;top:24px;margin:0;font-size:20px;}",
    "</style></head><body>",
    '<h1>HireShade App Tab (tab-share target)</h1>',
    '<div class="app-marker" id="app-tab-marker">APP TAB CONTENT — no overlay here</div>',
    "</body></html>",
  ].join("\n");
}
