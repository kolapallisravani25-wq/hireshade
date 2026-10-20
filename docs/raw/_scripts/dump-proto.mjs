
import { readFileSync } from 'node:fs';
const main = readFileSync('docs/raw/desktop/asar-extracted/dist/main/main.js', 'utf8');
const filelist = readFileSync('docs/raw/desktop/asar-filelist.txt', 'utf8');
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
console.log('=== deps containing loopback/audio/tray/update ===');
for (const line of filelist.split('\n')) {
  if (/electron-audio-loopback|electron-store|electron-updater|electron-log|napi-rs|sonora|@parakeetai-desktop/.test(line) && /package\.json$/.test(line)) console.log(line);
}
console.log('');
show(main, 'main', 'setAsDefaultProtocolClient', 300, 400, 2);
show(main, 'main', 'registerSchemesAsPrivileged', 200, 400, 2);
show(main, 'main', 'protocol', 150, 250, 6);
