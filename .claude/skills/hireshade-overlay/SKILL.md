---
name: hireshade-overlay
description: Repair the HireShade stealth floating overlay, cursor pass-through, interaction mode, always-on-top and window lifecycle.
disable-model-invocation: true
---

Work only on the HireShade floating overlay.

Required behaviour:

- Passive mode must allow mouse clicks to pass through.
- Interaction mode must make the overlay clickable and scrollable.
- Exiting interaction mode must restore pass-through.
- Hide/show and app reopen must preserve the intended state.
- No duplicate overlay windows.
- Only the intended overlay window may be affected.
- Always-on-top behaviour must remain stable on Windows.
- React state and native Tauri state must stay synchronized.

Workflow:

1. Trace window labels and creation.
2. Find every cursor-event state change.
3. Inspect shortcuts and hide/show lifecycle.
4. Identify the smallest root cause.
5. Make the smallest safe fix.
6. Run focused tests, typecheck, cargo check and git diff --check.
7. Provide manual Windows verification steps.

Do not modify unrelated modules.
Do not install dependencies.
Do not commit or push.
