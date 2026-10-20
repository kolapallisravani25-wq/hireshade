
import { readFileSync } from 'node:fs';
const m = readFileSync('docs/raw/desktop/asar-extracted/dist/main/main.js');
const t = m.toString('utf8');
function bo(s) { const i = t.indexOf(s); return i < 0 ? null : Buffer.byteLength(t.slice(0, i), 'utf8'); }
const anchors = [
  'setContentProtection', 'transparent:!0,roundedCorners', 'alwaysOnTop:!0,frame:!1',
  'setAlwaysOnTop(!0,"screen-saver",1)', '},1e3)}',
  'setIgnoreMouseEvents(!0,{forward:!0})', 'setIgnoreMouseEvents(t,{forward:!0})',
  '"renderer/set-ignore-mouse-events"', 'setSkipTaskbar(!0)', 'setFocusable(t)',
  'app.dock.hide()', 'Dock poll', '"main/private-mode-changed"',
  't.registerAppShortcuts=function', 't.registerLiveCallSessionScreenShortcuts=function',
  'setDisplayMediaRequestHandler', 't.buildFeatureFlags=', 't.registerTray=function',
  't.AUDIO_CONFIG=', 'selectApplicationSources', 'startMeetingDetector'
];
for (const a of anchors) console.log(bo(a) + '\t' + a);
