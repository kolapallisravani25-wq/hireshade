import { useState, useRef, useCallback, useEffect } from "react";

interface UseDeepgramProps {
  apiKey: string;
  model?: string;
  language?: string;
  keyterms?: string[];
  onTranscript?: (text: string, isFinal: boolean) => void;
  inputStream?: MediaStream | null;
}

interface AudioDeviceInfo {
  deviceId: string;
  label: string;
  kind: string;
  groupId?: string;
}

function isHeadsetMicrophone(label: string): boolean {
  return /bluetooth|airpods|headset|earbuds|earphones/i.test(label);
}

function buildMicAudioConstraints(
  preferredDeviceId: string,
  preferredDeviceLabel: string,
): MediaTrackConstraints {
  const headsetMic = isHeadsetMicrophone(preferredDeviceLabel);
  return {
    ...(preferredDeviceId ? { deviceId: { ideal: preferredDeviceId } } : {}),
    echoCancellation: !headsetMic,
    noiseSuppression: !headsetMic,
    autoGainControl: true,
    channelCount: 1,
    sampleRate: 48000,
  };
}

export const useDeepgram = ({
  apiKey,
  model = "nova-3",
  language = "en",
  keyterms = [],
  onTranscript,
  inputStream,
}: UseDeepgramProps) => {
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [currentDeviceLabel, setCurrentDeviceLabel] = useState<string>("");

  const socketRef = useRef<WebSocket | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Cached mic stream — persists across WS retries so getUserMedia (and the
  // macOS permission dialog) is only triggered once per session.
  const cachedMicStreamRef = useRef<MediaStream | null>(null);
  const isStartingRef = useRef(false);
  const ownsStreamRef = useRef(false);
  // Ref mirror of isTranscribing — avoids stale-closure bugs in retry callbacks.
  // When `startTranscription` is referenced inside an `onclose` handler, the
  // React state value is frozen at the time the useCallback was created.
  // Reading `isTranscribingRef.current` always reflects the live value.
  const isTranscribingRef = useRef(false);
  // KeepAlive interval — sends a heartbeat every 8 s to prevent Deepgram from
  // closing the WS after 12 s of microphone silence.
  const keepAliveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracks intentional stop so auto-retry doesn't restart after stopTranscription().
  const intentionalStopRef = useRef(false);
  // Retry timer handle — cleared on intentional stop.
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const MAX_RETRIES = 5;

  // Device enumeration and selection logic
  const enumerateAudioDevices = useCallback(async (): Promise<AudioDeviceInfo[]> => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices
        .filter((device) => device.kind === "audioinput")
        .map((device) => ({
          deviceId: device.deviceId,
          label: device.label || "Unknown Microphone",
          kind: device.kind,
          groupId: device.groupId,
        }));
      
      console.log("[useDeepgram] Enumerated audio devices:", audioInputs.length);
      audioInputs.forEach((device) => {
        console.log("[useDeepgram] - Device:", device.label, "ID:", device.deviceId);
      });
      
      return audioInputs;
    } catch (err) {
      console.error("[useDeepgram] Error enumerating devices:", err);
      return [];
    }
  }, []);

  // Select preferred microphone based on priority
  const selectPreferredDevice = useCallback((devices: AudioDeviceInfo[]): string => {
    if (devices.length === 0) return "";

    // Check if previously selected device still exists
    const savedDeviceId = localStorage.getItem("hireshade_preferred_mic");
    if (savedDeviceId) {
      const savedDevice = devices.find((d) => d.deviceId === savedDeviceId);
      if (savedDevice) {
        console.log("[useDeepgram] Restoring saved device:", savedDevice.label);
        return savedDevice.deviceId;
      }
    }

    // Priority 1: Bluetooth headsets / AirPods (detect by label keywords)
    const bluetoothDevice = devices.find((d) =>
      /bluetooth|airpods|headset|earbuds|earphones/i.test(d.label)
    );
    if (bluetoothDevice) {
      console.log("[useDeepgram] Selected Bluetooth/headset device:", bluetoothDevice.label);
      return bluetoothDevice.deviceId;
    }

    // Priority 2: USB microphones (detect by label keywords)
    const usbDevice = devices.find((d) => /usb|external/i.test(d.label));
    if (usbDevice) {
      console.log("[useDeepgram] Selected USB device:", usbDevice.label);
      return usbDevice.deviceId;
    }

    // Priority 3: Default device (browser's default)
    const defaultDevice = devices.find((d) => d.deviceId === "default");
    if (defaultDevice) {
      console.log("[useDeepgram] Selected default device:", defaultDevice.label);
      return defaultDevice.deviceId;
    }

    // Priority 4: First available device (built-in)
    console.log("[useDeepgram] Selected first available device:", devices[0].label);
    return devices[0].deviceId;
  }, []);

  // Load and enumerate devices on mount
  useEffect(() => {
    const loadDevices = async () => {
      const devices = await enumerateAudioDevices();
      setAudioDevices(devices);
      
      const preferredId = selectPreferredDevice(devices);
      if (preferredId) {
        setSelectedDeviceId(preferredId);
        const device = devices.find((d) => d.deviceId === preferredId);
        if (device) {
          setCurrentDeviceLabel(device.label);
        }
      }
    };

    loadDevices();

    // Listen for device changes
    const handleDeviceChange = async () => {
      console.log("[useDeepgram] Device change detected");
      const devices = await enumerateAudioDevices();
      setAudioDevices(devices);
      
      const preferredId = selectPreferredDevice(devices);
      if (preferredId && preferredId !== selectedDeviceIdRef.current) {
        console.log("[useDeepgram] Preferred device changed, will use on next start");
        setSelectedDeviceId(preferredId);
        const device = devices.find((d) => d.deviceId === preferredId);
        if (device) {
          setCurrentDeviceLabel(device.label);
        }
      }
    };

    // navigator.mediaDevices is undefined in insecure (non-HTTPS) contexts —
    // guard so the whole app doesn't crash when mic features are unavailable.
    if (!navigator.mediaDevices) return;

    navigator.mediaDevices.addEventListener("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener("devicechange", handleDeviceChange);
    };
  }, [enumerateAudioDevices, selectPreferredDevice]);

  // Keep the ref in sync with React state so closures always read current value.
  isTranscribingRef.current = isTranscribing;

  const selectedDeviceIdRef = useRef(selectedDeviceId);
  useEffect(() => { selectedDeviceIdRef.current = selectedDeviceId; }, [selectedDeviceId]);
  const audioDevicesRef = useRef<AudioDeviceInfo[]>(audioDevices);
  useEffect(() => { audioDevicesRef.current = audioDevices; }, [audioDevices]);

  const startTranscription = useCallback(async () => {
    // Use the ref (not the closure-captured state) so retries always get the
    // live value even when called from a stale setTimeout closure.
    if (isTranscribingRef.current || isStartingRef.current || socketRef.current) return;

    // Guard: missing API key produces an unhelpful WebSocket protocol error;
    // surface a clear message instead.
    if (!apiKey) {
      setError("Deepgram API key is not configured");
      return;
    }

    // Only reset intentional-stop and retry-count on an EXPLICIT start call
    // (i.e., when no retries are in progress). Retries must NOT reset retryCount
    // or the back-off / MAX_RETRIES guard never takes effect.
    if (retryCountRef.current === 0) {
      intentionalStopRef.current = false;
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    try {
      isStartingRef.current = true;
      setIsConnecting(true);
      setError(null);

      let stream: MediaStream;
      if (inputStream) {
        // Create a new stream with only audio tracks to avoid MediaRecorder issues with video
        const audioTracks = inputStream.getAudioTracks();
        if (audioTracks.length === 0) {
          console.error(
            "Deepgram: No audio tracks found in provided inputStream.",
          );
          setError(
            "No audio in share. When the screen picker appears, enable the 'Share tab audio' or 'Include audio' toggle, then click Change Tab to restart.",
          );
          setIsConnecting(false);
          isStartingRef.current = false;
          return;
        }
        stream = new MediaStream(audioTracks);
        ownsStreamRef.current = false;
      } else {
        // Reuse the cached stream if its tracks are still live — this prevents
        // repeated macOS permission dialogs when the WebSocket retries after a
        // network error, because getUserMedia is only called the first time.
        const cached = cachedMicStreamRef.current;
        const isCachedLive =
          cached !== null &&
          cached.getAudioTracks().some((t) => t.readyState === "live");
        if (isCachedLive) {
          stream = cached!;
        } else {
          const preferredDeviceId = selectedDeviceIdRef.current;
          const preferredDeviceLabel =
            audioDevicesRef.current.find((device) => device.deviceId === preferredDeviceId)?.label ||
            currentDeviceLabel;
          const audioConstraints = buildMicAudioConstraints(
            preferredDeviceId,
            preferredDeviceLabel,
          );
          stream = await navigator.mediaDevices.getUserMedia({
            audio: audioConstraints,
          });
          if (import.meta.env.DEV) {
            const track = stream.getAudioTracks()[0];
            console.log("[useDeepgram] Mic capture constraints applied", {
              deviceLabel: preferredDeviceLabel || "unknown",
              headsetMic: isHeadsetMicrophone(preferredDeviceLabel),
              requested: audioConstraints,
              actual: track?.getSettings(),
            });
          }
          cachedMicStreamRef.current = stream;
        }
        ownsStreamRef.current = true;
      }

      streamRef.current = stream;

      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 128000, // High quality audio encoding for better accuracy
      });
      mediaRecorderRef.current = mediaRecorder;

      // URL parameters — keep this list minimal and validated.
      // Removed `endpointing`, `utterance_end_ms`, `vad_events` because
      // Deepgram rejects values below its documented minimums (e.g.
      // utterance_end_ms must be >= 1000) with an HTTP 400 on the WS upgrade,
      // which surfaces in the browser only as the unhelpful generic
      // "WebSocket connection failed" error. Audio is sent as WebM/Opus, so
      // we do NOT specify encoding/sample_rate — Deepgram auto-detects them
      // from the container.
      const params = new URLSearchParams({
        model,
        language,
        punctuate: "true",
        interim_results: "true",
        smart_format: "true",
        tag: "hireshade",
      });
      if (model.toLowerCase().startsWith("nova-3")) {
        for (const term of keyterms) {
          const normalized = (term || "").trim();
          if (!normalized) continue;
          params.append("keyterm", normalized);
        }
      }
      const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

      // Browser WebSocket cannot set custom headers, so Deepgram's
      // subprotocol-based auth is the only option here. Keep this list in
      // sync with the Rust desktop path's `Authorization: Token <key>` header.
      const socket = new WebSocket(url, ["token", apiKey]);
      socketRef.current = socket;

      socket.onopen = () => {
        if (!mediaRecorderRef.current || socket !== socketRef.current) {
          socket.close();
          return;
        }
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
            socket.send(event.data);
          }
        };
        // Send moderately sized chunks to avoid WebSocket/backpressure stalls while staying low-latency.
        mediaRecorder.start(250);

        // Successfully connected — reset retry counter so next failure gets
        // the full back-off budget again.
        retryCountRef.current = 0;
        intentionalStopRef.current = false;

        // KeepAlive: prevent Deepgram from closing the WS after 12 s of silence.
        if (keepAliveTimerRef.current) clearInterval(keepAliveTimerRef.current);
        keepAliveTimerRef.current = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: "KeepAlive" }));
          }
        }, 8_000);

        setIsTranscribing(true);
        isTranscribingRef.current = true;
        setIsConnecting(false);
        isStartingRef.current = false;
        setError(null);
      };

      socket.onmessage = (event) => {
        if (socket !== socketRef.current) return;
        const data = JSON.parse(event.data);

        if (data.type === "Results" && data.channel?.alternatives?.[0]) {
          const alternative = data.channel.alternatives[0];
          const newText = alternative.transcript;
          const isFinal = data.is_final;

          if (isFinal) {
            if (newText.trim()) {
              setTranscript((prev) => (prev + " " + newText).trim());
            }
            setInterimTranscript("");
          } else if (newText) {
            setInterimTranscript(newText);
          }

          if (onTranscript && (newText.trim() || !isFinal)) {
            onTranscript(newText, isFinal);
          }
        }
      };

      socket.onerror = () => {
        // onerror is ALWAYS followed by onclose — do NOT touch socketRef here.
        // If we null socketRef.current here, the subsequent onclose fires with
        // `socket !== null` (socketRef is null), trips the identity guard and
        // returns early — completely skipping the retry logic.
        // Just log; onclose owns all cleanup and retry decisions.
        if (socket !== socketRef.current) return;
        console.error("Deepgram WebSocket error (onclose will handle retry)");
      };

      socket.onclose = (evt: CloseEvent) => {
        // Only handle if this is still the active socket (guards against stale
        // closures when a new socket is created mid-flight).
        if (socket !== socketRef.current) return;

        // Clear KeepAlive before anything else.
        if (keepAliveTimerRef.current) {
          clearInterval(keepAliveTimerRef.current);
          keepAliveTimerRef.current = null;
        }

        // Clear the ref — this socket is gone regardless of close reason.
        socketRef.current = null;
        setIsTranscribing(false);
        isTranscribingRef.current = false;
        setIsConnecting(false);
        isStartingRef.current = false;

        if (mediaRecorder.state === "recording") {
          mediaRecorder.stop();
        }
        mediaRecorderRef.current = null;

        // Intentional stop — do not retry.
        if (intentionalStopRef.current) return;

        // 1000 = normal closure (we sent CloseStream) — do not retry.
        if (evt.code === 1000) return;

        // 1008 = Policy Violation: invalid/expired API key, or unsupported
        // parameter for the chosen model — no point retrying.
        if (evt.code === 1008) {
          setError(
            apiKey
              ? "Deepgram auth failed — check VITE_DEEPGRAM_API_KEY or account credits"
              : "Deepgram API key is missing — set VITE_DEEPGRAM_API_KEY"
          );
          return;
        }

        // Abnormal closure (network error, server rejected, etc.) — show error
        // and schedule a retry with exponential back-off.
        // NOTE: retryTimerRef passes `startTranscription` by reference via the
        // module-level closure — not the stale `useCallback` instance captured
        // at socket creation time. isTranscribingRef.current is always live so
        // the guard inside startTranscription always reads the correct value.
        setError("Connection error — retrying...");

        if (retryCountRef.current < MAX_RETRIES) {
          const delay = Math.min(1000 * 2 ** retryCountRef.current, 15_000);
          retryCountRef.current += 1;
          retryTimerRef.current = setTimeout(() => {
            if (!intentionalStopRef.current) {
              setError(null);
              // Read startTranscriptionRef so we always invoke the latest
              // (non-stale) version of the function.
              startTranscriptionRef.current();
            }
          }, delay);
        } else {
          retryCountRef.current = 0; // reset so manual restart works
          setError("Mic connection failed — please reload or check your internet");
        }
      };
    } catch (err) {
      if (isStartingRef.current) {
        console.error("Deepgram Error:", err);
        setError((err as Error).message);
        setIsConnecting(false);
        isStartingRef.current = false;
        setIsTranscribing(false);
      }
    }
  // isTranscribing intentionally removed from deps — use isTranscribingRef.current
  // for the guard so retry closures always read the live value, not a stale snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, model, language, keyterms, onTranscript, inputStream, currentDeviceLabel]);

  // Keep a stable ref to the latest startTranscription so retry timers created
  // inside stale onclose closures always call the current version.
  const startTranscriptionRef = useRef(startTranscription);
  useEffect(() => { startTranscriptionRef.current = startTranscription; }, [startTranscription]);

  const stopTranscription = useCallback(() => {
    if (import.meta.env.DEV) console.log("[audio-lifecycle] audioSessionStopped", { source: "useDeepgram", mode: "mic" });
    intentionalStopRef.current = true;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (keepAliveTimerRef.current) {
      clearInterval(keepAliveTimerRef.current);
      keepAliveTimerRef.current = null;
    }
    retryCountRef.current = 0;
    isStartingRef.current = false;
    if (socketRef.current) {
      if (socketRef.current.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "CloseStream" }));
      }
      socketRef.current.close();
      if (import.meta.env.DEV) console.log("[audio-lifecycle] websocketClosed", { source: "useDeepgram", mode: "mic" });
      socketRef.current = null;
    }
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      if (import.meta.env.DEV) console.log("[audio-lifecycle] mediaRecorderStopped", { source: "useDeepgram", mode: "mic" });
    }
    mediaRecorderRef.current = null;

    if (streamRef.current && ownsStreamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
    }
    streamRef.current = null;
    // Release the cached mic stream so the next manual start gets a fresh one.
    if (cachedMicStreamRef.current) {
      cachedMicStreamRef.current.getTracks().forEach((track) => track.stop());
      cachedMicStreamRef.current = null;
      if (import.meta.env.DEV) console.log("[audio-lifecycle] mediaTracksReleased", { source: "useDeepgram", mode: "mic" });
    }

    setIsTranscribing(false);
    setIsConnecting(false);
  }, []);

  const clearTranscript = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
  }, []);

  // Handle inputStream changes:
  // When the screen-share stream is replaced (user picks a new tab / audio toggled),
  // tear down the existing session so the caller's auto-start effect can restart
  // cleanly with the new inputStream.
  const prevInputStreamRef = useRef<MediaStream | null | undefined>(undefined);
  useEffect(() => {
    const prev = prevInputStreamRef.current;
    prevInputStreamRef.current = inputStream;

    // Only react to actual stream changes (not the initial mount)
    if (prev === undefined) return;

    if (prev !== inputStream) {
      // Stream swapped — stop so the auto-start effect can restart with new audio
      stopTranscription();
    }
  }, [inputStream, stopTranscription]);

  useEffect(() => {
    return () => {
      stopTranscription();
    };
  }, [stopTranscription]);

  return {
    transcript,
    interimTranscript,
    isTranscribing,
    isConnecting,
    error,
    startTranscription,
    stopTranscription,
    clearTranscript,
    audioDevices,
    selectedDeviceId,
    currentDeviceLabel,
  };
};
