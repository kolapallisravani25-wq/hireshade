
import { readFileSync } from 'node:fs';
const rend = readFileSync('docs/raw/desktop/asar-extracted/dist/renderer/renderer.js', 'utf8');
function show(pat, before, after, max) {
  let i = 0, c = 0;
  while (c < (max||2)) {
    const f = rend.indexOf(pat, i);
    if (f < 0) break;
    console.log('===== "' + pat + '" @byte ' + Buffer.byteLength(rend.slice(0,f),'utf8'));
    console.log(rend.slice(Math.max(0,f-before), f+pat.length+after));
    console.log('');
    i = f + pat.length; c++;
  }
}
show('SESSION_CREDIT_COST', 250, 250, 3);
show('AUTO_EXTEND_PROMPT_THRESHOLD_MS', 200, 200, 2);
show('creditLedger', 200, 300, 2);
show('systemInstructions', 250, 300, 2);
show('useInstructionsDraft', 200, 250, 2);
