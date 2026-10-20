# HireShade Baseline Failures and Command Evidence

Snapshot: 2026-10-20 ~19:00-19:15 IST | branch `complete-build` | HEAD `627eb98`
Raw logs: `docs/evidence/` (numbered files referenced below). No source files were modified; only docs and `docs/evidence/**` were written.

## 0. Environment and git baseline

| Item | Value |
|---|---|
| OS / shell | Windows, PowerShell 7 (`pwsh -Command`) |
| node | `v24.19.0` |
| pnpm | `12.4.2` |
| cargo / rustc | `cargo 1.99.0 (5f94df478 2026-08-27)` / `rustc 1.99.0 (b940084d7 2026-09-28)` |
| branch | `complete-build` (HEAD `627eb98c31e02e59dabb55f5e17326870dd3f3af`) |
| working tree | clean except untracked `docs/raw/*` recon captures |
| stashes | 3 preserved (`stash@{0}` wip(auto-scroll), `stash@{1}`, `stash@{2}`) |

Baseline discrepancy: the audit started 18:45 IST on `fix/windows-reopen-compile` HEAD `491f4b6`. At 18:49:33 another team process ran `git checkout complete-build`; at 18:50:15 it committed the then-current dirty tree as `627eb98` ("baseline: snapshot working tree before complete-build"). The first typecheck/frontend-test runs executed on the pre-switch content; both were re-run after the switch and the results below are the re-runs (identical outcomes). Evidence: `docs/evidence/01-environment.txt`, `docs/evidence/01b-environment-after-branch-switch.txt`. `git worktree list` also shows a prunable second worktree `C:/Users/user/Desktop/hireshade-emitto-fix` (branch `fix/craft-vita-emitto-stub`, HEAD `4444913`) - not modified.

## 1. Command results table (exact)

| # | Command (cwd) | Exit | Duration | Result | Evidence |
|---|---|---:|---:|---|---|
| 1 | `pnpm run typecheck` (root) | **0** | 105.1 s | success - `tsc --build` (libs) + api-server, craft-vita, mockup-sandbox all "Done" | `02-typecheck.txt`, `02-typecheck-exit.txt` |
| 2 | `pnpm --dir artifacts/craft-vita test` | **0** | 25.1 s | success - **16 test files / 158 tests passed**, vitest 4.1.9 | `03-frontend-test.txt`, `03-frontend-test-exit.txt` |
| 3 | `pnpm --dir artifacts/api-server test` | **0 (misleading)** | 3.2 s | **no-op**: package has no `test` script; empty output, exit 0 | `04-api-test-script.txt` |
| 4 | `pnpm --dir artifacts/api-server exec vitest run` | **1** | 157.1 s | **100 tests passed, 1 suite failed to load** (no `DATABASE_URL`) | `05-api-vitest.txt`, `05-api-vitest-exit.txt` |
| 5 | `cargo check --message-format short` (`artifacts/craft-vita/src-tauri`) | **0** | 518.5 s (8 m 38 s) | success - finished in 8 m 37 s with **9 dead-code warnings** | `06-cargo-check.txt`, `06-cargo-check-exit.txt` |
| 6 | `pnpm --dir artifacts/craft-vita build` | **0** | 340.4 s (5 m 40 s) | success - `vite v7.3.3`, 5,427 modules, `built in 5m 21s`, 3 warning groups | `07-frontend-build.txt`, `07-frontend-build-exit.txt` |
| 7 | `pnpm dev` in `artifacts/craft-vita` + HTTP probes (A4 run) | n/a | ready 6.8 s | server up; `GET /` 200 (1,035 B); `GET /launcher.html` 200 (1,453 B); `GET /src/main.tsx` 200 (10,711 B) after 12.9 s cold | `08-vite-dev-server.txt`, section 3 below |

Pre-switch reference runs: typecheck exit 0 / 129.4 s; frontend tests exit 0 / 16 files, 158 tests - identical outcomes.

## 2. Failures, verbatim

### 2.1 API suite: integration file cannot load without Postgres

Command: `pnpm --dir artifacts/api-server exec vitest run` | exit **1** | 157.1 s

```text
 FAIL  tests/sessions.integration.test.ts [ tests/sessions.integration.test.ts ]
Error: DATABASE_URL must be set. Did you forget to provision a database?
 ❯ ../../lib/db/src/index.ts:8:9
      7| if (!process.env.DATABASE_URL) {
      8|   throw new Error(
      9|     "DATABASE_URL must be set. Did you forget to provision a database?...
     10|
 ❯ tests/sessions.integration.test.ts:84:1

 Test Files  1 failed | 18 passed (19)
      Tests  100 passed (100)
   Duration  150.96s
```

Interpretation: the API unit suite is green (100/100) but the only integration suite is **unverified** in this environment - no Postgres/DATABASE_URL was provisioned. This is a runtime-verification gap, not a code failure.

### 2.2 API "test" entrypoint is a silent no-op (false green)

Command: `pnpm --dir artifacts/api-server test` | exit **0** | 3.2 s | output: *(empty)*

`artifacts/api-server/package.json:7-12` has only `dev`, `build`, `start`, `typecheck`. Any CI/agent running `pnpm test` by convention reports success while executing zero tests. Run the real suite via `pnpm --dir artifacts/api-server exec vitest run`.

