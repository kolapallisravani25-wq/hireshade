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


## 6.1 artifacts/craft-vita/src (web + Tauri frontend) — 400 files, 73161 LOC (COMPLETE 302, ORPHANED 54, STUB 18, TEST 16, PARTIAL 10)

### `artifacts/craft-vita/src/` (5 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `App.tsx` | 352 | COMPLETE |  |
| `main.tsx` | 54 | COMPLETE |  |
| `sensitiveLogging.test.ts` | 49 | TEST | test |
| `tauriSecurityManifest.test.ts` | 37 | TEST | test |
| `vite-env.d.ts` | 3 | ORPHANED | no importers |

### `artifacts/craft-vita/src/capture/` (2 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `runtime.ts` | 34 | ORPHANED | getCaptureRuntime/isDesktop/isBrowser have no external importers |
| `types.ts` | 50 | STUB | marker no-op |

### `artifacts/craft-vita/src/components/` (13 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `app-sidebar.tsx` | 256 | COMPLETE |  |
| `calendar-date-picker.tsx` | 665 | COMPLETE |  |
| `CreditsBadge.tsx` | 75 | COMPLETE |  |
| `ErrorBoundary.tsx` | 36 | COMPLETE |  |
| `GoogleOAuthButton.tsx` | 172 | COMPLETE |  |
| `MarkdownRenderer.tsx` | 194 | ORPHANED | no importers |
| `nav-main.tsx` | 115 | COMPLETE |  |
| `nav-projects.tsx` | 82 | ORPHANED | no importers |
| `nav-user.tsx` | 125 | COMPLETE |  |
| `Navbar.tsx` | 77 | COMPLETE |  |
| `SettingsDialog.tsx` | 150 | COMPLETE |  |
| `TauriReturnBanner.tsx` | 74 | COMPLETE |  |
| `team-switcher.tsx` | 85 | ORPHANED | no importers |

### `artifacts/craft-vita/src/components/AI projects/` (5 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `AIProjectsTable.tsx` | 588 | COMPLETE |  |
| `GenerateProjectDialog.tsx` | 207 | ORPHANED | no importers |
| `ProjectDetailsView.tsx` | 453 | ORPHANED | no importers |
| `ProjectReportView.tsx` | 209 | COMPLETE |  |
| `VersionHistorySheet.tsx` | 174 | COMPLETE |  |

### `artifacts/craft-vita/src/components/AI projects/project-report/` (6 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `CopyBtn.tsx` | 31 | COMPLETE |  |
| `normalizeProject.ts` | 272 | COMPLETE |  |
| `renderers.tsx` | 591 | COMPLETE |  |
| `SectionBlock.tsx` | 32 | COMPLETE |  |
| `TOC.tsx` | 165 | COMPLETE |  |
| `types.ts` | 49 | COMPLETE |  |

### `artifacts/craft-vita/src/components/Account/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `AccountDialog.tsx` | 28 | COMPLETE |  |

### `artifacts/craft-vita/src/components/Billing/` (4 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `AiActivitySection.tsx` | 163 | COMPLETE |  |
| `BuyCreditsDialog.tsx` | 370 | COMPLETE |  |
| `CreditPlansSection.tsx` | 351 | COMPLETE |  |
| `OutOfCreditsDialog.tsx` | 58 | COMPLETE |  |

### `artifacts/craft-vita/src/components/Clerk/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `ClerkAuth.tsx` | 43 | ORPHANED | no importers |

### `artifacts/craft-vita/src/components/Dashboard/` (2 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `DownloadApp.tsx` | 309 | COMPLETE |  |
| `OnboardingStepper.tsx` | 146 | COMPLETE |  |

### `artifacts/craft-vita/src/components/Document/` (4 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `DeleteDocumentDialog.tsx` | 63 | COMPLETE |  |
| `DocumentPreview.tsx` | 39 | COMPLETE |  |
| `DocumentSelector.tsx` | 122 | COMPLETE |  |
| `UploadDocumentDialog.tsx` | 219 | COMPLETE |  |

### `artifacts/craft-vita/src/components/Resume/` (14 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `ATSAnalysisDialog.tsx` | 100 | COMPLETE |  |
| `BuildResumeDialog.tsx` | 552 | COMPLETE |  |
| `DeleteResumeDialog.tsx` | 63 | COMPLETE |  |
| `GeneratedLetter.tsx` | 114 | COMPLETE |  |
| `JobDetails.tsx` | 67 | COMPLETE |  |
| `ListOfATSAnalysis.tsx` | 168 | COMPLETE |  |
| `ListOfResumes.tsx` | 665 | COMPLETE |  |
| `ResumeEditorV2.tsx` | 711 | COMPLETE |  |
| `ResumePreview.tsx` | 111 | COMPLETE |  |
| `ResumeSelector.tsx` | 194 | COMPLETE |  |
| `ResumeUpload.tsx` | 159 | ORPHANED | no importers |
| `ToneSelection.tsx` | 88 | COMPLETE |  |
| `UploadButton.tsx` | 113 | ORPHANED | no importers |
| `UploadResumeDialog.tsx` | 239 | COMPLETE |  |

