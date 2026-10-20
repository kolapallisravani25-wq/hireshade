
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
console.log('### /api/ in renderer ###');
{ let i=0; while(true){ const f = rend.indexOf('/api/', i); if (f<0) break; console.log('@' + Buffer.byteLength(rend.slice(0,f),'utf8') + ' :: ' + rend.slice(Math.max(0,f-120), f+150).replace(/\n/g,' ')); i = f+5; } }
console.log('');
console.log('### PROTOCOL constant ###');
{ let i=0; const re=/PROTOCOL=/g; let m; while((m=re.exec(main))){ console.log('@' + m.index + ' :: ' + main.slice(Math.max(0,m.index-160), m.index+200)); } }
console.log('');
console.log('### useChat / DefaultChatTransport ###');
show(rend, 'renderer', 'useChat', 200, 300, 3);
show(rend, 'renderer', 'DefaultChatTransport', 200, 400, 2);