### 2.3 Cargo warnings (9, all dead code)

Command: `cargo check --message-format short` | exit **0** | 518.5 s. Verbatim tail:

```text
src\screen_protect.rs:4:7: warning: constant `WDA_MONITOR` is never used
src\screen_protect.rs:7:8: warning: function `set_screen_protection` is never used
src\screen_protect.rs:18:8: warning: function `apply_on_create` is never used
src\focus_bypass.rs:6:8: warning: static `HOOK` is never used
src\focus_bypass.rs:8:27: warning: function `event_hook` is never used
src\focus_bypass.rs:18:8: warning: function `install_focus_bypass` is never used
src\focus_bypass.rs:34:8: warning: function `uninstall_focus_bypass` is never used
src\cursor.rs:5:8: warning: function `hide_system_cursor` is never used
src\cursor.rs:10:8: warning: function `show_system_cursor` is never used
warning: `hireshade` (lib) generated 9 warnings
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 8m 37s
```

Compiler proof that the stealth/focus/cursor primitives exist but are not wired. `mod screen_protect;` (lib.rs:1), `mod focus_bypass;` (lib.rs:2), `mod cursor;` (lib.rs:3) are declared, but none of the functions is registered in the Tauri `invoke_handler` or called anywhere (see `docs/CURRENT_STATE.md` section 2).

### 2.4 Vite build warnings (build still exits 0)

Command: `pnpm --dir artifacts/craft-vita build` | exit **0** | 340.4 s; 5,427 modules transformed. Verbatim:

```text
(!) .../src/tauri-stubs/api-event.ts is dynamically imported by .../src/lib/desktopSession.ts
    but also statically imported by .../src/App.tsx, .../GoogleOAuthButton.tsx,
    .../floatingSessionSlice.ts, .../lib/desktopAuthSession.ts, .../ActiveSession/page.tsx,
    dynamic import will not move module into another chunk.
(!) .../pages/Auth/SignIn/page.tsx is dynamically imported by .../App.tsx but also statically
    imported by .../components/TauriReturnBanner.tsx, dynamic import will not move module...
(!) Some chunks are larger than 500 kB after minification.
```

Chunk sizes from the same log: `page-CdIhZVsG.js 4,068.41 kB (gzip 1,106.47 kB)`; `index-*.js 1,161.82 kB (gzip 334.98 kB)`. The web bundle is not meaningfully code-split; cold-load cost is high.

### 2.5 PowerShell wrapper noise on every pnpm call

Every `pnpm` invocation under `pwsh` emits this on stderr even on success (exit code remains pnpm's):

```text
node.exe : $ pnpm run typecheck:libs && pnpm -r --filter "./artifacts/**" ...
At C:\Program Files\nodejs\pnpm.ps1:16 char:5
+   & "$basedir/node$exe" "$basedir/node_modules/corepack/dist/pnpm. ...
    + CategoryInfo          : NotSpecified: (...) [], RemoteException
    + FullyQualifiedErrorId : NativeCommandError
```

This is a `pwsh`/`pnpm.ps1` wrapper artifact (native stderr re-wrapped as a PowerShell error record), **not** a command failure. Use `$LASTEXITCODE`; do not treat `NativeCommandError` as the failure signal.

## 3. A4 run (Vite dev server, real HTTP evidence)

Commands (cwd `artifacts/craft-vita`): `pnpm dev` (= `vite --config vite.config.ts --host 0.0.0.0 --port 5173`), then from repo root:

| Probe | Result |
|---|---|
| `GET http://127.0.0.1:5173/` | **200**, `text/html`, 1,035 bytes; body has `<div id="root"></div>`, `/@vite/client`, `<title>HireShade</title>` |
| `GET /launcher.html` | **200**, 1,453 bytes (entry script `/src/pages/Launcher/WidgetApp.tsx`) |
| `GET /src/main.tsx` (cold) | **200**, 10,711 bytes, **12.9 s** - first transform after dependency optimization |
| Server log | `VITE v7.3.3 ready in 6813 ms`; `[vite] (client) Re-optimizing dependencies because vite config has changed` |

Caveat: the HTML shell is served, but the app cannot boot without env keys - `src/main.tsx:15-19` throws `Missing Publishable Key` when `VITE_CLERK_PUBLISHABLE_KEY` is absent. No browser/JS-console verification was performed, so hydration/render failures beyond the shell remain **unverified**.

## 4. Security finding: credential material on disk

`artifacts/craft-vita/src-tauri/src/db access token.txt` (69 bytes) reportedly contains a live Supabase personal access token. Checks performed without reading/copying the value:

- `git ls-files` does **not** track it.
- `.gitignore` ignores it explicitly ("Secret-bearing scratch left in the tree (never commit; rotate the token)").
- `git check-ignore` returns the path (ignored, untracked).

Required action: **rotate the Supabase token now** (assume disclosure if the file was ever synced/shared), then delete the file. Also untracked scratch: `artifacts/craft-vita/src-tauri/src/algo 6.txt`, `artifacts/craft-vita/temp-tauri-launch.png`. No secret values are reproduced in this report.
