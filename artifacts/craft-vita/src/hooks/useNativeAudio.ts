/**
 * useNativeAudio
 *
 * On macOS, WKWebView (Tauri) never returns audio tracks from getDisplayMedia.
 * This hook starts a native cpal audio capture in Rust via `start_audio_stream`,
 * opens a WebSocket to the localhost server it spawns, and returns a MediaStream
 * containing a single audio track fed by an AudioWorklet so Deepgram (or any
 * MediaRecorder) can consume it exactly like a normal getUserMedia stream.
 *
 * Usage:
 *   const { audioStream, startAudio, stopAudio, devices } = useNativeAudio();
 *
 * Pass `audioStream` as `inputStream` to useDeepgram — it works identically to
 * a mic stream from getUserMedia because it IS a real MediaStream audio track.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

interface AudioMeta {
  sampleRate: number;
  channels: number;
}

export function useNativeAudio(deviceName?: string) {
  const [audioStream, setAudioStream] = useState<MediaStream | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<string[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const metaRef = useRef<AudioMeta | null>(null);

  // Load available audio input device names (so UI can offer a loopback picker)
  useEffect(() => {
    invoke<string[]>("list_audio_devices")
      .then(setDevices)
      .catch(() => setDevices([]));
  }, []);

  const stopAudio = useCallback(async () => {
    wsRef.current?.close();
    wsRef.current = null;

    audioCtxRef.current?.close();
    audioCtxRef.current = null;
    destRef.current = null;
    metaRef.current = null;

    setAudioStream(null);
    setIsCapturing(false);

    try {
      await invoke("stop_audio_stream");
    } catch (_) {
      // best-effort
    }
  }, []);

  const startAudio = useCallback(async (overrideDevice?: string) => {
    await stopAudio();
    setError(null);

    try {
      const port = await invoke<number>("start_audio_stream", {
        deviceName: overrideDevice ?? deviceName ?? null,
      });

      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onmessage = (evt) => {
        // First text frame is the metadata JSON
        if (typeof evt.data === "string") {
          try {
            metaRef.current = JSON.parse(evt.data) as AudioMeta;
            const { sampleRate } = metaRef.current;

            // Create AudioContext at the stream's native sample rate so no
            // resampling artefacts are introduced before Deepgram sees the audio.
            const ctx = new AudioContext({ sampleRate });
            audioCtxRef.current = ctx;
            destRef.current = ctx.createMediaStreamDestination();

            setAudioStream(destRef.current.stream);
            setIsCapturing(true);
          } catch {
            setError("Failed to parse audio metadata from Rust");
          }
          return;
        }

        // Subsequent binary frames are raw interleaved i16 LE PCM
        if (!(evt.data instanceof ArrayBuffer)) return;
        const ctx = audioCtxRef.current;
        const dest = destRef.current;
        const meta = metaRef.current;
        if (!ctx || !dest || !meta) return;

        const raw = new Int16Array(evt.data);
        const channels = meta.channels;
        const frameCount = raw.length / channels;

        const audioBuffer = ctx.createBuffer(channels, frameCount, meta.sampleRate);

        for (let c = 0; c < channels; c++) {
          const channelData = audioBuffer.getChannelData(c);
          for (let i = 0; i < frameCount; i++) {
            channelData[i] = raw[i * channels + c] / 32768;
          }
        }

        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(dest);
        // Schedule immediately — tiny gap between frames is inaudible at 48 kHz
        source.start();
      };

      ws.onerror = () => {
        setError("Audio WebSocket error — check if Rust server started");
        setIsCapturing(false);
      };

      ws.onclose = () => {
        setIsCapturing(false);
      };
    } catch (e: any) {
      setError(e?.message ?? String(e));
      setIsCapturing(false);
    }
  }, [deviceName, stopAudio]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      audioCtxRef.current?.close();
      invoke("stop_audio_stream").catch(() => {});
    };
  }, []);

  return { audioStream, startAudio, stopAudio, isCapturing, error, devices };
}