### `artifacts/craft-vita/src/components/Resume/BuildResume/` (6 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `ExtractionStep.tsx` | 49 | COMPLETE |  |
| `JDStep.tsx` | 137 | COMPLETE |  |
| `ManualEntryStep.tsx` | 50 | ORPHANED | no importers |
| `ProcessingStep.tsx` | 155 | COMPLETE |  |
| `SourceSelectionStep.tsx` | 94 | COMPLETE |  |
| `TemplateSelectionStep.tsx` | 413 | COMPLETE |  |

### `artifacts/craft-vita/src/components/Sessions/` (4 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `CompanyCombobox.tsx` | 132 | COMPLETE |  |
| `ConnectDialog.tsx` | 428 | COMPLETE |  |
| `CreateSessionDialog.tsx` | 377 | COMPLETE |  |
| `InactivityDialog.tsx` | 58 | ORPHANED | no importers |

### `artifacts/craft-vita/src/components/Sessions/steps/` (8 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `Step1_JobDetails.tsx` | 132 | COMPLETE |  |
| `Step2_ResumeSelector.tsx` | 174 | COMPLETE |  |
| `Step3_DocumentSelector.tsx` | 33 | COMPLETE |  |
| `Step4_AIProjects.tsx` | 236 | COMPLETE |  |
| `Step4_LanguageAISettings.tsx` | 197 | COMPLETE |  |
| `Step5_AutoGenerateAI.tsx` | 78 | COMPLETE |  |
| `Step6_SaveTranscript.tsx` | 96 | COMPLETE |  |
| `Step7_Review.tsx` | 75 | COMPLETE |  |

### `artifacts/craft-vita/src/components/Subscription/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `SubscriptionPricing.tsx` | 193 | ORPHANED | no importers |

### `artifacts/craft-vita/src/components/auth/` (2 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `AuthCard.tsx` | 37 | ORPHANED | no importers |
| `DesktopAuthHydrator.tsx` | 221 | COMPLETE |  |

### `artifacts/craft-vita/src/components/data-table/` (8 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `column-header.tsx` | 80 | COMPLETE |  |
| `data-export.tsx` | 529 | COMPLETE |  |
| `data-table-resizer.tsx` | 48 | COMPLETE |  |
| `data-table.tsx` | 1588 | COMPLETE |  |
| `expand-icon.tsx` | 47 | ORPHANED | no importers |
| `pagination.tsx` | 148 | COMPLETE |  |
| `toolbar.tsx` | 490 | COMPLETE |  |
| `view-options.tsx` | 207 | COMPLETE |  |

### `artifacts/craft-vita/src/components/data-table/hooks/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `use-table-column-resize.ts` | 97 | COMPLETE |  |

### `artifacts/craft-vita/src/components/data-table/utils/` (14 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `case-utils.ts` | 110 | COMPLETE |  |
| `column-sizing.ts` | 113 | COMPLETE |  |
| `conditional-state.ts` | 42 | COMPLETE |  |
| `date-format.ts` | 8 | COMPLETE |  |
| `deep-utils.ts` | 218 | COMPLETE |  |
| `export-utils.ts` | 295 | COMPLETE |  |
| `history-sync.ts` | 50 | COMPLETE |  |
| `index.ts` | 10 | COMPLETE |  |
| `keyboard-navigation.ts` | 51 | COMPLETE |  |
| `search.ts` | 22 | COMPLETE |  |
| `table-config.ts` | 75 | COMPLETE |  |
| `table-state-handlers.ts` | 105 | COMPLETE |  |
| `url-events.ts` | 1 | COMPLETE |  |
| `url-state.ts` | 408 | COMPLETE |  |

### `artifacts/craft-vita/src/components/ui/` (29 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `alert-dialog.tsx` | 146 | COMPLETE |  |
| `alert.tsx` | 69 | COMPLETE |  |
| `avatar.tsx` | 102 | COMPLETE |  |
| `badge.tsx` | 31 | COMPLETE |  |
| `breadcrumb.tsx` | 112 | COMPLETE |  |
| `button.tsx` | 62 | COMPLETE |  |
| `calendar.tsx` | 211 | COMPLETE |  |
| `card.tsx` | 60 | COMPLETE |  |
| `checkbox.tsx` | 28 | COMPLETE |  |
| `collapsible.tsx` | 27 | COMPLETE |  |
| `command.tsx` | 182 | COMPLETE |  |
| `dialog.tsx` | 154 | COMPLETE |  |
| `dropdown-menu.tsx` | 251 | COMPLETE |  |
| `input-group.tsx` | 144 | COMPLETE |  |
| `input.tsx` | 16 | COMPLETE |  |
| `label.tsx` | 20 | COMPLETE |  |
| `popover.tsx` | 78 | COMPLETE |  |
| `radio-group.tsx` | 38 | COMPLETE |  |
| `resizable.tsx` | 56 | COMPLETE |  |
| `select.tsx` | 182 | COMPLETE |  |
| `separator.tsx` | 23 | COMPLETE |  |
| `sheet.tsx` | 130 | COMPLETE |  |
| `sidebar.tsx` | 647 | COMPLETE |  |
| `skeleton.tsx` | 11 | COMPLETE |  |
| `switch.tsx` | 28 | COMPLETE |  |
| `table.tsx` | 104 | COMPLETE |  |
| `tabs.tsx` | 81 | COMPLETE |  |
| `textarea.tsx` | 15 | COMPLETE |  |
| `tooltip.tsx` | 49 | COMPLETE |  |

### `artifacts/craft-vita/src/contexts/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `DesktopAuthProvider.tsx` | 122 | COMPLETE |  |

