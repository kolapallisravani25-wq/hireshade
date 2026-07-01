// ---------------------------------------------------------------------------
// noise.markers.ts
// Noise markers (negative scoring, reduces confidence)
// ---------------------------------------------------------------------------

import type { SemanticMarker } from "../types/marker.types";

export const NOISE_MARKERS: SemanticMarker[] = [
  {
    id: "noise_stt_artifact",
    regex: /(.+)\1\1/i, // Repeated word pattern (STT artifact)
    type: "regex",
    weight: 0.95,
    category: "noise",
    negative: true,
  },
  {
    id: "noise_very_short",
    regex: /^.{0,10}$/,
    type: "regex",
    weight: 0.90,
    category: "noise",
    negative: true,
  },
  {
    id: "noise_only_filler",
    regex: /^(um|uh|mm|ah|oh|hmm)+$/i,
    type: "regex",
    weight: 0.95,
    category: "noise",
    negative: true,
  },
];
