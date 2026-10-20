
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
console.log('########## PROTECTED_ORIGINS ##########');
show(main, 'main', 'PROTECTED_ORIGINS', 400, 800, 3);
console.log('########## parakeet-ai.com (renderer) ##########');
show(rend, 'renderer', 'parakeet-ai.com', 300, 400, 6);
console.log('########## parakeet-ai.com (main) ##########');
show(main, 'main', 'parakeet-ai.com', 200, 300, 8);
console.log('########## callSession. trpc paths ##########');
show(rend, 'renderer', 'callSession.', 120, 200, 14);
