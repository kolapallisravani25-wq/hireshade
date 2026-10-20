
import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync('docs/raw/probes/gh-release-latest.json', 'utf8'));
console.log('tag:', j.tag_name, '| name:', j.name, '| published:', j.published_at);
console.log('assets:');
for (const a of j.assets) {
  console.log([a.name, a.size, (a.size/1048576).toFixed(2)+' MB', a.digest, 'downloads=' + a.download_count, a.browser_download_url].join(' | '));
}
