
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const dir = 'docs/raw/pages';
const files = readdirSync(dir).filter(f => f.endsWith('.html'));
for (const f of files) {
  const t = readFileSync(join(dir, f), 'utf8');
  const hits = new Set();
  const re = /href="([^"]*(?:download|dmg|exe|releases|desktop|install|app)[^"]*)"/gi;
  let m;
  while ((m = re.exec(t))) hits.add(m[1]);
  if (hits.size) { console.log('--- ' + f); for (const h of hits) console.log('   ' + h); }
}
