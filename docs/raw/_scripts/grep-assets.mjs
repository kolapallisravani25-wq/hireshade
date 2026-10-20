
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'docs/raw/assets';
const files = readdirSync(dir).filter(f => f.endsWith('.js'));

const patterns = [
  'https://api', 'http://api', 'wss://', 'ws://', 'socket.io', 'supabase', 'firebase', 'clerk',
  'stripe', 'deepgram', 'assemblyai', 'assembly', 'elevenlabs', 'openai', 'anthropic',
  'generativelanguage', 'gemini', 'speechmatics', 'mixpanel', 'uploadthing', 'ufs.sh', 'utfs.io',
  'sentry', 'neon.tech', 'posthog', 'googleapis', 'googletagmanager', 'google-analytics',
  'fillout', 'authjs', 'next-auth', 'nextauth', 'run.app', 'vercel', 'resend', 'sendgrid',
  'twilio', 'revenuecat', 'paddle', 'lemonsqueezy', 'crisp', 'intercom', 'posthog',
  '/api/', 'fetch(', 'EventSource', 'WebSocket', 'RTCPeerConnection', 'getUserMedia',
  'getDisplayMedia', 'MediaRecorder', 'audio/webm', 'sampleRate', 'credits', 'subscription'
];

const rows = [];
for (const f of files) {
  const buf = readFileSync(join(dir, f));
  const text = buf.toString('utf8');
  for (const p of patterns) {
    let idx = 0;
    let count = 0;
    while (count < 6) {
      const found = text.indexOf(p, idx);
      if (found < 0) break;
      const start = Math.max(0, found - 60);
      const end = Math.min(text.length, found + p.length + 100);
      let snippet = text.slice(start, end).replace(/[\r\n\t]+/g, ' ');
      // byte offset: compute with Buffer for accuracy
      const byteOffset = Buffer.byteLength(text.slice(0, found), 'utf8');
      const lineNo = text.slice(0, found).split('\n').length;
      rows.push({ file: f, term: p, byteOffset, line: lineNo, snippet });
      idx = found + p.length;
      count++;
    }
  }
}
writeFileSync('docs/raw/probes/grep-results.json', JSON.stringify(rows, null, 1));

// summary per term
const byTerm = {};
for (const r of rows) { byTerm[r.term] = (byTerm[r.term] || 0) + 1; }
console.log('total matches:', rows.length);
console.log('JS files scanned:', files.length);
console.log(JSON.stringify(byTerm, null, 1));
