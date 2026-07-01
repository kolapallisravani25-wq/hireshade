// ---------------------------------------------------------------------------
// debugging.markers.ts
// Debugging and troubleshooting markers
// ---------------------------------------------------------------------------

import type { SemanticMarker } from "../types/marker.types";

export const DEBUGGING_MARKERS: SemanticMarker[] = [
  {
    id: "debug_bug",
    phrase: "bug",
    type: "phrase",
    weight: 0.88,
    category: "debugging",
  },
  {
    id: "debug_production_issue",
    phrase: "production issue",
    type: "phrase",
    weight: 0.92,
    category: "debugging",
  },
  {
    id: "debug_crash",
    phrase: "crash",
    type: "phrase",
    weight: 0.90,
    category: "debugging",
  },
  {
    id: "debug_memory_leak",
    phrase: "memory leak",
    type: "phrase",
    weight: 0.92,
    category: "debugging",
  },
  {
    id: "debug_slow_query",
    phrase: "slow query",
    type: "phrase",
    weight: 0.88,
    category: "debugging",
  },
  {
    id: "debug_error",
    phrase: "error",
    type: "phrase",
    weight: 0.75,
    category: "debugging",
  },
  {
    id: "debug_exception",
    phrase: "exception",
    type: "phrase",
    weight: 0.82,
    category: "debugging",
  },
  {
    id: "debug_troubleshoot",
    phrase: "troubleshoot",
    type: "phrase",
    weight: 0.88,
    category: "debugging",
  },
  {
    id: "debug_debug",
    phrase: "debug",
    type: "phrase",
    weight: 0.85,
    category: "debugging",
  },
  {
    id: "debug_fix",
    phrase: "fix",
    type: "phrase",
    weight: 0.75,
    category: "debugging",
  },
  {
    id: "debug_resolve",
    phrase: "resolve",
    type: "phrase",
    weight: 0.78,
    category: "debugging",
  },
  {
    id: "debug_stack_trace",
    phrase: "stack trace",
    type: "phrase",
    weight: 0.88,
    category: "debugging",
  },
  {
    id: "debug_log",
    phrase: "log",
    type: "phrase",
    weight: 0.75,
    category: "debugging",
  },
];
