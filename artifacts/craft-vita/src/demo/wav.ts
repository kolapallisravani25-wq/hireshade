/**
 * Minimal 16-bit PCM WAV reader for the demo/VAD fixtures (G-014).
 *
 * Only what the fixtures need: RIFF/WAVE, PCM 16-bit, mono. Chunk walking is
 * used (ffmpeg writes LIST chunks) rather than fixed header offsets.
 */

export interface PcmAudio {
  sampleRate: number;
  channels: number;
  samples: Int16Array;
  durationMs: number;
}

function ascii(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

export function parseWav(input: Uint8Array | ArrayBuffer): PcmAudio {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength < 44) throw new Error("parseWav: file too short to be a WAV");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(view, 0, 4) !== "RIFF" || ascii(view, 8, 4) !== "WAVE") {
    throw new Error("parseWav: not a RIFF/WAVE file");
  }

  let fmt: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | null = null;
  let dataOffset = -1;
  let dataLength = -1;

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = ascii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      if (size < 16 || body + 16 > bytes.byteLength) throw new Error("parseWav: truncated fmt chunk");
      fmt = {
        audioFormat: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bitsPerSample: view.getUint16(body + 14, true),
      };
    } else if (id === "data") {
      dataOffset = body;
      dataLength = Math.min(size, bytes.byteLength - body);
      break;
    }
    offset = body + size + (size % 2 === 1 ? 1 : 0);
  }

  if (!fmt) throw new Error("parseWav: missing fmt chunk");
  if (dataOffset < 0 || dataLength < 0) throw new Error("parseWav: missing data chunk");
  if (fmt.audioFormat !== 1) throw new Error(`parseWav: unsupported audio format ${fmt.audioFormat} (need PCM=1)`);
  if (fmt.bitsPerSample !== 16) throw new Error(`parseWav: unsupported bit depth ${fmt.bitsPerSample} (need 16)`);
  if (fmt.channels !== 1) throw new Error(`parseWav: unsupported channel count ${fmt.channels} (need mono)`);
  if (!fmt.sampleRate) throw new Error("parseWav: invalid sample rate");

  const sampleCount = Math.floor(dataLength / 2);
  const samples = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) samples[i] = view.getInt16(dataOffset + i * 2, true);

  return {
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    samples,
    durationMs: (sampleCount / fmt.sampleRate) * 1000,
  };
}
