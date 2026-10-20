
import { readFileSync } from 'node:fs';
const rend = readFileSync('docs/raw/desktop/asar-extracted/dist/renderer/renderer.js', 'utf8');
const main = readFileSync('docs/raw/desktop/asar-extracted/dist/main/main.js', 'utf8');
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
console.log('########## all BrowserWindow( ##########');
{
  let i = 0;
  while (true) { const f = main.indexOf('BrowserWindow(', i); if (f < 0) break; console.log('@byte ' + Buffer.byteLength(main.slice(0,f),'utf8') + ' :: ' + main.slice(Math.max(0,f-200), f+300)); console.log(''); i = f + 1; }
}
console.log('########## models ##########');
show(rend, 'renderer', 'gpt-', 200, 200, 6);
show(rend, 'renderer', 'claude-', 200, 200, 6);
show(rend, 'renderer', 'gemini-', 200, 200, 6);
