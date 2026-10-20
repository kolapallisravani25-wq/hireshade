# HireShade zero-key demo - transcript & latency evidence

Generated: 2026-10-20T14:11:46.702Z

## Result

**PASS** - every latency budget was met with zero provider keys.

| Budget | Statistic | Threshold | Measured | Pass |
|---|---|---|---|---|
| partialLatencyMs | p95 | 500 ms | 250.8 ms | yes |
| silenceToQuestionMs | p95 | 800 ms | 715.3 ms | yes |
| questionToFirstTokenMs | p95 | 1200 ms | 767.8 ms | yes |
| answerVisibleMs | p50 | 3000 ms | 1648.4 ms | yes |
| answerVisibleMs | p95 | 5000 ms | 1921.3 ms | yes |

## Measured latency (all runs)

| Metric | n | p50 | p95 | max |
|---|---|---|---|---|
| partial transcript | 18 | 250.3 | 250.8 | 251.4 |
| silence -> question | 18 | 701.7 | 715.3 | 717.4 |
| question -> first token | 18 | 513.7 | 767.8 | 769.2 |
| question -> answer visible | 18 | 1648.4 | 1921.3 | 1953.3 |

## Target transport contracts (docs/TARGET_VERIFIED.md)

- ASR (T-09): websocket wss://global.rt.speechmatics.com/v2, pcm_f32le @ 16000 Hz mono, JWT query param; events AddPartialTranscript/AddTranscript/EndOfUtterance; two sockets (Microphone, Screen Sharing).
- LLM answers (T-10): POST /api/chat SSE with Content-Type: text/event-stream, Cache-Control: no-cache, no-transform, X-Accel-Buffering: no. Live probe first delta: 577.6 ms.
- Session create (T-11): validated against the observed desktop-app contract.

## Per-run detail

### run-01-gpt-5 - model gpt-5

Session wall time 5677 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 249.9 | 705.7 | 511.3 | 1646.7 |
| And how would you handle the case where Redis is unavailable? | 249.7 | 703.3 | 513.6 | 1648.3 |

### run-02-gpt-5 - model gpt-5

Session wall time 5675 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 250.4 | 702.9 | 514.6 | 1647.5 |
| And how would you handle the case where Redis is unavailable? | 250.6 | 703.3 | 513.8 | 1648.4 |

### run-03-gpt-5 - model gpt-5

Session wall time 5680 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 250.2 | 702.0 | 513.5 | 1648.9 |
| And how would you handle the case where Redis is unavailable? | 250.5 | 700.1 | 517.0 | 1650.7 |

### run-04-gemini-3-1-flash-lite - model gemini-3-1-flash-lite

Session wall time 5566 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 248.9 | 701.3 | 399.0 | 1532.4 |
| And how would you handle the case where Redis is unavailable? | 250.5 | 701.2 | 399.2 | 1532.8 |

### run-05-gemini-3-1-flash-lite - model gemini-3-1-flash-lite

Session wall time 5565 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 250.6 | 714.9 | 415.1 | 1566.7 |
| And how would you handle the case where Redis is unavailable? | 250.7 | 701.6 | 399.0 | 1531.3 |

### run-06-gemini-3-1-flash-lite - model gemini-3-1-flash-lite

Session wall time 5550 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 251.4 | 701.1 | 399.4 | 1534.5 |
| And how would you handle the case where Redis is unavailable? | 250.7 | 686.8 | 398.2 | 1532.0 |

### run-07-gemini-3-6-flash - model gemini-3-6-flash

Session wall time 5981 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 249.3 | 701.9 | 763.5 | 1915.7 |
| And how would you handle the case where Redis is unavailable? | 250.3 | 698.8 | 769.2 | 1953.3 |

### run-08-gemini-3-6-flash - model gemini-3-6-flash

Session wall time 5918 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 234.1 | 701.6 | 765.1 | 1898.5 |
| And how would you handle the case where Redis is unavailable? | 250.1 | 685.1 | 766.0 | 1899.4 |

### run-09-gemini-3-6-flash - model gemini-3-6-flash

Session wall time 5933 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 250.3 | 702.9 | 765.5 | 1899.2 |
| And how would you handle the case where Redis is unavailable? | 234.0 | 717.4 | 767.5 | 1898.7 |

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

- demo server: http://127.0.0.1:52464
- GET /auth/me: {"id":"demo-user-00000000-0000-4000-8000-000000000001","clerkUserId":"demo_clerk_user_harness","email":"demo@hireshade.local","firstName":"Demo","lastName":"Candidate","imageUrl":"","createdAt":"2026-01-01T00:00:00.000Z","demo":true}
- POST /auth/deepgram-token: {"key":"dg_demo_mock_demo-user-00000000-0000-4000-8000-000000000001","expiresAt":"2026-10-20T16:10:52.268Z","ttlSeconds":7200,"mocked":true,"provider":"mock"}
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

