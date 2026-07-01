import { useState, useEffect, useRef, useCallback } from "react";

// WKWebView (Tauri/macOS) enforces that getDisplayMedia MUST originate from a
// direct user gesture (button click). Calling it from useEffect — even
// indirectly — throws InvalidStateError. autoStart is therefore removed; the
// caller must invoke startShare() from an onClick handler.
export const useScreenShare = () => {
  const [stream, setStream] = useState<MediaStream | null>(null);

  // Keep a ref to the latest stream so the callback ref can access it
  // synchronously when the video element mounts/remounts.
  const streamRef = useRef<MediaStream | null>(null);
  // Internal ref to the actual DOM node (used by captureScreenshot)
  const videoNodeRef = useRef<HTMLVideoElement | null>(null);

  // Callback ref — React calls this whenever the <video> element
  // mounts OR unmounts (e.g. after a fullscreen toggle remounts it).
  // This guarantees srcObject is always re-attached to the live node.
  const videoRef = useCallback((node: HTMLVideoElement | null) => {
    videoNodeRef.current = node;
    if (node && streamRef.current) {
      node.srcObject = streamRef.current;
      node.play().catch((err) => console.error("Video play error:", err));
    }
  }, []);

  // Keep streamRef in sync and update the video element when stream changes
  useEffect(() => {
    streamRef.current = stream;
    if (videoNodeRef.current && stream) {
      videoNodeRef.current.srcObject = stream;
      videoNodeRef.current
        .play()
        .catch((err) => console.error("Video play error:", err));
    }
  }, [stream]);

  const startShare = useCallback(async () => {
    try {
      const displayMediaOptions: any = {
        video: true,
        // `audio: true` is the standard constraint that WKWebView (Tauri/macOS)
        // supports. Chrome-only `systemAudio: "include"` is silently ignored by
        // WKWebView, causing the stream to have no audio tracks.
        // With `audio: true` the OS picker shows an "Include audio" / "Share tab
        // audio" toggle — the user must enable it to get tab/system audio.
        audio: true,
      };

      // Create a CaptureController if supported to prevent focus switching
      const controller =
        typeof (window as any).CaptureController !== "undefined"
          ? new (window as any).CaptureController()
          : null;

      if (controller) {
        displayMediaOptions.controller = controller;
      }

      const mediaStream =
        await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

      // Prevent the browser from automatically focusing the shared tab/window
      if (controller && controller.setFocusBehavior) {
        try {
          controller.setFocusBehavior("no-focus-change");
        } catch (err) {
          console.warn("CaptureController.setFocusBehavior error:", err);
        }
      }

      setStream((prevStream) => {
        if (prevStream) {
          prevStream.getTracks().forEach((track) => track.stop());
        }
        return mediaStream;
      });
    } catch (err) {
      console.error("Screen share error:", err);
    }
  }, []);

  // Capture a screenshot from the video element
  const captureScreenshot = useCallback((): Promise<Blob | null> => {
    return new Promise((resolve) => {
      if (!videoNodeRef.current) return resolve(null);
      const canvas = document.createElement("canvas");
      canvas.width = videoNodeRef.current.videoWidth;
      canvas.height = videoNodeRef.current.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.drawImage(videoNodeRef.current, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", 0.95);
    });
  }, []);

  // Cleanup on unmount — stop any active tracks
  useEffect(() => {
    return () => {
      setStream((prevStream) => {
        if (prevStream) {
          prevStream.getTracks().forEach((track) => track.stop());
        }
        return null;
      });
    };
  }, []);

  return {
    stream,
    videoRef,
    startShare,
    captureScreenshot,
  };
};
