import fs from 'node:fs';
import path from 'node:path';
const ROOT = process.cwd();
const SKIP = new Set(['node_modules','dist','.git','target','.turbo','coverage','build']);
const CODE_EXT = new Set(['.ts','.tsx','.js','.jsx','.mjs','.cjs','.rs']);
function walk(dir, out) {
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out); else if (e.isFile() && CODE_EXT.has(path.extname(e.name))) out.push(p);
  }
}
const roots = [];
for (const a of fs.readdirSync('artifacts', { withFileTypes: true })) {
  if (a.isDirectory() && fs.existsSync(path.join('artifacts', a.name, 'src'))) roots.push(path.join('artifacts', a.name, 'src'));
}
roots.push('artifacts/craft-vita/src-tauri/src');
for (const l of fs.readdirSync('lib', { withFileTypes: true })) {
  if (l.isDirectory() && fs.existsSync(path.join('lib', l.name, 'src'))) roots.push(path.join('lib', l.name, 'src'));
}
const files = []; for (const r of roots) walk(r, files);
const rel = (p) => path.relative(ROOT, p).replaceAll('\\','/');
function srcRootOf(f) { const i = f.replaceAll('\\','/').lastIndexOf('/src/'); return i >= 0 ? f.slice(0, i + 4) : path.dirname(f); }
const meta = new Map();
const IMPORT_RE = /(?:import\s+[^;]*?from\s*|import\s*\(\s*|require\s*\(\s*)["']([^"']+)["']/g;
const MARK_RE = /\b(TODO|FIXME|XXX|HACK|stub|Stub|STUB|placeholder|Placeholder|not implemented|notImplemented|NotImplemented|unimplemented|no-op|NoOp)\b/g;
for (const f of files) {
  const txt = fs.readFileSync(f, 'utf8');
  const lines = txt.split(/\r?\n/);
  const loc = lines.filter((l) => l.trim().length > 0).length;
  const imports = []; let m;
  while ((m = IMPORT_RE.exec(txt)) !== null) imports.push(m[1]);
  const marks = new Set(); while ((m = MARK_RE.exec(txt)) !== null) marks.add(m[1]);
  meta.set(f, { file: rel(f), loc, lines: lines.length, imports, marks: [...marks], ext: path.extname(f) });
}
const EXTS = ['.ts','.tsx','.js','.jsx','.mjs','.cjs'];
function candidates(base, spec) {
  const res = [];
  let p = spec;
  if (p.startsWith('@/')) p = path.join(srcRootOf(base), p.slice(2));
  else if (p.startsWith('.')) p = path.normalize(path.join(path.dirname(base), p));
  else return res;
  if (/\.js$/.test(p)) res.push(p.slice(0,-3) + '.ts', p.slice(0,-3) + '.tsx');
  res.push(p); for (const e of EXTS) res.push(p + e); for (const e of EXTS) res.push(path.join(p, 'index' + e));
  return res.map((x) => path.normalize(x));
}
const importedBy = new Map();
for (const f of files) for (const spec of meta.get(f).imports) for (const c of candidates(f, spec)) {
  if (meta.has(c)) { if (!importedBy.has(c)) importedBy.set(c, []); importedBy.get(c).push(meta.get(f).file); }
}
// Rust: mod declarations
const rsText = {}; for (const f of files) if (f.endsWith('.rs')) rsText[f] = fs.readFileSync(f, 'utf8');
for (const f of files) {
  if (!f.endsWith('.rs')) continue;
  const name = path.basename(f, '.rs');
  if (name === 'lib' || name === 'main') continue;
  const by = importedBy.get(f) || [];
  for (const [other, txt] of Object.entries(rsText)) {
    if (other === f) continue;
    if (new RegExp('mod\\s+' + name + '\\s*;').test(txt) && !by.includes(rel(other))) by.push(rel(other));
  }
  importedBy.set(f, by);
}
const ENTRY = /(^|\/)(main|index|app|entry|root|setup|routes)\.(t|j)sx?$/;
const rows = [];
for (const f of files) {
  const info = meta.get(f);
  const isTest = /\.test\.[tj]sx?$/.test(info.file);
  const by = importedBy.get(f) || [];
  const isEntry = ENTRY.test(info.file) || info.file.endsWith('/src-tauri/src/lib.rs');
  let cls = 'COMPLETE'; const reasons = [];
  const strong = info.marks.filter((x) => ['STUB','not implemented','notImplemented','NotImplemented','unimplemented','no-op','NoOp'].includes(x));
  const weak = info.marks.filter((x) => ['TODO','FIXME','XXX','HACK'].includes(x));
  if (isTest) { cls = 'TEST'; reasons.push('test'); }
  else if (info.file.includes('/tauri-stubs/')) { cls = 'STUB'; reasons.push('web-build stub module'); }
  else if (strong.length) { cls = 'STUB'; reasons.push('marker ' + strong.join(',')); }
  else if (by.length === 0 && !isEntry) { cls = 'ORPHANED'; reasons.push('no importers'); }
  else if (weak.length) { cls = 'PARTIAL'; reasons.push('marker ' + weak.join(',')); }
  if (!isTest && info.loc === 0) { cls = 'STUB'; reasons.push('empty'); }
  rows.push({ file: info.file, loc: info.loc, cls, by, marks: info.marks, reasons: reasons.join('; ') });
}
const byArea = {};
for (const r of rows) {
  const parts = r.file.split('/');
  let area = parts[0] === 'artifacts' ? 'artifacts/' + parts[1] : parts[0] === 'lib' ? 'lib/' + parts[1] : parts[0];
  byArea[area] = byArea[area] || { files: 0, loc: 0 }; byArea[area].files++; byArea[area].loc += r.loc;
}
const counts = {}; for (const r of rows) counts[r.cls] = (counts[r.cls] || 0) + 1;
fs.writeFileSync(path.join('docs','evidence','_inventory.json'), JSON.stringify({ counts, byArea, rows }, null, 0));
console.log(JSON.stringify({ counts, byArea }, null, 1));
