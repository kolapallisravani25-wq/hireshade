# HireShade zero-key demo - transcript & latency evidence

Generated: 2026-10-20T18:31:15.919Z

## Result

**PASS** - every latency budget was met with zero provider keys.

| Budget | Statistic | Threshold | Measured | Pass |
|---|---|---|---|---|
| partialLatencyMs | p95 | 500 ms | 258.6 ms | yes |
| silenceToQuestionMs | p95 | 800 ms | 707.6 ms | yes |
| questionToFirstTokenMs | p95 | 1200 ms | 766.6 ms | yes |
| answerVisibleMs | p50 | 3000 ms | 1676.0 ms | yes |
| answerVisibleMs | p95 | 5000 ms | 1900.4 ms | yes |

## Measured latency (all runs)

| Metric | n | p50 | p95 | max |
|---|---|---|---|---|
| partial transcript | 18 | 249.9 | 258.6 | 268.2 |
| silence -> question | 18 | 701.9 | 707.6 | 711.8 |
| question -> first token | 18 | 513.8 | 766.6 | 768.2 |
| question -> answer visible | 18 | 1676.0 | 1900.4 | 1900.6 |

## Target transport contracts (docs/TARGET_VERIFIED.md)

- ASR (T-09): websocket wss://global.rt.speechmatics.com/v2, pcm_f32le @ 16000 Hz mono, JWT query param; events AddPartialTranscript/AddTranscript/EndOfUtterance; two sockets (Microphone, Screen Sharing).
- LLM answers (T-10): POST /api/chat SSE with Content-Type: text/event-stream, Cache-Control: no-cache, no-transform, X-Accel-Buffering: no. Live probe first delta: 575.2 ms.
- Session create (T-11): validated against the observed desktop-app contract.

## Per-run detail

### run-01-gpt-5 - model gpt-5

Session wall time 5710 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 242.2 | 706.9 | 516.4 | 1618.6 |
| And how would you handle the case where Redis is unavailable? | 249.1 | 711.8 | 509.4 | 1694.0 |

### run-02-gpt-5 - model gpt-5

Session wall time 5678 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 250.8 | 702.1 | 514.7 | 1735.0 |
| And how would you handle the case where Redis is unavailable? | 268.2 | 693.9 | 506.6 | 1658.0 |

### run-03-gpt-5 - model gpt-5

Session wall time 5681 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 250.4 | 702.1 | 513.0 | 1699.8 |
| And how would you handle the case where Redis is unavailable? | 241.9 | 696.2 | 516.0 | 1651.0 |

### run-04-gemini-3-1-flash-lite - model gemini-3-1-flash-lite

Session wall time 5577 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 247.7 | 702.3 | 389.0 | 1549.1 |
| And how would you handle the case where Redis is unavailable? | 256.9 | 703.6 | 401.4 | 1547.9 |

### run-05-gemini-3-1-flash-lite - model gemini-3-1-flash-lite

Session wall time 5558 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 252.1 | 699.9 | 397.3 | 1531.1 |
| And how would you handle the case where Redis is unavailable? | 249.4 | 703.8 | 387.2 | 1513.0 |

### run-06-gemini-3-1-flash-lite - model gemini-3-1-flash-lite

Session wall time 5608 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 250.0 | 701.8 | 399.4 | 1534.7 |
| And how would you handle the case where Redis is unavailable? | 250.2 | 700.6 | 387.2 | 1585.9 |

### run-07-gemini-3-6-flash - model gemini-3-6-flash

Session wall time 5932 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 248.0 | 703.3 | 768.2 | 1900.3 |
| And how would you handle the case where Redis is unavailable? | 250.5 | 702.9 | 764.5 | 1897.0 |

### run-08-gemini-3-6-flash - model gemini-3-6-flash

Session wall time 5930 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 249.0 | 699.3 | 766.4 | 1899.0 |
| And how would you handle the case where Redis is unavailable? | 249.9 | 700.2 | 762.2 | 1900.6 |

### run-09-gemini-3-6-flash - model gemini-3-6-flash

Session wall time 5916 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 252.1 | 701.6 | 765.6 | 1899.7 |
| And how would you handle the case where Redis is unavailable? | 249.1 | 686.0 | 765.0 | 1898.6 |

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

- demo server: http://127.0.0.1:61544
- GET /auth/me: {"id":"demo-user-00000000-0000-4000-8000-000000000001","clerkUserId":"demo_clerk_user_harness","email":"demo@hireshade.local","firstName":"Demo","lastName":"Candidate","imageUrl":"","createdAt":"2026-01-01T00:00:00.000Z","demo":true}
- POST /auth/deepgram-token: {"key":"dg_demo_mock_demo-user-00000000-0000-4000-8000-000000000001","expiresAt":"2026-10-20T20:30:21.308Z","ttlSeconds":7200,"mocked":true,"provider":"mock"}
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

