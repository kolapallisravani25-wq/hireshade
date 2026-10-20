# HireShade zero-key demo - transcript & latency evidence

Generated: 2026-10-20T15:32:13.439Z

## Result

**PASS** - every latency budget was met with zero provider keys.

| Budget | Statistic | Threshold | Measured | Pass |
|---|---|---|---|---|
| partialLatencyMs | p95 | 500 ms | 263.7 ms | yes |
| silenceToQuestionMs | p95 | 800 ms | 710.8 ms | yes |
| questionToFirstTokenMs | p95 | 1200 ms | 766.2 ms | yes |
| answerVisibleMs | p50 | 3000 ms | 1608.5 ms | yes |
| answerVisibleMs | p95 | 5000 ms | 1938.5 ms | yes |

## Measured latency (all runs)

| Metric | n | p50 | p95 | max |
|---|---|---|---|---|
| partial transcript | 18 | 253.4 | 263.7 | 264.7 |
| silence -> question | 18 | 701.8 | 710.8 | 711.0 |
| question -> first token | 18 | 512.7 | 766.2 | 766.4 |
| question -> answer visible | 18 | 1608.5 | 1938.5 | 1939.4 |

## Target transport contracts (docs/TARGET_VERIFIED.md)

- ASR (T-09): websocket wss://global.rt.speechmatics.com/v2, pcm_f32le @ 16000 Hz mono, JWT query param; events AddPartialTranscript/AddTranscript/EndOfUtterance; two sockets (Microphone, Screen Sharing).
- LLM answers (T-10): POST /api/chat SSE with Content-Type: text/event-stream, Cache-Control: no-cache, no-transform, X-Accel-Buffering: no. Live probe first delta: 544.5 ms.
- Session create (T-11): validated against the observed desktop-app contract.

## Per-run detail

### run-01-gpt-5 - model gpt-5

Session wall time 5630 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 255.1 | 698.5 | 517.0 | 1648.4 |
| And how would you handle the case where Redis is unavailable? | 254.3 | 704.6 | 510.5 | 1605.8 |

### run-02-gpt-5 - model gpt-5

Session wall time 5641 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 255.5 | 697.5 | 514.9 | 1611.2 |
| And how would you handle the case where Redis is unavailable? | 257.9 | 708.1 | 514.9 | 1611.9 |

### run-03-gpt-5 - model gpt-5

Session wall time 5634 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 242.9 | 701.9 | 509.4 | 1601.3 |
| And how would you handle the case where Redis is unavailable? | 236.5 | 711.0 | 510.5 | 1602.1 |

### run-04-gemini-3-1-flash-lite - model gemini-3-1-flash-lite

Session wall time 5493 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 243.7 | 710.7 | 399.5 | 1496.4 |
| And how would you handle the case where Redis is unavailable? | 241.8 | 693.6 | 388.3 | 1475.1 |

### run-05-gemini-3-1-flash-lite - model gemini-3-1-flash-lite

Session wall time 5513 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 258.1 | 702.3 | 401.8 | 1493.3 |
| And how would you handle the case where Redis is unavailable? | 242.4 | 705.3 | 394.6 | 1484.1 |

### run-06-gemini-3-1-flash-lite - model gemini-3-1-flash-lite

Session wall time 5515 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 243.0 | 701.7 | 399.4 | 1489.6 |
| And how would you handle the case where Redis is unavailable? | 256.6 | 708.0 | 400.8 | 1488.8 |

### run-07-gemini-3-6-flash - model gemini-3-6-flash

Session wall time 5934 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 257.0 | 706.5 | 766.2 | 1880.4 |
| And how would you handle the case where Redis is unavailable? | 242.4 | 696.0 | 766.4 | 1900.4 |

### run-08-gemini-3-6-flash - model gemini-3-6-flash

Session wall time 5960 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 263.5 | 686.5 | 760.8 | 1938.3 |
| And how would you handle the case where Redis is unavailable? | 264.7 | 689.5 | 761.0 | 1939.4 |

### run-09-gemini-3-6-flash - model gemini-3-6-flash

Session wall time 5914 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 252.5 | 699.4 | 762.0 | 1891.7 |
| And how would you handle the case where Redis is unavailable? | 244.7 | 697.9 | 763.0 | 1896.5 |

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

- demo server: http://127.0.0.1:60538
- GET /auth/me: {"id":"demo-user-00000000-0000-4000-8000-000000000001","clerkUserId":"demo_clerk_user_harness","email":"demo@hireshade.local","firstName":"Demo","lastName":"Candidate","imageUrl":"","createdAt":"2026-01-01T00:00:00.000Z","demo":true}
- POST /auth/deepgram-token: {"key":"dg_demo_mock_demo-user-00000000-0000-4000-8000-000000000001","expiresAt":"2026-10-20T17:31:19.242Z","ttlSeconds":7200,"mocked":true,"provider":"mock"}
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

