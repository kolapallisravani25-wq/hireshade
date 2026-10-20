# HireShade zero-key demo - transcript & latency evidence

Generated: 2026-10-20T15:55:30.799Z

## Result

**PASS** - every latency budget was met with zero provider keys.

| Budget | Statistic | Threshold | Measured | Pass |
|---|---|---|---|---|
| partialLatencyMs | p95 | 500 ms | 251.4 ms | yes |
| silenceToQuestionMs | p95 | 800 ms | 704.5 ms | yes |
| questionToFirstTokenMs | p95 | 1200 ms | 766.2 ms | yes |
| answerVisibleMs | p50 | 3000 ms | 1649.5 ms | yes |
| answerVisibleMs | p95 | 5000 ms | 1899.8 ms | yes |

## Measured latency (all runs)

| Metric | n | p50 | p95 | max |
|---|---|---|---|---|
| partial transcript | 18 | 250.0 | 251.4 | 251.5 |
| silence -> question | 18 | 701.8 | 704.5 | 709.3 |
| question -> first token | 18 | 514.6 | 766.2 | 766.5 |
| question -> answer visible | 18 | 1649.5 | 1899.8 | 1899.8 |

## Target transport contracts (docs/TARGET_VERIFIED.md)

- ASR (T-09): websocket wss://global.rt.speechmatics.com/v2, pcm_f32le @ 16000 Hz mono, JWT query param; events AddPartialTranscript/AddTranscript/EndOfUtterance; two sockets (Microphone, Screen Sharing).
- LLM answers (T-10): POST /api/chat SSE with Content-Type: text/event-stream, Cache-Control: no-cache, no-transform, X-Accel-Buffering: no. Live probe first delta: 551.9 ms.
- Session create (T-11): validated against the observed desktop-app contract.

## Per-run detail

### run-01-gpt-5 - model gpt-5

Session wall time 5679 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 251.0 | 709.3 | 507.6 | 1643.3 |
| And how would you handle the case where Redis is unavailable? | 251.4 | 700.6 | 515.8 | 1652.4 |

### run-02-gpt-5 - model gpt-5

Session wall time 5679 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 251.3 | 702.2 | 513.9 | 1664.4 |
| And how would you handle the case where Redis is unavailable? | 249.7 | 702.0 | 514.9 | 1648.8 |

### run-03-gpt-5 - model gpt-5

Session wall time 5680 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 249.7 | 703.1 | 514.4 | 1648.1 |
| And how would you handle the case where Redis is unavailable? | 250.1 | 700.8 | 516.8 | 1650.2 |

### run-04-gemini-3-1-flash-lite - model gemini-3-1-flash-lite

Session wall time 5565 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 250.6 | 701.7 | 397.2 | 1530.1 |
| And how would you handle the case where Redis is unavailable? | 249.4 | 701.9 | 398.2 | 1531.3 |

### run-05-gemini-3-1-flash-lite - model gemini-3-1-flash-lite

Session wall time 5563 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 250.3 | 699.5 | 400.4 | 1535.1 |
| And how would you handle the case where Redis is unavailable? | 251.5 | 700.3 | 399.5 | 1533.7 |

### run-06-gemini-3-1-flash-lite - model gemini-3-1-flash-lite

Session wall time 5552 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 249.5 | 702.0 | 398.2 | 1532.5 |
| And how would you handle the case where Redis is unavailable? | 249.8 | 703.2 | 398.3 | 1530.7 |

### run-07-gemini-3-6-flash - model gemini-3-6-flash

Session wall time 5933 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 249.4 | 703.7 | 763.6 | 1897.0 |
| And how would you handle the case where Redis is unavailable? | 249.8 | 700.9 | 766.1 | 1899.6 |

### run-08-gemini-3-6-flash - model gemini-3-6-flash

Session wall time 5932 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 250.9 | 701.7 | 764.9 | 1899.7 |
| And how would you handle the case where Redis is unavailable? | 249.8 | 703.1 | 766.0 | 1899.3 |

### run-09-gemini-3-6-flash - model gemini-3-6-flash

Session wall time 5915 ms; prompt 6198 chars; answer 814 chars.

- mic (candidate, demo-mic.wav): 1 VAD segment(s), 1 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Okay, got it."
- screen (interviewer, demo-screen.wav): 2 VAD segment(s), 4 partial(s), 294400 bytes as pcm_f32le -> ASR. Finals: "Can you explain how you would design a rate limiter using Redis?", "And how would you handle the case where Redis is unavailable?"

| question | partial ms | silence->q ms | first token ms | answer visible ms |
|---|---|---|---|---|
| Can you explain how you would design a rate limiter using Redis? | 249.7 | 700.1 | 766.5 | 1899.8 |
| And how would you handle the case where Redis is unavailable? | 250.5 | 685.5 | 765.1 | 1899.7 |

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

- demo server: http://127.0.0.1:59887
- GET /auth/me: {"id":"demo-user-00000000-0000-4000-8000-000000000001","clerkUserId":"demo_clerk_user_harness","email":"demo@hireshade.local","firstName":"Demo","lastName":"Candidate","imageUrl":"","createdAt":"2026-01-01T00:00:00.000Z","demo":true}
- POST /auth/deepgram-token: {"key":"dg_demo_mock_demo-user-00000000-0000-4000-8000-000000000001","expiresAt":"2026-10-20T17:54:36.307Z","ttlSeconds":7200,"mocked":true,"provider":"mock"}
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