### `artifacts/craft-vita/src/features/auth/components/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `AuthScreen.tsx` | 49 | COMPLETE |  |

### `artifacts/craft-vita/src/features/launcher/` (2 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `constants.ts` | 54 | COMPLETE |  |
| `types.ts` | 58 | COMPLETE |  |

### `artifacts/craft-vita/src/features/launcher/components/` (3 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `CollapsedIcon.tsx` | 51 | COMPLETE |  |
| `CompanyAutocomplete.tsx` | 66 | COMPLETE |  |
| `HeaderMenu.tsx` | 276 | COMPLETE |  |

### `artifacts/craft-vita/src/features/launcher/hooks/` (4 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `useCardPosition.ts` | 65 | COMPLETE |  |
| `useCollapseToggle.ts` | 72 | COMPLETE |  |
| `useCursorPassthrough.ts` | 242 | COMPLETE |  |
| `usePopoverAnchor.ts` | 143 | COMPLETE |  |

### `artifacts/craft-vita/src/features/launcher/slices/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `overlaySlice.ts` | 78 | COMPLETE |  |

### `artifacts/craft-vita/src/features/session/audio/` (6 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `audioSessionController.test.ts` | 32 | TEST | test |
| `audioSessionController.ts` | 151 | COMPLETE |  |
| `captureStatus.test.ts` | 65 | TEST | test |
| `captureStatus.ts` | 41 | COMPLETE |  |
| `systemHealth.test.ts` | 105 | TEST | test |
| `systemHealth.ts` | 94 | COMPLETE |  |

### `artifacts/craft-vita/src/features/session/components/` (10 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `ActionButtons.tsx` | 53 | COMPLETE |  |
| `FloatingSurface.tsx` | 129 | COMPLETE |  |
| `InlineEditableTranscriptText.tsx` | 115 | COMPLETE |  |
| `PastSessionsTab.tsx` | 139 | COMPLETE |  |
| `ResizeHandles.tsx` | 165 | COMPLETE |  |
| `SessionMenu.tsx` | 194 | COMPLETE |  |
| `SessionSelector.tsx` | 29 | COMPLETE |  |
| `SessionTranscript.tsx` | 100 | COMPLETE |  |
| `TabPills.tsx` | 33 | COMPLETE |  |
| `TranscriptBubble.tsx` | 99 | COMPLETE |  |

### `artifacts/craft-vita/src/features/session/context/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `adaptiveAiContext.ts` | 401 | COMPLETE |  |

### `artifacts/craft-vita/src/features/session/detection/` (2 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `activeQuestionDetector.test.ts` | 68 | TEST | test |
| `activeQuestionDetector.ts` | 402 | COMPLETE |  |

### `artifacts/craft-vita/src/features/session/hooks/` (12 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `autoGenQuestionSource.test.ts` | 77 | TEST | test |
| `autoGenQuestionSource.ts` | 46 | COMPLETE |  |
| `autoGenTrailingTranscript.test.ts` | 124 | TEST | test |
| `autoGenTrailingTranscript.ts` | 65 | COMPLETE |  |
| `autoScrollPolicy.test.ts` | 130 | TEST | test |
| `autoScrollPolicy.ts` | 66 | COMPLETE |  |
| `cancellableListener.test.ts` | 61 | TEST | test |
| `cancellableListener.ts` | 62 | STUB | marker no-op |
| `useFloatingSession.ts` | 3168 | STUB | marker no-op |
| `useSessionCreation.ts` | 380 | COMPLETE |  |
| `useSessionMenuAnchor.ts` | 82 | COMPLETE |  |
| `useSessionResources.ts` | 242 | COMPLETE |  |

### `artifacts/craft-vita/src/features/session/runtime/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `sessionRuntime.ts` | 152 | COMPLETE |  |

### `artifacts/craft-vita/src/features/session/selectors/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `floatingSessionSelectors.ts` | 75 | COMPLETE |  |

### `artifacts/craft-vita/src/features/session/slices/` (2 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `floatingSessionSlice.ts` | 352 | COMPLETE |  |
| `sessionFlowSlice.ts` | 47 | COMPLETE |  |

### `artifacts/craft-vita/src/features/session/transcript/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `stt-normalizer.ts` | 668 | COMPLETE |  |

### `artifacts/craft-vita/src/features/settings/slices/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `settingsSlice.ts` | 39 | COMPLETE |  |

