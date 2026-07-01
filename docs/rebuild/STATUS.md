# HireShade Rebuild Status

Branch: hireshade-rebuild

## Module Status

| Module | Status | Notes |
|---|---:|---|
| App Shell and Routing | Started | Clean shell and stable navigation first |
| UI System | Started | Shared layout, cards, buttons, states |
| Backend API Shell | Pending | Keep existing API while extracting clean modules |
| Auth | Pending | Clerk integration and ownership checks |
| Dashboard | Pending | Stable launch dashboard |
| Sessions Wizard | Pending | Create session from resume, JD, project, custom prompt |
| Active Session | Pending | Timer, transcript, manual and automatic answer |
| Transcript Engine | Pending | Save and review transcript safely |
| Answer Engine | Pending | Prompt, context, streaming, formatting |
| Ask AI | Pending | Session-scoped review assistant |
| Resume Studio | Pending | Existing functionality wrapped safely |
| Projects | Pending | Existing functionality wrapped safely |
| Credits and Billing | Pending | Balance, plans, payment surface |
| Desktop | Pending | Tauri, audio, overlay path |
| QA and Smoke Tests | Pending | End-to-end launch checks |

## Current Batch

1. Create rebuild branch.
2. Add status tracker.
3. Add launch-first module checklist.
4. Start clean app-shell scaffolding.

## Launch Rule

Only modules that build and pass smoke checks should be exposed to users.
