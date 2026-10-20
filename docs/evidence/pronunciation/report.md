# Pronunciation-robust understanding — evidence (G-039)

Generated: 2026-10-20T15:28:08.237Z

Command:

~~~
pnpm --dir artifacts/craft-vita exec vitest run src/fixtures/pronunciation/pronunciationMetrics.test.ts
~~~

## Corpus

- 192 degraded interviewer utterances (48 hand-authored questions x 4 accent profiles) built from the repo's existing technical/interview language, with hand-labeled true intent (16 intents, 3 questions each).
- total utterances: **192**
- accent profiles: **4**
- hand-labeled intents: **16**

## Headline metrics

| Path | Intent accuracy | False-answer rate |
|---|---|---|
| BEFORE (rescue/repair/gate disabled) | 53.6% | 46.4% |
| AFTER (pronunciation layer on) | **96.9%** | **0.0%** |
| Target | >= 92.0% | < 3.0% |

## Per-profile

| Profile | n | Accuracy before | Accuracy after | False answers before | False answers after |
|---|---|---|---|---|---|
| south_indian | 48 | 60.4% | 97.9% | 39.6% | 0.0% |
| east_asian | 48 | 54.2% | 93.8% | 45.8% | 0.0% |
| arabic | 48 | 58.3% | 97.9% | 41.7% | 0.0% |
| hispanic | 48 | 41.7% | 97.9% | 58.3% | 0.0% |

## Gate behaviour

- answered confidently: 92
- hedge (cover both readings): 70
- clarify (heard X — did you mean Y?): 30

## Repair latency (targeted pass, budget 150 ms)

- repair calls: 113
- segments repaired: 0
- avg elapsed: 18 ms
- max elapsed: 18 ms
- within budget: 100.0%

## Rescue

- replaced spans: 121 (196 tokens)
- by reason: {"variant":114,"homophone_context":4,"phonetic":3}

## Hard rule — high-confidence tokens untouched

- utterances checked: 192
- violations: **0**

## Method notes / limitations

- Accent profiles are deterministic *models* of accent-conditioned ASR errors (no audio, no hosted ASR).
- BEFORE disables the pronunciation layer but keeps the real question detector and its existing STT normalizer.
- AFTER reuses the same detector on the recovered question; intent matching is a hand-authored keyword-group matcher, not a trained classifier.
- Repair latency is measured with the deterministic mock provider (simulated network delay) plus a wall-clock probe; a real LLM will be far slower than 150 ms, which is why the pass is budgeted and falls back to rescue-only output.
- Homophones (cache/cash) are resolved only when context cues decide; otherwise the gate hedges/clarifies instead of guessing.
