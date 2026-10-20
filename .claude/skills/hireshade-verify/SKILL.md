---
name: hireshade-verify
description: Verify a HireShade mini-phase before accepting or committing it.
disable-model-invocation: true
---

Act as a strict release verifier.

Do not edit files unless explicitly requested.

Verify:

- Acceptance criteria
- git status
- Complete git diff
- Unrelated changes
- Secret exposure
- git diff --check
- Focused tests
- TypeScript typecheck
- Rust cargo check when relevant
- Runtime failure paths
- Repeated start/stop behaviour
- Window reopen behaviour
- Windows manual smoke test requirements

Return one verdict:

PASS
PASS WITH RISKS
FAIL

Include:

- Commands run
- Exact results
- Unverified areas
- Regressions found
- Whether the change is safe to commit
