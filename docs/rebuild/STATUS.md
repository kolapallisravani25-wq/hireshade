# HireShade Rebuild Status

Branch: hireshade-rebuild

## Module Status

| Module | Status | Notes |
|---|---:|---|
| App Shell and Routing | Done | Clean launch shell wired into App.tsx |
| UI System | Done | Shared launch cards, header, sidebar, states |
| Auth | In Progress | Existing Clerk auth pages preserved |
| Dashboard | Done | Stable launch dashboard added |
| Sessions List and Creation | In Progress | Launch-safe sessions list and free-session creation added |
| Backend API Shell | In Progress | Current API reused while rebuild modules connect safely |
| Active Session | Pending | Timer, transcript, manual and automatic answer |
| Transcript Engine | Pending | Save and review transcript safely |
| Answer Engine | Pending | Prompt, context, streaming, formatting |
| Ask AI | Pending | Session-scoped review assistant |
| Resume Studio | In Progress | Stable resume list surface added |
| Projects | In Progress | Stable projects list surface added |
| Credits and Billing | In Progress | Stable credits balance surface added |
| Desktop | Pending | Tauri, audio, overlay path |
| QA and Smoke Tests | Pending | End-to-end launch checks |

## Current Batch

1. Build active session replacement.
2. Build review and transcript replacement.
3. Build Ask AI replacement.
4. Run frontend build on branch.

## Launch Rule

Only modules that build and pass smoke checks should be exposed to users.
