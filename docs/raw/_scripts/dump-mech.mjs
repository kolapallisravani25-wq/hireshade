
import { readFileSync, writeFileSync } from 'node:fs';
const src = {
  'dist/main/main.js': readFileSync('docs/raw/desktop/asar-extracted/dist/main/main.js', 'utf8'),
  'dist/main/preload.js': readFileSync('docs/raw/desktop/asar-extracted/dist/main/preload.js', 'utf8'),
  'dist/main/mic-monitor-worker.js': readFileSync('docs/raw/desktop/asar-extracted/dist/main/mic-monitor-worker.js', 'utf8'),
  'dist/renderer/renderer.js': readFileSync('docs/raw/desktop/asar-extracted/dist/renderer/renderer.js', 'utf8'),
};
const wanted = [
  ['globalShortcut.register', 200, 700],
  ['setDisplayMediaRequestHandler', 500, 900],
  ['OutputLoopbackCapture', 400, 900],
  ['listOutputDevices', 300, 700],
  ['setActivationPolicy', 300, 500],
  ['app.dock', 300, 500],
  ['setLoginItemSettings', 300, 500],
  ['new Tray', 200, 400],
];
const lines = [];
for (const [pat, before, after] of wanted) {
  for (const [file, t] of Object.entries(src)) {
    let i = 0, c = 0;
    while (c < 4) {
      const f = t.indexOf(pat, i);
      if (f < 0) break;
      const off = Buffer.byteLength(t.slice(0, f), 'utf8');
      const rec = '===== ' + pat + ' | ' + file + ' | byte ' + off + ' | line ' + t.slice(0,f).split('\n').length + '\n' + t.slice(Math.max(0,f-before), f+pat.length+after) + '\n';
      lines.push(rec);
      i = f + pat.length; c++;
    }
  }
}
writeFileSync('docs/raw/probes/desktop-mechanisms-dump.txt', lines.join('\n'));
console.log(lines.join('\n').slice(0, 16000));
