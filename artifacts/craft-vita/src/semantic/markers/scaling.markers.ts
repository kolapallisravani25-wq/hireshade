// ---------------------------------------------------------------------------
// scaling.markers.ts
// Scaling and performance markers
// ---------------------------------------------------------------------------

import type { SemanticMarker } from "../types/marker.types";

export const SCALING_MARKERS: SemanticMarker[] = [
  {
    id: "scale_scale",
    phrase: "scale",
    type: "phrase",
    weight: 0.88,
    category: "scaling",
  },
  {
    id: "scale_scalable",
    phrase: "scalable",
    type: "phrase",
    weight: 0.90,
    category: "scaling",
  },
  {
    id: "scale_horizontal",
    phrase: "horizontal scaling",
    type: "phrase",
    weight: 0.92,
    category: "scaling",
  },
  {
    id: "scale_vertical",
    phrase: "vertical scaling",
    type: "phrase",
    weight: 0.90,
    category: "scaling",
  },
  {
    id: "scale_scale_out",
    phrase: "scale out",
    type: "phrase",
    weight: 0.92,
    category: "scaling",
  },
  {
    id: "scale_scale_up",
    phrase: "scale up",
    type: "phrase",
    weight: 0.92,
    category: "scaling",
  },
  {
    id: "scale_load_balancing",
    phrase: "load balancing",
    type: "phrase",
    weight: 0.90,
    category: "scaling",
  },
  {
    id: "scale_auto_scaling",
    phrase: "auto scaling",
    type: "phrase",
    weight: 0.90,
    category: "scaling",
  },
  {
    id: "scale_performance",
    phrase: "performance",
    type: "phrase",
    weight: 0.80,
    category: "scaling",
  },
  {
    id: "scale_optimization",
    phrase: "optimization",
    type: "phrase",
    weight: 0.82,
    category: "scaling",
  },
  {
    id: "scale_throughput",
    phrase: "throughput",
    type: "phrase",
    weight: 0.88,
    category: "scaling",
  },
  {
    id: "scale_latency",
    phrase: "latency",
    type: "phrase",
    weight: 0.85,
    category: "scaling",
  },
  {
    id: "scale_million_users",
    phrase: "million users",
    type: "phrase",
    weight: 0.92,
    category: "scaling",
  },
  {
    id: "scale_billions_requests",
    phrase: "billion requests",
    type: "phrase",
    weight: 0.92,
    category: "scaling",
  },
];
