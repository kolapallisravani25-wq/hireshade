# HireShade Audit Inventory

Snapshot: 2026-10-20 ~19:00 IST (Asia/Calcutta)
Branch: `complete-build` · HEAD `627eb98` ("baseline: snapshot working tree before complete-build")
Note: the audit began on `fix/windows-reopen-compile` HEAD `491f4b6`; at 18:49:33 another team process checked out `complete-build` and at 18:50:15 committed the then-current working tree as `627eb98`. Source content is unchanged between the two snapshots (the commit captured the dirty tree), so baseline command results apply to `627eb98`. Raw git evidence: `docs/evidence/01-environment.txt`, `docs/evidence/01b-environment-after-branch-switch.txt`.

## 1. Repository tree summary

```text
D:\hireshade
├── artifacts/
│   ├── api-server/          Express 5 + Drizzle API (src/, tests/, build.mjs, .env.example)
│   ├── craft-vita/          React 19 + Vite 7 web/desktop app + src-tauri (Tauri v2, Rust)
│   ├── desktop-electron/    Electron shell: main.js + scripts/ (no src/; not in pnpm workspace build)
│   └── mockup-sandbox/      shadcn/ui component sandbox (61 source files, generated .generated/)
├── lib/
│   ├── api-client-react/    Orval-generated React client (src/generated)
│   ├── api-spec/            Orval config/spec (no src)
│   ├── api-zod/             Orval-generated Zod schemas (src/generated)
│   └── db/                  Drizzle schema + client (src/schema)
├── admin/                   Kottster admin panel (separate app, own pnpm-lock.yaml, own tsconfig)
├── scripts/                 verify-bundle.cjs, sync-version-from-tag.mjs
├── rea/                     External REA tool checkout (gitignored); not part of the product
└── docs/                    Existing audit/architecture docs + agents/ + adr/ + raw/ recon captures
```

## 2. LOC per top-level area (code files: .ts/.tsx/.js/.jsx/.mjs/.cjs/.rs; blank lines excluded)

