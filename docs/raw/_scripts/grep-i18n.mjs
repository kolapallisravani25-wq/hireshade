
import { readFileSync } from 'node:fs';
const t = readFileSync('docs/raw/assets/chunks_07n6jmg7t2sqq.js', 'utf8');
const terms = ['ownload','Windows','Mac','macOS','Apple Silicon','Intel','installer','install','DMG','dmg','exe','app store','Chrome','extension','mobile app','iOS','Android','system audio','loopback','headphone','earbud','stealth','undetect','invisible','screen shar'];
for (const term of terms) {
  let i = 0, c = 0;
  while (c < 4) {
    const f = t.indexOf(term, i);
    if (f < 0) break;
    console.log('[' + term + '] @' + Buffer.byteLength(t.slice(0,f),'utf8') + ' :: ' + t.slice(Math.max(0,f-110), f+150).replace(/[\r\n]+/g,' '));
    i = f + term.length; c++;
  }
}
