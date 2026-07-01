/**
 * useNativeTabTranscription
 *
 * Transcribes display/tab audio captured by the Rust ScreenCaptureKit backend.
 *
 * Pipeline:
 *   SCKit display audio (Rust) ─► axum WS (localhost) ─► this hook ─► Deepgram WS
 *
 * SCKit taps the OS audio graph for the primary display — no virtual audio
 * device (BlackHole/Loopback) required.  Requires macOS 13.0+ and Screen
 * Recording permission (already granted for screen capture).
 *
 * The first message from the Rust WS is JSON metadata:
 *   { "sampleRate": 48000, "channels": 2 }
 * Every subsequent message is raw interleaved i16 LE PCM (converted from
 * SCKit’s float32 output in Rust).
 * We forward those binary frames directly to Deepgram using
 * encoding=linear16 so Deepgram knows the format.
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/utils";

interface Props {
  apiKey: string;
  model?: string;
  language?: string;
  onTranscript?: (text: string, isFinal: boolean) => void;
  /** When false the hook immediately stops any active stream. */
  enabled: boolean;
}

export function useNativeTabTranscription({
  apiKey,
  model = "nova-3",
  language = "en",
  onTranscript,
  enabled,
}: Props) {
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const rustWsRef = useRef<WebSocket | null>(null);
  const dgWsRef = useRef<WebSocket | null>(null);

  // Ref-based guards — mirrors isConnecting/isTranscribing state but is always
  // the latest value without waiting for a React re-render cycle. This avoids
  // the stale-closure bug where useCallback deps capture an old state snapshot.
  const isConnectingRef = useRef(false);
  const isTranscribingRef = useRef(false);

  // Keep latest props in refs so WS closures never go stale
  const onTranscriptRef = useRef(onTranscript);
  const apiKeyRef = useRef(apiKey);
  const modelRef = useRef(model);
  const languageRef = useRef(language);
  useEffect(() => { onTranscriptRef.current = onTranscript; }, [onTranscript]);
  useEffect(() => { apiKeyRef.current = apiKey; }, [apiKey]);
  useEffect(() => { modelRef.current = model; }, [model]);
  useEffect(() => { languageRef.current = language; }, [language]);

  // Track latest `enabled` value so reconnect closures can read it without stale captures
  const enabledRef = useRef(enabled);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // Last audio metadata received from Rust — needed for DG reconnect
  const audioMetaRef = useRef<{ sampleRate: number; channels: number } | null>(null);
  // Deepgram keepalive interval (prevents 12 s inactivity timeout during silence)
  const dgKeepaliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Reconnect back-off timers — one for the Deepgram WS, one for the Rust capture WS
  const dgReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rustReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearDgTimers = useCallback(() => {
    if (dgKeepaliveRef.current) { clearInterval(dgKeepaliveRef.current); dgKeepaliveRef.current = null; }
    if (dgReconnectRef.current) { clearTimeout(dgReconnectRef.current); dgReconnectRef.current = null; }
    if (rustReconnectRef.current) { clearTimeout(rustReconnectRef.current); rustReconnectRef.current = null; }
  }, []);

  // Stable refs for cross-closure function references
  const openDeepgramWsRef = useRef<((meta: { sampleRate: number; channels: number }) => void) | null>(null);
  const startTranscriptionRef = useRef<() => Promise<void>>(async () => {});

  // ── Close local WS connections WITHOUT stopping the Rust stream ──────────
  // Used when reconnecting — start_display_audio_stream is idempotent so we
  // never need stop+restart just to reconnect the JS-side WebSocket clients.
  // Nulling onclose/onerror before close() prevents spurious reconnect loops.
  const teardownLocalConnections = useCallback(() => {
    clearDgTimers();
    if (rustWsRef.current) {
      rustWsRef.current.onclose = null;
      rustWsRef.current.onerror = null;
      rustWsRef.current.close();
      if (import.meta.env.DEV) console.log("[audio-lifecycle] websocketClosed", { source: "useNativeTabTranscription", target: "rust_ws" });
      rustWsRef.current = null;
    }
    if (dgWsRef.current) {
      dgWsRef.current.onclose = null;
      dgWsRef.current.onerror = null;
      dgWsRef.current.close();
      if (import.meta.env.DEV) console.log("[audio-lifecycle] websocketClosed", { source: "useNativeTabTranscription", target: "deepgram_ws" });
      dgWsRef.current = null;
    }
    audioMetaRef.current = null;
    isConnectingRef.current = false;
    isTranscribingRef.current = false;
    setIsConnecting(false);
    setIsTranscribing(false);
  }, [clearDgTimers]);

  // openDeepgramWs is redefined each render but always stored in the ref so
  // closures inside WS handlers get the freshest version.
  const openDeepgramWs = useCallback((meta: { sampleRate: number; channels: number }) => {
    clearDgTimers();
    // Null handlers BEFORE close so the existing onclose doesn't trigger a reconnect
    if (dgWsRef.current) {
      dgWsRef.current.onclose = null;
      dgWsRef.current.onerror = null;
      dgWsRef.current.close();
      dgWsRef.current = null;
    }

    const dgUrl =
      `wss://api.deepgram.com/v1/listen` +
      `?model=${modelRef.current}` +
      `&punctuate=true` +
      `&interim_results=true` +
      `&language=${languageRef.current}` +
      `&smart_format=true` +
      `&endpointing=500` +
      `&utterance_end_ms=1000` +
      `&vad_events=true` +
      `&encoding=linear16` +
      `&sample_rate=${meta.sampleRate}` +
      `&channels=${meta.channels}` +
      // multichannel=true lets Deepgram transcribe all channels independently;
      // without it stereo loopback audio often returns empty results.
      (meta.channels > 1 ? `&multichannel=true` : ``) +
      `&tag=hireshade-display`;

    const dgWs = new WebSocket(dgUrl, ["token", apiKeyRef.current]);
    dgWsRef.current = dgWs;

    dgWs.onopen = () => {
      isTranscribingRef.current = true;
      isConnectingRef.current = false;
      setIsTranscribing(true);
      setIsConnecting(false);
      // Send KeepAlive every 8 s so Deepgram doesn't close during silence
      // (Deepgram's default inactivity timeout is ~12 s)
      dgKeepaliveRef.current = setInterval(() => {
        if (dgWsRef.current?.readyState === WebSocket.OPEN) {
          dgWsRef.current.send(JSON.stringify({ type: "KeepAlive" }));
        }
      }, 8_000);
    };

    dgWs.onmessage = (dgEvt) => {
      try {
        const data = JSON.parse(dgEvt.data as string);
        if (data.type === "Results" && data.channel?.alternatives?.[0]) {
          const alt = data.channel.alternatives[0];
          const text: string = alt.transcript;
          const isFinal: boolean = data.is_final;

          if (isFinal) {
            if (text.trim()) {
              setTranscript((p) => (p + " " + text).trim());
            }
            setInterimTranscript("");
          } else if (text) {
            setInterimTranscript(text);
          }

          // Only fire callback when there is actual text — empty interim
          // frames are noise and the handler guards against them anyway.
          if (onTranscriptRef.current && text.trim()) {
            onTranscriptRef.current(text, isFinal);
          }
        }
      } catch {
        // Ignore malformed Deepgram frames
      }
    };

    dgWs.onerror = () => {
      setError("Deepgram connection error");
    };

    dgWs.onclose = () => {
      clearDgTimers();
      // Rust stream still alive → transparently reconnect Deepgram.
      // Covers Deepgram's 12 s inactivity close during long silence.
      if (rustWsRef.current?.readyState === WebSocket.OPEN && audioMetaRef.current) {
        dgReconnectRef.current = setTimeout(() => {
          if (rustWsRef.current?.readyState === WebSocket.OPEN && audioMetaRef.current) {
            openDeepgramWsRef.current?.(audioMetaRef.current);
          }
        }, 1_500);
      } else {
        isTranscribingRef.current = false;
        setIsTranscribing(false);
      }
    };
  }, [clearDgTimers]);

  // Keep refs current on every render
  openDeepgramWsRef.current = openDeepgramWs;

  const stopTranscription = useCallback(async () => {
    if (import.meta.env.DEV) console.log("[audio-lifecycle] audioSessionStopped", { source: "useNativeTabTranscription", mode: "system" });
    // teardownLocalConnections handles closing WS and resetting state
    teardownLocalConnections();
    // Explicitly stop the Rust capture stream when the session ends
    if (isTauri()) {
      try {
        await invoke("stop_display_audio_stream");
        if (import.meta.env.DEV) console.log("[audio-lifecycle] nativeStopInvoked", { source: "useNativeTabTranscription", mode: "system" });
      } catch (_) { /* best-effort */ }
    }
  }, [teardownLocalConnections]);

  const startTranscription = useCallback(async () => {
    // Native Tauri audio path only — silently no-op in web browser
    if (!isTauri()) return;
    // Ref-based guard — avoids stale-closure false positives from state deps
    if (isConnectingRef.current || isTranscribingRef.current) return;

    // Close local WS connections WITHOUT stopping the Rust stream.
    // start_display_audio_stream is idempotent — returns existing port if running.
    // Calling stop_display_audio_stream here would kill the stream that page.tsx
    // (running in the main window) already started, since both windows share the
    // same Rust process statics (DISPLAY_AUDIO_RUNNING / DISPLAY_AUDIO_PORT).
    teardownLocalConnections();
    setError(null);
    isConnectingRef.current = true;
    setIsConnecting(true);

    try {
      const port = await invoke<number>("start_display_audio_stream");

      const rustWs = new WebSocket(`ws://127.0.0.1:${port}`);
      rustWs.binaryType = "arraybuffer";
      rustWsRef.current = rustWs;

      rustWs.onmessage = (evt) => {
        // ── Metadata frame (text JSON) ──────────────────────────────────
        if (typeof evt.data === "string") {
          let meta: { sampleRate: number; channels: number };
          try {
            meta = JSON.parse(evt.data);
          } catch {
            setError("Bad metadata from audio server");
            isConnectingRef.current = false;
            setIsConnecting(false);
            return;
          }
          audioMetaRef.current = meta;
          openDeepgramWsRef.current?.(meta);
          return;
        }

        // ── PCM binary frame ────────────────────────────────────────────
        // Forward raw i16 LE PCM bytes directly to Deepgram — zero copy,
        // zero AudioContext, works in WKWebView with no user-gesture needed.
        if (!(evt.data instanceof ArrayBuffer)) return;
        const dg = dgWsRef.current;
        if (dg?.readyState === WebSocket.OPEN) {
          dg.send(evt.data);
        }
      };

      rustWs.onerror = () => {
        setError("Audio capture WebSocket error");
        isConnectingRef.current = false;
        setIsConnecting(false);
      };

      rustWs.onclose = () => {
        clearDgTimers();
        isTranscribingRef.current = false;
        isConnectingRef.current = false;
        setIsTranscribing(false);
        setIsConnecting(false);
        // Auto-restart the full pipeline if the session is still active
        if (enabledRef.current) {
          rustReconnectRef.current = setTimeout(() => {
            if (enabledRef.current) startTranscriptionRef.current();
          }, 2_000);
        }
      };
    } catch (e: any) {
      setError(e?.message ?? String(e));
      isConnectingRef.current = false;
      setIsConnecting(false);
    }
  }, [teardownLocalConnections, clearDgTimers]);

  // Keep refs current on every render
  startTranscriptionRef.current = startTranscription;

  // React to `enabled` changes
  useEffect(() => {
    if (enabled) {
      startTranscription();
    } else {
      stopTranscription();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      teardownLocalConnections();
      if (isTauri()) {
        invoke("stop_display_audio_stream").catch(() => {});
      }
    };
  // teardownLocalConnections is stable (depends only on clearDgTimers which is also stable)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
  }, []);

  return {
    isTranscribing,
    isConnecting,
    transcript,
    interimTranscript,
    error,
    startTranscription,
    stopTranscription,
    clearTranscript,
  };
}