| Area | Files | LOC |
|---|---:|---:|
| artifacts/craft-vita/src (web + Tauri frontend) | 400 | 73,161 |
| artifacts/craft-vita/src-tauri/src (Rust) | 6 | 3,447 |
| artifacts/api-server/src | 43 | 8,189 |
| artifacts/mockup-sandbox/src | 61 | 5,498 |
| lib/*/src (api-client-react, api-zod, db) | 10 | 886 |
| **Total inventoried** | **520** | **91,181** |

Not counted above (not in `src/` trees): `artifacts/craft-vita/src-tauri/Cargo.toml` + `Cargo.lock`; `artifacts/desktop-electron/main.js` + 3 scripts; `admin/` app; `scripts/` (2 files); Vite HTML entries `index.html`, `floating.html`, `launcher.html`; CSS (`src/index.css`, `launcher.css`, `floating.css`).

## 3. Manifests, lockfiles, configs

| Path | Bytes | Notes |
|---|---:|---|
| `package.json` | 713 | workspace root; `typecheck`/`build` orchestration |
| `pnpm-workspace.yaml` | 4,827 | packages: artifacts/*, lib/*, lib/integrations/*, scripts; catalog + overrides |
| `pnpm-lock.yaml` | 465,445 | single workspace lockfile |
| `tsconfig.json` / `tsconfig.base.json` | 252 / 718 | project references |
| `artifacts/api-server/package.json` | 1,279 | scripts: dev, build, start, typecheck (**no test script**) |
| `artifacts/api-server/tsconfig.json` | 354 | |
| `artifacts/api-server/build.mjs` | 3,601 | esbuild bundle |
| `artifacts/api-server/.env.example` | 586 | CLERK_SECRET_KEY, OPENROUTER_API_KEY, DEEPGRAM_API_KEY, DESKTOP_TOKEN_SECRET, DATABASE_URL |
| `artifacts/craft-vita/package.json` | 4,034 | version 0.1.24; scripts dev/build/serve/typecheck/test/tauri |
| `artifacts/craft-vita/vite.config.ts` | 4,038 | 3 HTML entries (index/floating/launcher); tauri-stubs aliases for non-Tauri builds |
| `artifacts/craft-vita/tsconfig.json` | 608 | |
| `artifacts/craft-vita/.env.example` | 439 | VITE_BACKEND_URL, VITE_APP_WEB_URL, VITE_CLERK_PUBLISHABLE_KEY |
| `artifacts/craft-vita/src-tauri/tauri.conf.json` | 4,206 | 2 windows (mini, launcher); `csp: null` |
| `artifacts/craft-vita/src-tauri/Cargo.toml` | — | Tauri v2 crate `hireshade` 0.1.24 |
| `artifacts/mockup-sandbox/package.json` / `vite.config.ts` | 2,473 / 1,019 | sandbox only |
| `artifacts/desktop-electron/package.json` | 397 | Electron shell (no build script) |
| `admin/package.json` / `admin/pnpm-lock.yaml` | 1,339 / 177,690 | separate admin app + separate lockfile |
| `lib/api-spec/orval.config.ts` | 1,875 | generated client config |
| `lib/db/drizzle.config.ts` | 315 | |
| `scripts/verify-bundle.cjs` | — | run by tauri beforeBuildCommand |

No Makefile and no `lib/integrations/*` packages exist despite the workspace glob.

## 4. Existing documentation

| Document | Lines | Contents |
|---|---:|---|
| `docs/HireShade-Full-Audit.md` | 470 | 2026-08-04 security/validation audit; feature matrix; confirmed missing items |
| `docs/Architecture-Map.md` | 183 | UI → API → DB mapping, auth flow, routes |
| `docs/HireShade-Engineering-Bible.md` | 41 | mission, product areas, principles |
| `docs/Module-Audit.md` | 31 | infra/admin/web/session status table (mostly ⏳) |
| `docs/Admin-Panel-Audit.md` | — | admin panel audit |
| `docs/Bug-Tracker.md`, `docs/Migration-Plan.md`, `docs/Release-Checklist.md`, `docs/Desktop-Release-Runbook.md`, `docs/Deploy-Plan-Session-Audit.md`, `docs/Module-Audit.md`, `docs/Sessions-Desktop-Technical-Review.md`, `docs/Claude-Production-Stabilization-Prompt.md` | — | process/release/plan docs |
| `docs/adr/ADR-001-engineering-workflow.md`, `docs/agents/{domain,issue-tracker,triage-labels}.md` | — | workflow/agent docs |
| `docs/raw/` | 100+ files | Competitor (ParakeetAI) recon captures: HTTP headers per subdomain, page HTML, probe logs. Also `docs/raw/_scripts/*.ps1`/`.mjs`. Not product code. |
| `SPEC.md` | 145 | ParakeetAI black-box reconstruction spec (competitor), not a HireShade spec |
| `AGENTS.md`, `CONTRIBUTING.md`, `README.md`, `ROADMAP.md`, `SECURITY.md`, `CHANGELOG.md` | — | repo docs |

## 5. Classification method and legend

Method: automated import-graph + marker scan (`docs/evidence/_scripts/inventory.mjs`, raw result `docs/evidence/_inventory.json`), then manual override for files whose real status is known from code reading. "Imported" means resolved through a relative import, the `@/` alias, a `.js`→`.ts` ESM import, a Rust `mod` declaration, or an HTML entry script.

| Class | Meaning |
|---|---|
| COMPLETE | Implemented, imported by the app, no missing-functionality marker |
| PARTIAL | Implemented but feature-gated off, process-local/weak, or explicitly incomplete |
| STUB | Placeholder (web-build Tauri stubs, empty module, "not implemented") |
| BROKEN | Module is present but provably not wired/executed (dead or non-functional) |
| ORPHANED | No importers found and not addressable from an HTML entry/route |
| TEST | Test file (`*.test.ts`, `*.test.tsx`) |

Counts after manual overrides (as written in the tables below): **COMPLETE 362 · ORPHANED 103 · STUB 23 · PARTIAL 13 · TEST 16 · BROKEN 3**.

Manual overrides applied to the generated table:
- `src-tauri/src/focus_bypass.rs` → **BROKEN**: `mod focus_bypass;` (lib.rs:2) but `install_focus_bypass()` has zero call sites and the WinEvent callback body is empty (focus_bypass.rs:8-16).
- `src-tauri/src/screen_protect.rs` → **BROKEN**: `mod screen_protect;` (lib.rs:1) but `set_screen_protection` is not in the Tauri `invoke_handler` and `apply_on_create` has zero call sites; capture protection instead rides on `contentProtected` config + `toggle_content_protection` (lib.rs:545).
- `src-tauri/src/cursor.rs` → **BROKEN**: `mod cursor;` (lib.rs:3) but `hide_system_cursor`/`show_system_cursor` are not in the Tauri `invoke_handler` and are never called (compiler: "never used").
- `src/overlay/**` → **PARTIAL**: all five migration flags default `false` (overlay/flags.ts:23-51), so the unified-overlay runtime is not active.
- `src/pages/Launcher/WidgetApp.tsx`, `src/pages/Sessions/ActiveSession/FloatingApp.tsx` → **COMPLETE** (HTML entry scripts in `launcher.html` / `floating.html`), overriding the graph's "no importers".
- `src/services/MiniRemoteAudio.ts` → **ORPHANED** (only self-references; `hooks/useMiniRemoteAudio.ts` is 0 bytes).
- `src/capture/runtime.ts` → **ORPHANED** (no external importers).
- `src/semantic/**` → **ORPHANED** (barrel not imported by app code).
- `api-server/src/lib/aiRateLimit.ts`, `api-server/src/routes/desktop.ts` → **PARTIAL** (process-local limiter; desktop-token flow).

## 6. Per-file classification