### `artifacts/craft-vita/src/hooks/` (26 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `use-mobile.ts` | 15 | COMPLETE |  |
| `useAIChat.test.ts` | 94 | TEST | test |
| `useAIChat.ts` | 1971 | COMPLETE |  |
| `useConfirmedSignOut.ts` | 67 | COMPLETE |  |
| `useCreditBrackets.ts` | 22 | COMPLETE |  |
| `useCreditPlans.ts` | 61 | COMPLETE |  |
| `useCreditsBalance.ts` | 139 | COMPLETE |  |
| `useCreditsLedger.ts` | 66 | COMPLETE |  |
| `useCreditsPurchases.ts` | 51 | COMPLETE |  |
| `useCreditsUsage.ts` | 74 | COMPLETE |  |
| `useDeepgram.ts` | 536 | COMPLETE |  |
| `useFeatureCosts.ts` | 76 | COMPLETE |  |
| `useFreeSessionTimer.ts` | 144 | COMPLETE |  |
| `useInactivityObserver.ts` | 44 | ORPHANED | no importers |
| `useKeyboardShortcut.ts` | 36 | COMPLETE |  |
| `useMiniRemoteAudio.ts` | 0 | STUB | 0-byte file |
| `useNativeAudio.ts` | 124 | ORPHANED | no importers |
| `useNativeTabTranscription.ts` | 312 | STUB | marker no-op |
| `useOverlayShortcuts.ts` | 146 | COMPLETE |  |
| `usePopupWindowExpand.ts` | 101 | ORPHANED | no importers |
| `useSafeZoom.ts` | 135 | COMPLETE |  |
| `useScreenShare.ts` | 102 | COMPLETE |  |
| `useSessionHeartbeat.ts` | 88 | COMPLETE |  |
| `useStoredUserId.ts` | 33 | COMPLETE |  |
| `useSyncUser.ts` | 51 | COMPLETE |  |
| `useUserCurrency.ts` | 45 | COMPLETE |  |

### `artifacts/craft-vita/src/lib/` (28 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `clampToScreen.ts` | 102 | COMPLETE |  |
| `clerkOptions.ts` | 28 | COMPLETE |  |
| `companies.ts` | 72 | COMPLETE |  |
| `conversation-continuity.ts` | 127 | COMPLETE |  |
| `creditedAi.ts` | 109 | COMPLETE |  |
| `deepgramAuth.ts` | 85 | COMPLETE |  |
| `desktopAuthSession.ts` | 53 | COMPLETE |  |
| `desktopClerkSession.ts` | 23 | COMPLETE |  |
| `desktopSession.ts` | 149 | COMPLETE |  |
| `disableDebugLogs.ts` | 7 | ORPHANED | no importers |
| `endpoints.ts` | 127 | COMPLETE |  |
| `generation-pipeline.test.ts` | 91 | TEST | test |
| `generation-pipeline.ts` | 315 | COMPLETE |  |
| `globalAuth.ts` | 16 | COMPLETE |  |
| `grouped-question-engine.ts` | 424 | COMPLETE |  |
| `intent-detector.ts` | 185 | COMPLETE |  |
| `overlaySettings.ts` | 84 | COMPLETE |  |
| `pdfCache.ts` | 54 | COMPLETE |  |
| `resumeTemplate.ts` | 522 | COMPLETE |  |
| `semantic-classifier.ts` | 757 | COMPLETE |  |
| `stream-orchestrator.ts` | 143 | COMPLETE |  |
| `transcript-stabilizer.test.ts` | 650 | TEST | test |
| `transcript-stabilizer.ts` | 229 | COMPLETE |  |
| `updater.ts` | 196 | COMPLETE |  |
| `userCurrency.ts` | 129 | COMPLETE |  |
| `utils.ts` | 15 | COMPLETE |  |
| `utterance-completeness.test.ts` | 157 | TEST | test |
| `utterance-completeness.ts` | 124 | COMPLETE |  |

### `artifacts/craft-vita/src/overlay/` (4 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `flags.ts` | 53 | PARTIAL | overlay migration flag defaults false (overlay/flags.ts:23-51) |
| `index.ts` | 39 | PARTIAL | overlay migration flag defaults false (overlay/flags.ts:23-51) |
| `OverlayRoot.tsx` | 98 | PARTIAL | overlay migration flag defaults false (overlay/flags.ts:23-51) |
| `types.ts` | 63 | PARTIAL | overlay migration flag defaults false (overlay/flags.ts:23-51) |

### `artifacts/craft-vita/src/overlay/layers/` (4 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `LauncherLayer.tsx` | 61 | PARTIAL | overlay migration flag defaults false (overlay/flags.ts:23-51) |
| `OverlayEffectsLayer.tsx` | 12 | PARTIAL | overlay migration flag defaults false (overlay/flags.ts:23-51) |
| `OverlayPortalLayer.tsx` | 13 | PARTIAL | overlay migration flag defaults false (overlay/flags.ts:23-51) |
| `SessionLayer.tsx` | 66 | PARTIAL | overlay migration flag defaults false (overlay/flags.ts:23-51) |

### `artifacts/craft-vita/src/overlay/managers/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `InteractiveIslandsManager.ts` | 155 | PARTIAL | overlay migration flag defaults false (overlay/flags.ts:23-51) |

### `artifacts/craft-vita/src/overlay/providers/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `OverlayPortalProvider.tsx` | 85 | PARTIAL | overlay migration flag defaults false (overlay/flags.ts:23-51) |

