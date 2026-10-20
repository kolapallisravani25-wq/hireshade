import fs from 'node:fs';
const d = JSON.parse(fs.readFileSync('docs/evidence/_inventory.json','utf8'));
const header = fs.readFileSync('docs/evidence/_audit_inventory_header.md','utf8');
const exact = {
  'artifacts/craft-vita/src-tauri/src/focus_bypass.rs': ['BROKEN','mod declared (lib.rs:2) but install_focus_bypass() has no call sites; WinEvent callback body is empty'],
  'artifacts/craft-vita/src-tauri/src/screen_protect.rs': ['BROKEN','mod declared (lib.rs:1) but set_screen_protection not registered; apply_on_create never called'],
  'artifacts/craft-vita/src-tauri/src/cursor.rs': ['BROKEN','mod declared (lib.rs:3) but commands never registered/called; compiler warns never used'],
  'artifacts/craft-vita/src/pages/Launcher/WidgetApp.tsx': ['COMPLETE','HTML entry (launcher.html)'],
  'artifacts/craft-vita/src/pages/Sessions/ActiveSession/FloatingApp.tsx': ['COMPLETE','HTML entry (floating.html)'],
  'artifacts/craft-vita/src/pages/Launcher/LauncherApp.tsx': ['ORPHANED','launcher.html loads WidgetApp.tsx instead'],
  'artifacts/craft-vita/src/services/MiniRemoteAudio.ts': ['ORPHANED','only self-references; hooks/useMiniRemoteAudio.ts is 0 bytes'],
  'artifacts/craft-vita/src/capture/runtime.ts': ['ORPHANED','getCaptureRuntime/isDesktop/isBrowser have no external importers'],
  'artifacts/craft-vita/src/hooks/useMiniRemoteAudio.ts': ['STUB','0-byte file'],
  'artifacts/api-server/src/lib/aiRateLimit.ts': ['PARTIAL','process-local in-memory buckets; not shared across replicas (aiRateLimit.ts:30)'],
  'artifacts/api-server/src/routes/desktop.ts': ['PARTIAL','desktop token/link routes; refresh token travels as bearer, see docs/HireShade-Full-Audit.md'],
};
const prefixes = [
  ['artifacts/craft-vita/src/overlay/', ['PARTIAL','overlay migration flag defaults false (overlay/flags.ts:23-51)']],
  ['artifacts/craft-vita/src/semantic/', ['ORPHANED','semantic-engine barrel not imported by app code']],
];
const rows = d.rows.map((r) => {
  let cls = r.cls, note = r.reasons;
  if (exact[r.file]) { cls = exact[r.file][0]; note = exact[r.file][1]; }
  else for (const [p, v] of prefixes) { if (r.file.startsWith(p)) { cls = v[0]; note = v[1]; break; } }
  if (!note) note = cls === 'COMPLETE' ? '' : '';
  return { ...r, cls, note };
});
const AREAS = [
  ['artifacts/craft-vita/src', 'artifacts/craft-vita/src (web + Tauri frontend)'],
  ['artifacts/craft-vita/src-tauri/src', 'artifacts/craft-vita/src-tauri/src (Rust)'],
  ['artifacts/api-server/src', 'artifacts/api-server/src (Express API)'],
  ['artifacts/mockup-sandbox/src', 'artifacts/mockup-sandbox/src (UI sandbox)'],
  ['lib/', 'lib/*/src (shared/generated packages)'],
];
function areaOf(f) { for (const [p] of AREAS) if (f === p || f.startsWith(p.endsWith('/') ? p : p + '/')) return p; return 'OTHER'; }
const byArea = new Map();
for (const r of rows) { const a = areaOf(r.file); if (!byArea.has(a)) byArea.set(a, []); byArea.get(a).push(r); }
const out = [header];
for (const [a, label] of AREAS) {
  const list = byArea.get(a) || []; if (!list.length) continue;
  const totalLoc = list.reduce((s, r) => s + r.loc, 0);
  const cc = {}; for (const r of list) cc[r.cls] = (cc[r.cls] || 0) + 1;
  out.push('## 6.' + (AREAS.findIndex((x) => x[0] === a) + 1) + ' ' + label + ' — ' + list.length + ' files, ' + totalLoc + ' LOC (' + Object.entries(cc).map(([k, v]) => k + ' ' + v).join(', ') + ')\n');
  const dirs = new Map();
  for (const r of list) { const dir = r.file.slice(0, r.file.lastIndexOf('/')); if (!dirs.has(dir)) dirs.set(dir, []); dirs.get(dir).push(r); }
  for (const dir of [...dirs.keys()].sort()) {
    const files = dirs.get(dir).sort((x, y) => x.file.localeCompare(y.file));
    out.push('### `' + dir + '/` (' + files.length + ' files)\n');
    out.push('| File | LOC | Class | Note |');
    out.push('|---|---:|---|---|');
    for (const f of files) {
      const base = f.file.slice(dir.length + 1);
      out.push('| `' + base + '` | ' + f.loc + ' | ' + f.cls + ' | ' + (f.note || '').replace(/\|/g, '\\|') + ' |');
    }
    out.push('');
  }
}
fs.writeFileSync('docs/AUDIT_INVENTORY.md', out.join('\n'), 'utf8');
console.log('wrote docs/AUDIT_INVENTORY.md bytes=' + out.join('\n').length);
const c2 = {}; for (const r of rows) c2[r.cls] = (c2[r.cls] || 0) + 1;
console.log(JSON.stringify(c2));