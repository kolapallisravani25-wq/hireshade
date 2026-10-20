
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = 'docs/raw/assets';
const files = readdirSync(dir).filter(f => f.endsWith('.js'));
const terms = ['Download for','download for','For Windows','for macOS','Free Download','free download','Get the app','Desktop app','desktop app','installer','silent','stealth','undetect','screen shar','loopback','system audio','BlackHole','WASAPI','VB-Cable','virtual audio','headphones','multi-device','two device','second device','phone','Overlay','overlay','hotkey','shortcut','always on top','hide'];
for (const f of files) {
  const t = readFileSync(join(dir, f), 'utf8');
  for (const term of terms) {
    let i = 0, c = 0;
    while (c < 3) {
      const p = t.indexOf(term, i);
      if (p < 0) break;
      const snip = t.slice(Math.max(0,p-100), p+160).replace(/[\r\n]+/g,' ');
      console.log('[' + term + '] ' + f + ' @' + Buffer.byteLength(t.slice(0,p),'utf8') + ' :: ' + snip);
      i = p + term.length; c++;
    }
  }
}
