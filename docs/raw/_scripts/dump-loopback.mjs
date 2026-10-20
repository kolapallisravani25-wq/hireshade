
import { readFileSync } from 'node:fs';
const main = readFileSync('docs/raw/desktop/asar-extracted/dist/main/main.js', 'utf8');
const rend = readFileSync('docs/raw/desktop/asar-extracted/dist/renderer/renderer.js', 'utf8');
const mw = readFileSync('docs/raw/desktop/asar-extracted/dist/main/mic-monitor-worker.js', 'utf8');
function show(src, label, pat, before, after, max) {
  let i = 0, c = 0;
  while (c < (max||3)) {
    const f = src.indexOf(pat, i);
    if (f < 0) break;
    console.log('===== [' + label + '] "' + pat + '" @byte ' + Buffer.byteLength(src.slice(0,f),'utf8'));
    console.log(src.slice(Math.max(0,f-before), f+pat.length+after));
    console.log('');
    i = f + pat.length; c++;
  }
}
show(main, 'main', 'AudioProcessor', 300, 500, 5);
show(main, 'main', 'loopbackAudioTypes', 300, 700, 2);
show(main, 'main', 'buildFeatureFlags', 500, 900, 2);
show(rend, 'renderer', 'enableLoopbackAudio', 300, 500, 3);
show(mw, 'mic-worker', 'AudioProcessor', 300, 500, 3);
