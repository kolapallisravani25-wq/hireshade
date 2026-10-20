
import { readFileSync, writeFileSync } from 'node:fs';
const rend = readFileSync('docs/raw/desktop/asar-extracted/dist/renderer/renderer.js', 'utf8');
const main = readFileSync('docs/raw/desktop/asar-extracted/dist/main/main.js', 'utf8');
// collect tRPC procedure-ish identifiers: word.word used as property chains
const pats = ['useSubscription','liveCallSession.','callSession.','billing.','credit','prompt','systemPrompt','resume','Subscription'];
const counts = {};
for (const p of pats) {
  let i = 0, c = 0;
  while (true) { const f = rend.indexOf(p, i); if (f < 0) break; c++; i = f + p.length; }
  counts[p] = c;
}
console.log('renderer counts:', JSON.stringify(counts));
// dump useSubscription occurrences
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
console.log('########## useSubscription ##########');
show(rend, 'renderer', 'useSubscription', 250, 350, 8);
console.log('########## liveCallSession. ##########');
show(rend, 'renderer', 'liveCallSession.', 150, 250, 12);
