
import { readFileSync } from 'node:fs';
const rend = readFileSync('docs/raw/desktop/asar-extracted/dist/renderer/renderer.js', 'utf8');
function idents(src, kw) {
  const re = new RegExp('[A-Za-z_$][A-Za-z0-9_$]*' + kw + '[A-Za-z0-9_$]*|' + kw + '[A-Za-z0-9_$]*', 'gi');
  const m = new Map();
  let x;
  while ((x = re.exec(src))) m.set(x[0], (m.get(x[0])||0)+1);
  return [...m.entries()].sort((a,b)=>b[1]-a[1]);
}
for (const kw of ['credit','Credit']) {
  console.log('--- idents *' + kw + '* ---');
  console.log(idents(rend, kw).slice(0,60).map(([k,v])=>k+'('+v+')').join('  '));
}
console.log('--- idents *prompt* ---');
console.log(idents(rend, 'prompt').slice(0,80).map(([k,v])=>k+'('+v+')').join('  '));
console.log('--- idents *instruction* ---');
console.log(idents(rend, 'nstruction').slice(0,40).map(([k,v])=>k+'('+v+')').join('  '));
console.log('--- idents *resume* ---');
console.log(idents(rend, 'esume').slice(0,60).map(([k,v])=>k+'('+v+')').join('  '));
console.log('--- idents *context* ---');
console.log(idents(rend, 'ontext').slice(0,50).map(([k,v])=>k+'('+v+')').join('  '));