### `artifacts/craft-vita/src/pages/AIProjects/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 579 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/AIProjects/ProjectRecommendations/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 453 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Account/Usage/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 37 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Analytics/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 396 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Assistant/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 54 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Assistant/components/` (7 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `ChatList.tsx` | 157 | COMPLETE |  |
| `ChatWindow.tsx` | 168 | COMPLETE |  |
| `EmptyState.tsx` | 23 | COMPLETE |  |
| `MessageBubble.tsx` | 257 | COMPLETE |  |
| `ModelSelector.tsx` | 36 | COMPLETE |  |
| `SessionPicker.tsx` | 72 | COMPLETE |  |
| `SuggestionChips.tsx` | 28 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Assistant/hooks/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `useAssistant.ts` | 251 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Auth/SSOCallback/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 32 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Auth/SignIn/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 313 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Auth/SignUp/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 171 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Billing/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 760 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Dashboard/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 122 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/DesktopAuth/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `DesktopAuthHandoff.tsx` | 157 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Document/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 212 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Help/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 210 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Launcher/` (2 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `LauncherApp.tsx` | 20 | ORPHANED | launcher.html loads WidgetApp.tsx instead |
| `WidgetApp.tsx` | 1255 | COMPLETE | HTML entry (launcher.html) |

### `artifacts/craft-vita/src/pages/QuestionBank/` (2 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `api.ts` | 178 | COMPLETE |  |
| `types.ts` | 149 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/QuestionBank/All Questions/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 543 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/QuestionBank/CompanyQuestions/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 212 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/QuestionBank/QuestionDetails/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 74 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/QuestionBank/User Questions/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 137 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/QuestionBank/components/` (5 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `QuestionBankAnalyticsPanel.tsx` | 79 | COMPLETE |  |
| `QuestionBankFilters.tsx` | 160 | COMPLETE |  |
| `QuestionBankUI.tsx` | 96 | COMPLETE |  |
| `QuestionDetailContent.tsx` | 144 | COMPLETE |  |
| `QuestionDetailSheet.tsx` | 82 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Resume/ATSAnalysis/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 10 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Resume/ATSResult/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 381 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Resume/AllResume/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 85 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Resume/BuildResume/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 1452 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Resume/CoverLetter/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 172 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Resume/ResumeEditor/` (3 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 340 | COMPLETE |  |
| `sectionQualityPersistence.ts` | 59 | COMPLETE |  |
| `types.ts` | 349 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Resume/ResumeEditor/components/` (19 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `AiActivityButton.tsx` | 156 | COMPLETE |  |
| `AIToolsStrip.tsx` | 276 | COMPLETE |  |
| `AIToolStepHeader.tsx` | 46 | COMPLETE |  |
| `ATSPanel.tsx` | 426 | COMPLETE |  |
| `CenterPanel.tsx` | 249 | COMPLETE |  |
| `EditorPanelWidgets.tsx` | 187 | COMPLETE |  |
| `EntryEditors.tsx` | 265 | COMPLETE |  |
| `FullRewritePanel.tsx` | 445 | COMPLETE |  |
| `InjectKeywordsPanel.tsx` | 321 | COMPLETE |  |
| `InjectSkillsPanel.tsx` | 223 | COMPLETE |  |
| `JDTailorPanel.tsx` | 679 | COMPLETE |  |
| `KeywordMatchPanel.tsx` | 230 | COMPLETE |  |
| `LeftPanel.tsx` | 115 | COMPLETE |  |
| `LinkManager.tsx` | 257 | COMPLETE |  |
| `ResumePreviewPanels.tsx` | 436 | COMPLETE |  |
| `SectionEditorFields.tsx` | 162 | COMPLETE |  |
| `TextPreviewDialog.tsx` | 39 | COMPLETE |  |
| `ToolDialogShell.tsx` | 38 | COMPLETE |  |
| `TopBar.tsx` | 227 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Sessions/` (5 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 639 | STUB | marker no-op |
| `post-session-answer.api.ts` | 181 | COMPLETE |  |
| `SessionAnalyticsDialog.tsx` | 758 | COMPLETE |  |
| `SessionReview.tsx` | 53 | COMPLETE |  |
| `TranscriptDialog.tsx` | 744 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Sessions/ActiveSession/` (6 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `answerScrollPolicy.test.ts` | 59 | TEST | test |
| `answerScrollPolicy.ts` | 36 | COMPLETE |  |
| `EndSessionDialog.tsx` | 163 | COMPLETE |  |
| `FloatingApp.tsx` | 2120 | COMPLETE | HTML entry (floating.html) |
| `page.tsx` | 2460 | COMPLETE |  |
| `Transcript.tsx` | 141 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Sessions/ActiveSession/components/` (19 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `AIAnswerButton.tsx` | 59 | COMPLETE |  |
| `AIChatPanel.tsx` | 97 | COMPLETE |  |
| `AnalyzeScreenButton.tsx` | 63 | COMPLETE |  |
| `ChatActionButtons.tsx` | 37 | COMPLETE |  |
| `ChatHeader.tsx` | 95 | COMPLETE |  |
| `ChatInput.tsx` | 67 | COMPLETE |  |
| `ChatMessage.tsx` | 501 | COMPLETE |  |
| `ChatMessageList.tsx` | 111 | COMPLETE |  |
| `ModelSelector.tsx` | 180 | COMPLETE |  |
| `OverlayContainer.tsx` | 72 | COMPLETE |  |
| `OverlayFooter.tsx` | 37 | ORPHANED | no importers |
| `OverlayHeader.tsx` | 34 | ORPHANED | no importers |
| `OverlayTranscript.tsx` | 66 | ORPHANED | no importers |
| `ScreenCapture.tsx` | 91 | COMPLETE |  |
| `SessionTimer.tsx` | 39 | COMPLETE |  |
| `StatusBadge.tsx` | 46 | COMPLETE |  |
| `TranscriptHeader.tsx` | 185 | COMPLETE |  |
| `TranscriptMessage.tsx` | 77 | COMPLETE |  |
| `TranscriptMessageList.tsx` | 166 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Sessions/components/` (3 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `PostSessionAnswerEditor.tsx` | 486 | COMPLETE |  |
| `TranscriptAnswerMarkdown.tsx` | 64 | COMPLETE |  |
| `TranscriptCodeBlock.tsx` | 27 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Sessions/components/AskAI/` (2 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `AskAIWorkspace.tsx` | 394 | COMPLETE |  |
| `types.ts` | 13 | COMPLETE |  |

### `artifacts/craft-vita/src/pages/Support/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `page.tsx` | 150 | COMPLETE |  |

### `artifacts/craft-vita/src/semantic/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `index.ts` | 9 | ORPHANED | semantic-engine barrel not imported by app code |

### `artifacts/craft-vita/src/semantic/engine/` (7 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `context-window-builder.ts` | 106 | ORPHANED | semantic-engine barrel not imported by app code |
| `continuation-detector.ts` | 60 | ORPHANED | semantic-engine barrel not imported by app code |
| `index.ts` | 11 | ORPHANED | semantic-engine barrel not imported by app code |
| `marker-matcher.ts` | 66 | ORPHANED | semantic-engine barrel not imported by app code |
| `semantic-engine.ts` | 72 | ORPHANED | semantic-engine barrel not imported by app code |
| `semantic-score.ts` | 59 | ORPHANED | semantic-engine barrel not imported by app code |
| `transcript-classifier.ts` | 128 | ORPHANED | semantic-engine barrel not imported by app code |

### `artifacts/craft-vita/src/semantic/markers/` (14 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `ai.markers.ts` | 119 | ORPHANED | semantic-engine barrel not imported by app code |
| `backend.markers.ts` | 126 | ORPHANED | semantic-engine barrel not imported by app code |
| `behavioral.markers.ts` | 161 | ORPHANED | semantic-engine barrel not imported by app code |
| `continuation.markers.ts` | 175 | ORPHANED | semantic-engine barrel not imported by app code |
| `database.markers.ts` | 147 | ORPHANED | semantic-engine barrel not imported by app code |
| `debugging.markers.ts` | 98 | ORPHANED | semantic-engine barrel not imported by app code |
| `deployment.markers.ts` | 126 | ORPHANED | semantic-engine barrel not imported by app code |
| `filler.markers.ts` | 135 | ORPHANED | semantic-engine barrel not imported by app code |
| `frontend.markers.ts` | 119 | ORPHANED | semantic-engine barrel not imported by app code |
| `index.ts` | 63 | ORPHANED | semantic-engine barrel not imported by app code |
| `noise.markers.ts` | 31 | ORPHANED | semantic-engine barrel not imported by app code |
| `scaling.markers.ts` | 105 | ORPHANED | semantic-engine barrel not imported by app code |
| `scenario.markers.ts` | 304 | ORPHANED | semantic-engine barrel not imported by app code |
| `system-design.markers.ts` | 267 | ORPHANED | semantic-engine barrel not imported by app code |

### `artifacts/craft-vita/src/semantic/rules/` (5 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `grouping.rules.ts` | 97 | ORPHANED | semantic-engine barrel not imported by app code |
| `index.ts` | 8 | ORPHANED | semantic-engine barrel not imported by app code |
| `scoring.rules.ts` | 29 | ORPHANED | semantic-engine barrel not imported by app code |
| `segmentation.rules.ts` | 104 | ORPHANED | semantic-engine barrel not imported by app code |
| `transcript-window.rules.ts` | 58 | ORPHANED | semantic-engine barrel not imported by app code |

### `artifacts/craft-vita/src/semantic/types/` (2 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `marker.types.ts` | 38 | ORPHANED | semantic-engine barrel not imported by app code |
| `semantic.types.ts` | 71 | ORPHANED | semantic-engine barrel not imported by app code |

### `artifacts/craft-vita/src/services/` (3 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `MiniRemoteAudio.ts` | 346 | ORPHANED | only self-references; hooks/useMiniRemoteAudio.ts is 0 bytes |
| `tauriEvents.ts` | 47 | COMPLETE |  |
| `tauriOverlay.ts` | 64 | COMPLETE |  |

### `artifacts/craft-vita/src/shared/components/` (4 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `CreditsBadge.tsx` | 41 | COMPLETE |  |
| `HoverTooltip.tsx` | 32 | COMPLETE |  |
| `RadioDot.tsx` | 14 | ORPHANED | no importers |
| `WidgetSelect.tsx` | 196 | COMPLETE |  |

### `artifacts/craft-vita/src/shared/utils/` (2 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `formatters.ts` | 50 | COMPLETE |  |
| `safeJson.ts` | 22 | COMPLETE |  |

### `artifacts/craft-vita/src/store/` (6 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `aiProjectsSlice.ts` | 277 | COMPLETE |  |
| `hooks.ts` | 7 | COMPLETE |  |
| `pricingSlice.ts` | 108 | COMPLETE |  |
| `resumeBuilderSlice.ts` | 904 | COMPLETE |  |
| `sessionsSlice.ts` | 249 | COMPLETE |  |
| `store.ts` | 23 | COMPLETE |  |

### `artifacts/craft-vita/src/tauri-stubs/` (12 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `api-app.ts` | 3 | STUB | web-build stub module |
| `api-core.ts` | 1 | STUB | web-build stub module |
| `api-event.ts` | 12 | STUB | web-build stub module |
| `api-webviewWindow.ts` | 11 | STUB | web-build stub module |
| `api-window.ts` | 33 | STUB | web-build stub module |
| `plugin-deep-link.ts` | 4 | STUB | web-build stub module |
| `plugin-dialog.ts` | 5 | STUB | web-build stub module |
| `plugin-fs.ts` | 7 | STUB | web-build stub module |
| `plugin-opener.ts` | 3 | STUB | web-build stub module |
| `plugin-process.ts` | 2 | STUB | web-build stub module |
| `plugin-updater.ts` | 1 | STUB | web-build stub module |
| `tauri-plugin-oauth.ts` | 2 | STUB | web-build stub module |

### `artifacts/craft-vita/src/types/` (3 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `ai-answer.test.ts` | 44 | TEST | test |
| `ai-answer.ts` | 310 | COMPLETE |  |
| `transcript.ts` | 51 | COMPLETE |  |

### `artifacts/craft-vita/src/utils/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `keywordExtractor.ts` | 94 | COMPLETE |  |

## 6.2 artifacts/craft-vita/src-tauri/src (Rust) — 6 files, 3447 LOC (BROKEN 3, COMPLETE 1, PARTIAL 1, ORPHANED 1)

### `artifacts/craft-vita/src-tauri/src/` (6 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `cursor.rs` | 10 | BROKEN | mod declared (lib.rs:3) but commands never registered/called; compiler warns never used |
| `deepgram.rs` | 543 | COMPLETE |  |
| `focus_bypass.rs` | 36 | BROKEN | mod declared (lib.rs:2) but install_focus_bypass() has no call sites; WinEvent callback body is empty |
| `lib.rs` | 2833 | PARTIAL | marker TODO |
| `main.rs` | 5 | ORPHANED | no importers |
| `screen_protect.rs` | 20 | BROKEN | mod declared (lib.rs:1) but set_screen_protection not registered; apply_on_create never called |

## 6.3 artifacts/api-server/src (Express API) — 43 files, 8189 LOC (COMPLETE 37, PARTIAL 2, ORPHANED 1, STUB 3)

### `artifacts/api-server/src/` (2 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `app.ts` | 62 | COMPLETE |  |
| `index.ts` | 66 | COMPLETE |  |

### `artifacts/api-server/src/lib/` (25 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `aiRateLimit.ts` | 54 | PARTIAL | process-local in-memory buckets; not shared across replicas (aiRateLimit.ts:30) |
| `answeredQuestionMemory.ts` | 144 | COMPLETE |  |
| `clerkAuth.ts` | 100 | COMPLETE |  |
| `corsPolicy.ts` | 8 | COMPLETE |  |
| `desktopAuth.ts` | 77 | COMPLETE |  |
| `desktopManifest.ts` | 75 | COMPLETE |  |
| `featureCredits.ts` | 368 | COMPLETE |  |
| `groundingGuard.ts` | 209 | COMPLETE |  |
| `htmlPdf.ts` | 156 | COMPLETE |  |
| `interviewPrompt.ts` | 147 | COMPLETE |  |
| `logger.ts` | 18 | COMPLETE |  |
| `openrouter.ts` | 288 | COMPLETE |  |
| `projectUpdates.ts` | 17 | COMPLETE |  |
| `purchaseCredit.ts` | 119 | COMPLETE |  |
| `questionReadiness.ts` | 102 | COMPLETE |  |
| `razorpay.ts` | 53 | COMPLETE |  |
| `resumeContext.ts` | 79 | COMPLETE |  |
| `resumeStorage.ts` | 81 | COMPLETE |  |
| `sessionCredits.ts` | 264 | COMPLETE |  |
| `sessionFeedback.ts` | 246 | COMPLETE |  |
| `sessionGenerationLock.ts` | 40 | COMPLETE |  |
| `sessionGrounding.ts` | 129 | COMPLETE |  |
| `signupGrant.ts` | 15 | COMPLETE |  |
| `uploadValidation.ts` | 26 | COMPLETE |  |
| `upsertUser.ts` | 37 | ORPHANED | no importers |

### `artifacts/api-server/src/middlewares/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `requireAuth.ts` | 102 | COMPLETE |  |

### `artifacts/api-server/src/routes/` (15 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `ai.ts` | 58 | COMPLETE |  |
| `askAI.ts` | 215 | COMPLETE |  |
| `assistant.ts` | 371 | STUB | marker no-op |
| `auth.ts` | 177 | COMPLETE |  |
| `credits.ts` | 426 | STUB | marker no-op |
| `desktop.ts` | 262 | PARTIAL | desktop token/link routes; refresh token travels as bearer, see docs/HireShade-Full-Audit.md |
| `documents.ts` | 143 | COMPLETE |  |
| `health.ts` | 8 | COMPLETE |  |
| `index.ts` | 31 | COMPLETE |  |
| `projectCategories.ts` | 19 | COMPLETE |  |
| `projects.ts` | 578 | STUB | marker no-op,not implemented |
| `questionBank.ts` | 230 | COMPLETE |  |
| `resumes.ts` | 870 | COMPLETE |  |
| `sessionNotes.ts` | 62 | COMPLETE |  |
| `sessions.ts` | 1657 | COMPLETE |  |

## 6.4 artifacts/mockup-sandbox/src (UI sandbox) — 61 files, 5498 LOC (COMPLETE 17, ORPHANED 44)

### `artifacts/mockup-sandbox/src/` (2 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `App.tsx` | 124 | COMPLETE |  |
| `main.tsx` | 4 | COMPLETE |  |

### `artifacts/mockup-sandbox/src/.generated/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `mockup-components.ts` | 4 | COMPLETE |  |

### `artifacts/mockup-sandbox/src/components/ui/` (55 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `accordion.tsx` | 49 | ORPHANED | no importers |
| `alert-dialog.tsx` | 126 | ORPHANED | no importers |
| `alert.tsx` | 53 | ORPHANED | no importers |
| `aspect-ratio.tsx` | 3 | ORPHANED | no importers |
| `avatar.tsx` | 44 | ORPHANED | no importers |
| `badge.tsx` | 32 | ORPHANED | no importers |
| `breadcrumb.tsx` | 105 | ORPHANED | no importers |
| `button-group.tsx` | 76 | ORPHANED | no importers |
| `button.tsx` | 53 | COMPLETE |  |
| `calendar.tsx` | 203 | ORPHANED | no importers |
| `card.tsx` | 68 | ORPHANED | no importers |
| `carousel.tsx` | 231 | ORPHANED | no importers |
| `chart.tsx` | 330 | ORPHANED | no importers |
| `checkbox.tsx` | 25 | ORPHANED | no importers |
| `collapsible.tsx` | 6 | ORPHANED | no importers |
| `command.tsx` | 136 | ORPHANED | no importers |
| `context-menu.tsx` | 181 | ORPHANED | no importers |
| `dialog.tsx` | 108 | COMPLETE |  |
| `drawer.tsx` | 104 | ORPHANED | no importers |
| `dropdown-menu.tsx` | 183 | ORPHANED | no importers |
| `empty.tsx` | 95 | ORPHANED | no importers |
| `field.tsx` | 225 | ORPHANED | no importers |
| `form.tsx` | 151 | ORPHANED | no importers |
| `hover-card.tsx` | 22 | ORPHANED | no importers |
| `input-group.tsx` | 151 | ORPHANED | no importers |
| `input-otp.tsx` | 62 | ORPHANED | no importers |
| `input.tsx` | 19 | COMPLETE |  |
| `item.tsx` | 179 | ORPHANED | no importers |
| `kbd.tsx` | 25 | ORPHANED | no importers |
| `label.tsx` | 21 | COMPLETE |  |
| `menubar.tsx` | 236 | ORPHANED | no importers |
| `navigation-menu.tsx` | 117 | ORPHANED | no importers |
| `pagination.tsx` | 107 | ORPHANED | no importers |
| `popover.tsx` | 25 | ORPHANED | no importers |
| `progress.tsx` | 24 | ORPHANED | no importers |
| `radio-group.tsx` | 38 | ORPHANED | no importers |
| `resizable.tsx` | 39 | ORPHANED | no importers |
| `scroll-area.tsx` | 42 | ORPHANED | no importers |
| `select.tsx` | 146 | ORPHANED | no importers |
| `separator.tsx` | 26 | COMPLETE |  |
| `sheet.tsx` | 125 | COMPLETE |  |
| `sidebar.tsx` | 660 | ORPHANED | no importers |
| `skeleton.tsx` | 13 | COMPLETE |  |
| `slider.tsx` | 23 | ORPHANED | no importers |
| `sonner.tsx` | 26 | ORPHANED | no importers |
| `spinner.tsx` | 13 | ORPHANED | no importers |
| `switch.tsx` | 24 | ORPHANED | no importers |
| `table.tsx` | 110 | ORPHANED | no importers |
| `tabs.tsx` | 47 | ORPHANED | no importers |
| `textarea.tsx` | 19 | COMPLETE |  |
| `toast.tsx` | 115 | COMPLETE |  |
| `toaster.tsx` | 31 | ORPHANED | no importers |
| `toggle-group.tsx` | 52 | ORPHANED | no importers |
| `toggle.tsx` | 38 | COMPLETE |  |
| `tooltip.tsx` | 25 | COMPLETE |  |

### `artifacts/mockup-sandbox/src/hooks/` (2 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `use-mobile.tsx` | 15 | COMPLETE |  |
| `use-toast.ts` | 159 | COMPLETE |  |

### `artifacts/mockup-sandbox/src/lib/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `utils.ts` | 5 | COMPLETE |  |

## 6.5 lib/*/src (shared/generated packages) — 10 files, 886 LOC (STUB 2, COMPLETE 5, ORPHANED 3)

### `lib/api-client-react/src/` (2 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `custom-fetch.ts` | 305 | STUB | marker not implemented |
| `index.ts` | 4 | COMPLETE |  |

### `lib/api-client-react/src/generated/` (2 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `api.schemas.ts` | 10 | COMPLETE |  |
| `api.ts` | 84 | ORPHANED | no importers |

### `lib/api-zod/src/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `index.ts` | 2 | COMPLETE |  |

### `lib/api-zod/src/generated/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `api.ts` | 15 | ORPHANED | no importers |

### `lib/api-zod/src/generated/types/` (2 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `healthStatus.ts` | 10 | ORPHANED | no importers |
| `index.ts` | 8 | COMPLETE |  |

### `lib/db/src/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `index.ts` | 12 | COMPLETE |  |

### `lib/db/src/schema/` (1 files)

| File | LOC | Class | Note |
|---|---:|---|---|
| `index.ts` | 436 | STUB | marker no-op |
