import fs from "node:fs";
const files = [
  "docs/raw/desktop/asar-extracted/dist/main/main.js",
  "docs/raw/desktop/asar-extracted/dist/main/preload.js",
  "docs/raw/desktop/asar-extracted/dist/renderer/renderer.js",
];
const native = [
  "docs/raw/desktop/mac-unpacked/ParakeetAI.app/Contents/Resources/app.asar.unpacked/dist/main/parakeetai-native.win32-x64-msvc.node",
  "docs/raw/desktop/mac-unpacked/ParakeetAI.app/Contents/Resources/app.asar.unpacked/dist/main/parakeetai-native.darwin-arm64.node",
];
const pats = {
  gaze: /gaze|eye[-_ ]?contact|eyetrack|iris|pupil/gi,
  virtualCam: /virtual[-_ ]?cam|virtualcamera|softcam|obs[-_ ]?virtual|dshow|directshow|coremediaio|CMIO|v4l2loopback/gi,
  face: /mediapipe|face[-_ ]?mesh|facial[-_ ]?landmark|face[-_ ]?landmark|onnx|insightface|dlib/gi,
  camera: /getUserMedia|camera|webcam|videoinput|VideoCapture/gi,
};
const out = {};
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  out[f] = {};
  for (const [name, re] of Object.entries(pats)) {
    const matches = [];
    for (const m of text.matchAll(re)) {
      matches.push({ offset: m.index, ctx: text.slice(Math.max(0,m.index-80), m.index+120).replace(/\s+/g," ") });
      if (matches.length >= 5) break;
    }
    if (matches.length) out[f][name] = matches;
  }
}
for (const f of native) {
  const buf = fs.readFileSync(f);
  const text = buf.toString("latin1");
  const strings = [];
  for (const m of text.matchAll(/[ -~]{5,}/g)) {
    const s = m[0];
    if (/gaze|iris|pupil|eye[-_ ]?contact|virtual[-_ ]?cam|dshow|directshow|coremediaio|CMIO|mediapipe|onnx|face[-_ ]?landmark|camera|videocapture|frame/i.test(s)) {
      strings.push({ offset: m.index, s: s.slice(0, 180) });
      if (strings.length >= 15) break;
    }
  }
  out[f] = { matchedStrings: strings };
}
fs.writeFileSync("docs/raw/desktop/gaze-scan.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2).slice(0, 9000));
