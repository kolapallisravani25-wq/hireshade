
import { readFileSync, writeFileSync } from 'node:fs';
const base = 'docs/raw/desktop/mac-unpacked/ParakeetAI.app/Contents/Resources/app.asar.unpacked/dist/main/';
const targets = {
  'win32-x64-msvc': base + 'parakeetai-native.win32-x64-msvc.node',
  'darwin-arm64': base + 'parakeetai-native.darwin-arm64.node',
};
const terms = ['WASAPI','IAudioClient','AudioClient','IMMDevice','AUDCLNT','loopback','Loopback','LOOPBACK','WAVE_FORMAT','wave','CORE_AUDIO','CoreAudio','AudioObject','kAudio','CATapDescription','ScreenCaptureKit','SCStream','AVCapture','Zoom','Process','deviceId','WASAPI_LOOPBACK','GetDefaultAudioEndpoint','AUDIOCLIENT','IAudioCaptureClient','AudioSession','Stereo','Mono','resample','16-bit','f32','sampleRate','channels','getActiveAudioInputProcesses','bundleId','executablePath','pid','session','mic','Microphone','permission'];
for (const [label, p] of Object.entries(targets)) {
  let buf;
  try { buf = readFileSync(p); } catch (e) { console.log('MISSING ' + p); continue; }
  console.log('########## ' + label + ' (' + buf.length + ' bytes) ##########');
  const ascii = buf.toString('latin1');
  for (const t of terms) {
    const hits = [];
    let i = 0;
    while (hits.length < 3) { const f = ascii.indexOf(t, i); if (f < 0) break; hits.push(f); i = f + t.length; }
    if (hits.length) console.log('[' + t + '] offsets=' + hits.join(',') + ' :: ' + ascii.slice(Math.max(0,hits[0]-70), hits[0]+t.length+90).replace(/[^\x20-\x7e]+/g,' ').trim());
  }
  // UTF-16LE scan for wide strings
  const wide = Buffer.from(buf).toString('utf16le');
  const wt = terms.filter(t => wide.includes(t));
  if (wt.length) console.log('[utf16le hits] ' + wt.join(','));
}
