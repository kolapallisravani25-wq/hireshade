
import { readFileSync, writeFileSync } from 'node:fs';
const files = {
  'main.js': 'docs/raw/desktop/asar-extracted/dist/main/main.js',
  'preload.js': 'docs/raw/desktop/asar-extracted/dist/main/preload.js',
  'mic-monitor-worker.js': 'docs/raw/desktop/asar-extracted/dist/main/mic-monitor-worker.js',
  'renderer.js': 'docs/raw/desktop/asar-extracted/dist/renderer/renderer.js',
};
const patterns = [
  'setContentProtection','contentProtection','alwaysOnTop','setAlwaysOnTop','setVisibleOnAllWorkspaces',
  'setSkipTaskbar','skipTaskbar','setIgnoreMouseEvents','ignoreMouseEvents','focusable','transparent:',
  'frameless','titleBarStyle','hasShadow','type:"toolbar"','type: "toolbar"','type:"panel"','setActivationPolicy',
  'app.dock','dock.hide','LSUIElement','Tray','setLoginItemSettings','openAtLogin','powerSaveBlocker',
  'globalShortcut','setDisplayMediaRequestHandler','desktopCapturer','getDisplayMedia','getUserMedia',
  'loopback','WASAPI','wasapi','ScreenCaptureKit','CATapDescription','BlackHole','blackhole','Soundflower',
  'VB-Cable','coreaudio','CoreAudio','systemPreferences','askForMediaAccess','getMediaAccessStatus',
  'setAsDefaultProtocolClient','parakeetai://','protocol.handle','registerSchemesAsPrivileged',
  'contextBridge','exposeInMainWorld','setPermissionRequestHandler','setAudioMuted','webContents',
  'autoUpdater','safeStorage','process.platform','BrowserWindow','setWindowOpenHandler',
  'wss://','https://api','/api/','speechmatics','EventSource','WebSocket','text/event-stream',
  'deepgram','elevenlabs','openai','anthropic','gemini','gpt','claude','userSelect','setSimpleFullScreen',
  'setHiddenInMissionControl','setFullScreenable','webPreferences','backgroundThrottling','enableLargerThanScreen',
  'visualEffectState','vibrancy','setAlwaysOnTop','moveTop','setPosition','screen.getDisplay'
];
const out = [];
for (const [label, p] of Object.entries(files)) {
  let t;
  try { t = readFileSync(p, 'utf8'); } catch (e) { console.log('MISSING ' + p); continue; }
  for (const pat of patterns) {
    let i = 0, c = 0;
    while (c < 8) {
      const f = t.indexOf(pat, i);
      if (f < 0) break;
      const s = Math.max(0, f - 160), e = Math.min(t.length, f + pat.length + 200);
      out.push({ file: label, pattern: pat, byteOffset: Buffer.byteLength(t.slice(0, f), 'utf8'), line: t.slice(0, f).split('\n').length, snippet: t.slice(s, e).replace(/[\r\n\t]+/g, ' ') });
      i = f + pat.length; c++;
    }
  }
}
writeFileSync('docs/raw/probes/desktop-mechanism-grep.json', JSON.stringify(out, null, 1));
console.log('total matches:', out.length);
const counts = {};
for (const o of out) counts[o.pattern] = (counts[o.pattern]||0)+1;
console.log(JSON.stringify(counts, null, 1));
