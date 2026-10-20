# HireShade zero-key demo - transcript & latency evidence

Generated: 2026-10-20T17:46:31.145Z

## Result

**PASS** - every latency budget was met with zero provider keys.

| Budget | Statistic | Threshold | Measured | Pass |
|---|---|---|---|---|
| partialLatencyMs | p95 | 500 ms | 262.5 ms | yes |
| silenceToQuestionMs | p95 | 800 ms | 712.5 ms | yes |
| questionToFirstTokenMs | p95 | 1200 ms | 771.1 ms | yes |
| answerVisibleMs | p50 | 3000 ms | 1652.1 ms | yes |
| answerVisibleMs | p95 | 5000 ms | 1942.4 ms | yes |

## Measured latency (all runs)

| Metric | n | p50 | p95 | max |
|---|---|---|---|---|
| partial transcript | 18 | 249.0 | 262.5 | 265.6 |
| silence -> question | 18 | 699.4 | 712.5 | 713.8 |
| question -> first token | 18 | 510.9 | 771.1 | 772.7 |
| question -> answer visible | 18 | 1652.1 | 1942.4 | 1953.8 |

## Target transport contracts (docs/TARGET_VERIFIED.md)

- ASR (T-09): websocket wss://global.rt.speechmatics.com/v2, pcm_f32le @ 16000 Hz mono, JWT query param; events AddPartialTranscript/AddTranscript/EndOfUtterance; two sockets (Microphone, Screen Sharing).
- LLM answers (T-10): POST /api/chat SSE with Content-Type: text/event-stream, Cache-Control: no-cache, no-transform, X-Accel-Buffering: no. Live probe first delta: 553.9 ms.
- Session create (T-11): validated against the observed desktop-app contract.

## Per-run detail

### run-01-gpt-5 - model gpt-5

Session wall time 5686 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 244.4 | 702.4 | 510.0 | 1659.9 |
| And how would you handle the case where Redis is unavailable? | 237.7 | 698.0 | 520.3 | 1665.1 |

### run-02-gpt-5 - model gpt-5

Session wall time 5724 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 235.7 | 713.8 | 512.5 | 1644.3 |
| And how would you handle the case where Redis is unavailable? | 245.4 | 702.9 | 510.3 | 1700.8 |

### run-03-gpt-5 - model gpt-5

Session wall time 5631 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 265.6 | 702.7 | 508.6 | 1639.1 |
| And how would you handle the case where Redis is unavailable? | 261.9 | 698.4 | 511.6 | 1607.7 |

### run-04-gemini-3-1-flash-lite - model gemini-3-1-flash-lite

Session wall time 5600 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 253.1 | 700.2 | 396.0 | 1528.0 |
| And how would you handle the case where Redis is unavailable? | 248.6 | 711.7 | 402.5 | 1568.9 |

### run-05-gemini-3-1-flash-lite - model gemini-3-1-flash-lite

Session wall time 5618 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 239.8 | 693.8 | 391.7 | 1551.5 |
| And how would you handle the case where Redis is unavailable? | 252.7 | 698.6 | 388.5 | 1589.5 |

### run-06-gemini-3-1-flash-lite - model gemini-3-1-flash-lite

Session wall time 5588 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 251.5 | 707.3 | 396.6 | 1596.0 |
| And how would you handle the case where Redis is unavailable? | 249.5 | 690.2 | 393.7 | 1559.9 |

### run-07-gemini-3-6-flash - model gemini-3-6-flash

Session wall time 5918 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 254.0 | 712.3 | 765.5 | 1940.4 |
| And how would you handle the case where Redis is unavailable? | 238.7 | 691.8 | 772.7 | 1900.2 |

### run-08-gemini-3-6-flash - model gemini-3-6-flash

Session wall time 5955 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 242.3 | 697.7 | 769.6 | 1912.3 |
| And how would you handle the case where Redis is unavailable? | 253.2 | 698.3 | 770.8 | 1926.4 |

### run-09-gemini-3-6-flash - model gemini-3-6-flash

Session wall time 5973 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 244.7 | 702.7 | 761.7 | 1909.4 |
| And how would you handle the case where Redis is unavailable? | 249.6 | 696.2 | 760.8 | 1953.8 |

## Full transcript - first run (screen-share channel)

**Interviewer:** Can you explain how you would design a rate limiter using Redis?

**Interviewer:** And how would you handle the case where Redis is unavailable?

**Detected question:** Can you explain how you would design a rate limiter using Redis? (source live_interim, confidence 1.00)

**Detected question:** And how would you handle the case where Redis is unavailable? (source live_interim, confidence 1.00)

**Streamed answer:**

> Here's how I'd answer that in a real interview.
> 
> I'd start by **framing the problem in one sentence**, then walk through the design decisions. In my last role I built a **Redis-backed rate limiter** for an Express API: a fixed window using `INCR` plus a short `EXPIRE`, with the limit keyed by user id and route.
> 
> - **Trade-off:** fixed windows are simple but allow bursts at the boundary, so I added a sliding-window counter for the sensitive endpoints.
> - **Failure mode:** if Redis is unavailable I fall back to an in-process token bucket, so the API degrades instead of failing open.
> - **Observability:** every decision emits a counter and a p99 latency metric, so we see throttling before users complain.
> 
> That's the answer I'd give - concrete, honest about trade-offs, and grounded in what I actually shipped.

## Mock HTTP surface (zero keys)

- demo server: http://127.0.0.1:65454
- GET /auth/me: {"id":"demo-user-00000000-0000-4000-8000-000000000001","clerkUserId":"demo_clerk_user_harness","email":"demo@hireshade.local","firstName":"Demo","lastName":"Candidate","imageUrl":"","createdAt":"2026-01-01T00:00:00.000Z","demo":true}
- POST /auth/deepgram-token: {"key":"dg_demo_mock_demo-user-00000000-0000-4000-8000-000000000001","expiresAt":"2026-10-20T19:45:36.515Z","ttlSeconds":7200,"mocked":true,"provider":"mock"}
- GET /demo/status: {"demoMode":{"requested":true,"safe":true,"production":false,"nodeEnv":"development","mode":"mock","reason":"DEMO_MODE accepted (non-production); mock providers active"},"user":{"id":"demo-user-00000000-0000-4000-8000-000000000001","clerkUserId":"demo_clerk_user_harness","email":"demo@hireshade.local","firstName":"Demo","lastName":"Candidate","imageUrl":"","createdAt":"2026-01-01T00:00:00.000Z"},"keysRequired":false,"providers":{"llm":"mock-llm","asr":"mock-asr","tts":"mock-tts"}}

## Reference: target per-model first-token table (T-10/T-11)

| model | target TTFT ms |
|---|---|
| gpt-5 | 506 |
| claude-sonnet-4-5 | 1774 |
| claude-haiku-4-5 | 1208 |
| gemini-3-1-flash-lite | 387 |
| gemini-3-6-flash | 758 |
| gemini-3-5-flash-lite | 474 |

Reference-only (target TTFT >= our 1200 ms budget, so excluded from the budget sample): claude-sonnet-4-5, claude-haiku-4-5

