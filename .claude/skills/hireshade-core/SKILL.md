---
name: hireshade-core
description: Diagnose and repair the HireShade live interview flow from transcription to AI answer generation and overlay rendering.
disable-model-invocation: true
---

Work as a senior Tauri, React, TypeScript, Rust and backend engineer.

Focus only on:

audio/transcription
→ question detection
→ AI request
→ backend route
→ LLM response
→ streamed answer
→ floating overlay rendering

Rules:

- Work on one mini-phase only.
- Inspect before editing.
- Do not scan node_modules, target, dist, build outputs, generated files or pnpm-lock.yaml.
- Do not install or upgrade dependencies.
- Do not use subagents.
- Do not make broad refactors.
- Report root cause with exact file paths.
- Modify the smallest possible file set.
- Run focused tests, typecheck, cargo check and git diff --check where relevant.
- Do not commit or push.

Completion report:

- Root cause
- Files changed
- Tests run
- Manual Windows checks
- Remaining risks
- Suggested commit message
