# TARGET_VERIFIED — ParakeetAI (parakeet-ai.com) mechanism verification

**Phase B.** Observed **2026-10-20** (Asia/Calcutta). Target `https://www.parakeet-ai.com` (not the parked `parakeetai.com`).
Method: static analysis of the **shipped desktop artifact** (macOS universal build 3.9.126) + live web endpoints + Wayback fallback. No installer executed. No product code touched.
Raw captures: `docs/raw/**`. REA export: `docs/rea-evidence/**` (see its README for why there is no session bundle).

Unless stated otherwise the file is `docs/raw/desktop/asar-extracted/dist/main/main.js`
(2,079,069 bytes, sha256 `436c826f…`) or `docs/raw/desktop/asar-extracted/dist/renderer/renderer.js`
(4,228,820 bytes, sha256 `023ee743…`).

**Offset grounding.** The lead's independent scan `docs/raw/desktop/target-scan.json` is folded into the rows below.
His reported offsets index the file as a JS string (character positions); the offsets I re-measured are **byte**
offsets. Because `main.js` contains multi-byte characters, the two differ by up to ~220. Both point into the same
statement, but **for byte-exact citations use the anchor table in §"Verified byte anchors"**, which is what a
`Buffer.slice`/debugger jump needs. Rows cite `target-scan` where the lead supplied it and my byte offset where I
measured it; all anchors were re-verified against the file.

## Artifact provenance (integrity verified)

| Artifact | Bytes | SHA-256 |
|---|---|---|
| ParakeetAI-3.9.126-universal-mac.zip | 234169902 | `72b894d1b8076dc5def3340591588ae228c52d67e58133672c0438651345dfa4` (= GitHub release asset digest) |
| app.asar | 177211775 | `01042a40df1b5de1b69eebc77a59d357a202af3e209eb43254952a744213541e` |
| dist/main/main.js | 2079069 | `436c826f5dc760e578c9ab5df5ebc4a06ff227b0678f9efc5f1707bffb989263` |
| dist/main/preload.js | 4247 | `08ba32522a2d5b88e494f43b13779c16c11ffa25947e5a93e365a5cefdb2d252` |
| dist/renderer/renderer.js | 4228820 | `023ee743e7cb84a5ed50225463ce2db8977c5aa0c391d1440ad9e79e6f0872b4` |
| parakeetai-native.win32-x64-msvc.node | 1369088 | `a2fca0ac2db730e4ba8ec89723c092c9e2b6e6a2bd11cd8962449bae3892c803` |
| parakeetai-native.darwin-arm64.node | 1014864 | `9a23cc24924f60130c961004078284e2d9d2b9d6a76c0038052d415bcb1cfc72` |

REA evidence (canonical record, provenance of the zip): **`ev_14a1a121ebd69549f58b44eca2fd529074d9fbd0894fe6cf105f45e0e9ae8de2`**,
`inspection_id = ai_b9aeba7987771fd07bee57f4d0fe1bc5038b4592b61e801a99c96bc4e042a61f` → `docs/rea-evidence/rea-inspect-artifact.json`.

**How the gated download was found:** the site's own public tRPC read procedure leaks the release manifest.
`GET /api/trpc/configuration.getLatestRelease,billing.getPrices?batch=1&input=…` → 200 JSON:
`{"version":"v3.9.126","downloads":{"windows":"…/ParakeetAI-Setup-3.9.126.exe","mac":"…/ParakeetAI-3.9.126.dmg"}}`
(`docs/raw/probes/trpc-latestRelease.json`). Release assets incl. `latest.yml`/`latest-mac.yml`/`.blockmap`: `docs/raw/probes/gh-release-latest.json`.

## Verification rows T-01 … T-16

| # | Mechanism | Claim (what they actually do) | Evidence (path @offset / ID) | Status | Implication for ./hireshade |
|---|---|---|---|---|---|
| **T-01** | **Shell** | Electron app, packaged with **electron-builder**; production `main` = `./dist/main/main.js`; renderer is a local React bundle (`dist/renderer/renderer.js`) that talks to the remote web API; Electron main is webpack-bundled (`__webpack_require__` module ids). Ship artefacts: NSIS `.exe`, universal `.dmg`, `-universal-mac.zip`, electron-updater `latest*.yml` + `.blockmap`. | `Contents/Frameworks/Electron Framework.framework`; `asar-extracted/package.json` (`{"name":"parakeetai-desktop","version":"3.9.126","main":"./dist/main/main.js"}`); `docs/raw/desktop/gh-release-latest.json` | **OBSERVED** | Electron + electron-builder + electron-updater is a proven, boring stack. Local renderer + remote API keeps the shell thin (we should do the same rather than shipping a full web app). |
| **T-02** | **Overlay window flags** | One single `BrowserWindow` for everything (dashboard *and* overlay): `transparent:true, roundedCorners:false, hasShadow:false, alwaysOnTop:true, frame:false, resizable:false, skipTaskbar:true, hiddenInMissionControl:true, movable:false, type:"panel"`; `webPreferences.experimentalFeatures:true`; `setIgnoreMouseEvents(true,{forward:true})` immediately after creation. Exactly **1** `new BrowserWindow(` in main.js. | `target-scan.json` → `alwaysOnTop` @**1827660** (`"…movable:!1,type:"panel"}`); `skipTaskbar` @1827697; `setIgnoreMouseEvents` @**1828572** | **OBSERVED** | Copy the flag set verbatim. `type:"panel"` + `hiddenInMissionControl` are the macOS non-activating bits; `transparent` requires `hasShadow:false`/`roundedCorners:false` or you get a 1 px halo. |
| **T-03** | **Always-on-top over fullscreen + no occlusion pause** | Windows: `setAlwaysOnTop(true,"screen-saver",1)` **re-asserted every 1000 ms** by a `setInterval`, plus `webContents.setBackgroundThrottling(false)`. macOS: `setVisibleOnAllWorkspaces(true,{visibleOnFullScreen:true})`. Windows also `appendSwitch("disable-features","CalculateNativeWinOcclusion")`. | `target-scan.json` @**1827782** (level) and @**1827907** (`},1e3)` watchdog); occlusion switch @1833369 region | **OBSERVED** | Three separate mechanisms are needed; a naive `alwaysOnTop:true` loses to fullscreen Zoom/Teams and stops painting when covered. Copy all three. |
| **T-04** | **Screen-share exclusion** | Sole primitive is Electron **`setContentProtection(bool)`**, driven by a persisted "private mode": `setPrivateMode(e){ mainWindow.setContentProtection(e); emit("main/private-mode-changed",e) }; setSetting("isPrivate",e)`. Re-applied (`resetPrivateMode`) every time the live-call screen becomes visible. No `WDA_EXCLUDEFROMCAPTURE`/`NSWindowSharingNone`/`SetWindowDisplayAffinity` string exists anywhere (grep = 0). | `target-scan.json` `contentProtection` @**1847067**; visibility handler @1859970 (IPC `renderer/set-is-live-call-session-screen-visible`) | **OBSERVED** | Use `setContentProtection` only — do not hand-roll affinity APIs. Persist the flag and re-apply on every show, or a re-created window silently becomes capturable. (Electron→`WDA_EXCLUDEFROMCAPTURE`/`NSWindowSharingNone` mapping is **INFERRED**, it is Electron-internal.) |
| **T-05** | **Dock / taskbar invisibility + process naming** | `skipTaskbar:true` at creation; `setSkipTaskbar(true)` is *forced even in the focusable branch* (`setFocusable(t); t ? (setSkipTaskbar(true), focus()) : blur()`). macOS: `app.dock.hide()` on create/focus/start-hidden **and a 2000 ms poll** that re-hides if visible ("Dock poll: dock visible, re-hiding"). `Info.plist` has **no `LSUIElement`**, **no `LSBackgroundOnly`**. `CFBundleName` = **U+2800 BRAILLE PATTERN BLANK**, so all helpers are "⠀ Helper*.app". Windows: `setAppUserModelId("org.parakeetai.ParakeetAI")` (no disguise). | target-scan `lsuielement` @**1826742**, dock re-hide @**1835942**; `setSkipTaskbar` @**1859639**; `Info.plist` @byte 522 (`CFBundleName`), misses for `LSUIElement`/`LSBackgroundOnly` | **OBSERVED** | Prefer `LSUIElement:true` in Info.plist over their 2 s dock poll (their approach flashes the Dock and burns a timer). The U+2800 name trick is cosmetic obfuscation — skip it. |
| **T-06** | **Click-through** | Not a mode: a renderer hook (`usePointerPassThrough`) listens to `mousemove`, throttles to **40 ms**, and flips IPC `renderer/set-ignore-mouse-events` to `!target.matches("[data-transparent='true']")`; main does `setIgnoreMouseEvents(bool,{forward:true})`. Pass-through is suppressed while dragging (`dragState`) and cleared on `mouseleave`. | `setIgnoreMouseEvents(true,{forward:true})` @**1828572**; IPC @**1859183**; renderer module 63764 @2460000–2461000 region (throttle `40`, `[data-transparent='true']`) | **OBSERVED** | Copy the dynamic hit-test + `{forward:true}`. A static toggle is much worse UX, and without `forward` you stop receiving `mousemove` and can never turn clicking back on. |
| **T-07** | **Global hotkeys** | Two sets, registered/unregistered with visibility: **app set** while app visible — `CommandOrControl+Shift+Up/Down/Left/Right`; **live-call set** while the live-call screen is visible — `CommandOrControl+Enter` (primary answer), `CommandOrControl+Shift+Enter` (secondary), `CommandOrControl+Up/Down` (prev/next message), `CommandOrControl+H` (hide overlay), `CommandOrControl+Left/Right` (prev/next AI message). Each emits a `main/*-shortcut-pressed` IPC. | app set `dist/main/main.js` @**1847573**; live-call set @**1862379** (`registerLiveCallSessionScreenShortcuts`) | **OBSERVED** | Copy the register/unregister pairing keyed to visibility — it is what avoids stealing system-wide keys the rest of the time. Note they use `CommandOrControl` everywhere (one binding for both OSes). |
| **T-08** | **System-audio loopback** | Two layers. **(a) Windows/native:** a Rust napi-rs addon (`@parakeetai-desktop/native-modules`) exporting `OutputLoopbackCapture`, `AudioProcessor`, `listOutputDevices`, `getActiveAudioInputProcesses`; the win32 binary embeds `src\output_loopback\api.rs`, `src\output_loopback\convert.rs` and the **`sonora`** crate (`sonora-common-audio`, `push_resampler`) → **WASAPI loopback**. **(b) Chromium:** `electron-audio-loopback` appended `--enable-features=PulseaudioLoopbackForScreenShare,MacLoopbackAudioForScreenShare,(MacCatapSystemAudioLoopbackCapture|MacSckSystemAudioLoopbackOverride)` and installs `setDisplayMediaRequestHandler` returning `{video:sources[0], audio:"loopback"}` (`"loopbackWithMute"` variant), `{useSystemPicker:true}`. **On macOS the native addon refuses:** "Output loopback capture is only supported on Windows". | feature flags @**1402656**; handler @**1835724**; exports `main.js` @1814573; addon strings win32 @1082154/1118846, darwin @789741; dep `node_modules/electron-audio-loopback/package.json` (asar-filelist line 767) | **OBSERVED** | Do **not** ship BlackHole/VB-Cable (they don't; 0 mentions). Windows: WASAPI loopback in a native addon (or `sonora` directly). macOS: Chromium Core Audio tap via `MacCatapSystemAudioLoopbackCapture` + `getDisplayMedia`. Keep `AudioProcessor`/`getActiveAudioInputProcesses` native for VAD + "who is on mic" detection. |
| **T-09** | **ASR transport + message shapes** | **WebSocket** to Speechmatics realtime, **JWT in the query string**: `new WebSocket(url+"?jwt="+token)` (+ optional `sm-app`, `sm-enable-legacy`). Default `wss://eu2.rt.speechmatics.com/v2`; constant `SPEECHMATICS_REALTIME_URL="wss://global.rt.speechmatics.com/v2"`, `SPEECHMATICS_MODEL="enhanced"`. Wire format `{type:"raw",encoding:"pcm_f32le",sample_rate:16000}` with `AUDIO_CONFIG={sampleRate:16e3}`. Client events: `sendAudio(bytes)` (seq via `lastAudioAddedSeqNo`), `AddPartialTranscript`, `AddTranscript`, `EndOfUtterance`; watchdogs on `lastAudioAddedAt`/silence. **Two sockets**: "Microphone" and "Screen Sharing". Language string may carry a domain suffix (`"en:medical"` split). | `dist/renderer/renderer.js` @774341 (URL+JWT), @2205807 (model/URL/PCM); CSP `connect-src wss://*.rt.speechmatics.com` @**1853458** | **OBSERVED** | Their ASR is *bought*, not built: one WS per audio source, 16 kHz f32le mono, ephemeral JWT from our server. Keep partial + final + end-of-utterance events distinct (the UI depends on it), and keep a liveness watchdog on "audio added". |
| **T-10** | **LLM token transport** | **SSE, not WS**: `POST {apiUrl}/api/chat` through the Vercel **AI SDK** (`useChat` + `DefaultChatTransport`), custom `fetch`, headers `x-parakeet-request-source: desktop-chat`, `x-parakeet-desktop-app-version`, `x-parakeet-desktop-os[-version]`; `prepareSendMessagesRequest` requires `lastMessage.metadata.trigger`. SSE headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache, no-transform`, `X-Accel-Buffering: no`. Transcript batches flush over `POST /api/callSession/transcript` (detection outcome returned in `x-parakeet-detection` response header). Everything else is tRPC v11 batch at `/api/trpc` (superjson, `maxURLLength:4000`). Mock-interview voice is separate: **OpenAI Realtime over WebRTC** (`POST https://api.openai.com/v1/realtime/calls`, SDP body, ephemeral bearer). | renderer @2457324 (`/api/chat`), @1876190 (useChat/transport), @2472577 (tRPC), @2461289 (transcript flush), @2200723 (OpenAI realtime), @3322329 (SSE headers) | **OBSERVED** | Copy the split: **ASR=WS, answers=SSE, everything else=tRPC batch**. `X-Accel-Buffering: no` matters behind nginx. Unauthenticated `/api/chat` → `401 {"message":"UNAUTHORIZED","appCode":"UNAUTHORIZED"}` (`docs/raw/probes/probe_api_chat.txt`). |
| **T-11** | **Prompt assembly / resume injection** | Client sends only references: session created with `{…createInputFromFormValues, createdFrom:"desktop-app", autoStarted, activationParameters:{platform:"desktop-app",os,osVersion,version,meetingApp}}`; resume chosen by `resumeId` (+`selectedResumeId`, `knownResumeIds`, `documentIds`), plus answer-preference form values `{language, aiModel, responseLength, responseFormat, responseTone, useStarMethod, useFillerWords, autoAnswer, saveTranscription, transcriptionContext}` and free-text `systemInstructions` (`useInstructionsDraft`, `hasInstructions`, `documentCustomPrompt`). Per-model first-token table `aiModelTtftMs` + `aiModelNameMap` drive the model picker. **The actual system prompt / resume→prompt rendering is server-side and was NOT observed.** | renderer @2264007 (create payload), @2459000 (form values), @**1950410** (`aiModelNameMap`/`aiModelTtftMs`), @1717395 (`useInstructionsDraft`) | **PARTIAL** — client contract OBSERVED, server prompt **INFERRED/UNKNOWN** | Our API must accept the same reference-style contract (`resumeId` + preference object + instructions string) and own prompt assembly server-side. Do not over-invest in guessing their prompt text; the *contract* is the reusable part. |
| **T-12** | **Credits / billing** | `SESSION_CREDIT_COST=0.5`, `MAX_CALL_DURATION_MINUTES=30`, `MAX_TRIAL_DURATION_MINUTES=10`, `FREE_SESSION_EXTENSION_MINUTES=20`, `FREE_SESSION_COOLDOWN_MINUTES=12`, `PU=10` free sessions unlocked per credit purchase, `SESSION_RECENTLY_ENDED_WINDOW_MINUTES=5`, `AUTO_EXTEND_HEADROOM_SECONDS=15`, `AUTO_EXTEND_PROMPT_THRESHOLD_MS=60000`, `AUTO_EXTEND_PROMPT_DISMISS_MS=15000`, `CALL_SESSION_LIST_POLL_MS=5000`. → free trial 10 min; +20 min costs 0.5 credit; then 0.5 credit per +30 min, auto-extending. Ledger events `credit_ledger.{drift,spent,refunded}`, refunds `credit_refund_{automated,blocked,queue_failed}`, `INSUFFICIENT_CREDITS`, heartbeat `callSession.ping`, `callSession.getLiveCount`. Prices live from `billing.getPrices` (USD+INR, EUR null): credit_1 $25 / credit_3 $39 / credit_6 $78 / credit_9 $117; subscription weekly $52 / monthly $99.90 / yearly $399.90; prepaid_yearly $399.90; prepare monthly $30.70 / yearly $122.90; resume_download $10.98; lifetime_plan $599.90. Refunds refused for *used* entitlements except "a technical issue on our side". | `dist/renderer/renderer.js` @**2160177** (`t.SESSION_CREDIT_COST=.5`, inside the constants module that begins @2159779); `docs/raw/probes/trpc-billing.getPrices.json` (live, 8454 B); refund copy `docs/raw/assets/chunks_01gwe1qm--8c1.js` | **OBSERVED** | Adopt the same unit (0.5 credit / 30 min, 10-min trial) and — more importantly — the **ledger + drift detection + automated refund queue**. That is what makes "used vs unused" refund decisions auditable. |
| **T-13** | **Meeting detector** | Process/title poller in main: `startMeetingDetector`, `matchWebMeetingService`, `getMeetingAppSlug`, `isAllowedMeetingApp`, `isBrowserMeetingApp`; table of 20 slugs with `appIds` (macOS bundle ids), `processNames` (Windows exes), `namePatterns`, and `titlePatterns` for browser/web variants. Browsers: chrome, firefox, safari, edge, arc, brave, opera (title-matched). Apps: zoom, slack, webex, microsoft_teams, whatsapp, lark, amazon_chime, discord. Web: `google_meet`, `zoom_web`, `microsoft_teams_web`. Drives "start overlay automatically"; `autoDetectMeetings` setting also gates start-hidden behaviour. | `dist/main/main.js` @**1815519** (service table); state machine @1836435 region | **OBSERVED** | Copy the three-signal model (bundle id / process name / window title) and the browser-vs-app distinction. Cheap to build, and it is the whole "it just appears" magic. |
| **T-14** | **Languages** | No hard-coded language list in the client: `useTranscriptionLanguages()` fetches per-session languages from the server (`getLanguages/listLanguages`, `enrolledLanguages`), UI helper `getLanguageLabel`, `isUpdatingLanguage`, `sessionLanguage`; the chosen code is passed to Speechmatics (`language`, optional `:domain` suffix). | `dist/renderer/renderer.js` identifiers `subLanguage(22) getLanguageLabel(9) useTranscriptionLanguages(6)`; splitter @2205807 | **PARTIAL** — mechanism OBSERVED, **language count UNKNOWN** | Fetch the language list from our backend (do not hard-code), and keep the `language[:domain]` string format so ASR domains stay possible. |
| **T-15** | **Packaging / updater** | electron-updater with **GitHub Releases**: `app-update.yml` = `{owner: parakeetai, repo: parakeetai-desktop-releases, provider: github, updaterCacheDirName: parakeetai-desktop-updater}`; assets `latest.yml`, `latest-mac.yml`, `*.blockmap`; `checkAndInstallUpdate({severity:"forced"|"all"})` called on overlay hide and window-all-closed; startup registers `setLoginItemSettings({openAtLogin:true, args:["--was-opened-at-login"]})`; deep link protocol `parakeetai` (dev `parakeetai-local`); secrets in `safeStorage`. Also `app.setAsDefaultProtocolClient`, `removeAsDefaultProtocolClient("parakeetai"/"parakeetai-dev")` in dev, and dev-only `--remote-debugging-port=9223`. | `app-update.yml`; `docs/raw/desktop/latest.yml`, `latest-mac.yml`; `dist/main/main.js` @**1833369** (PROTOCOL/AppUserModelId/debug port), @1835002 (login item), @1871965 (safeStorage) | **OBSERVED** | GitHub Releases + electron-updater is free and adequate for a private release repo. Mirrors can come later. Note their auto-start at login is unconditional in code — we should make that opt-in. |
| **T-16** | **Tray** | A `Tray` is created only when meeting auto-detect is enabled (`registerTray`), and re-created on `window-all-closed` when `autoDetectMeetings` is enabled; the tray is unregistered when the window regains focus (`unregisterTray`). Tray label includes "Meeting Detect enabled". | `dist/main/main.js` @**1870719** (tray template/label), `registerTray`/dock interplay @1826742 | **OBSERVED** | Tray is the honest alternative to hiding the Dock: use a tray icon as the primary affordance and skip the dock-hiding arms race. |

## Verified byte anchors

Byte offsets re-measured with `docs/raw/_scripts/anchors.mjs` (main.js) and `_scripts` equivalents (renderer.js).
Use these for byte-exact jumps; `target-scan.json` gives character positions for the same statements.

| anchor | file | byte offset |
|---|---|---|
| `setContentProtection` | main.js | **1847285** |
| `"main/private-mode-changed"` | main.js | 1847342 |
| `transparent:!0,roundedCorners` | main.js | **1827832** |
| `alwaysOnTop:!0,frame:!1` | main.js | 1827878 |
| `setAlwaysOnTop(!0,"screen-saver",1)` | main.js | **1828000** |
| `setIgnoreMouseEvents(!0,{forward:!0})` (creation) | main.js | **1828790** |
| `"renderer/set-ignore-mouse-events"` IPC | main.js | 1859312 |
| `setIgnoreMouseEvents(t,{forward:!0})` (IPC body) | main.js | 1859411 |
| `setFocusable(t)` | main.js | 1859835 |
| `setSkipTaskbar(!0)` | main.js | **1859867** |
| `app.dock.hide()` (first) | main.js | 1827040 |
| `"Dock poll"` (2 s re-hide log) | main.js | **1836211** |
| `t.registerAppShortcuts=function` | main.js | **1847537** |
| `t.registerLiveCallSessionScreenShortcuts=function` | main.js | **1862377** |
| `setDisplayMediaRequestHandler` | main.js | **1404379** |
| `t.buildFeatureFlags=` (loopback flags) | main.js | **1402644** |
| `t.registerTray=function` | main.js | **1870744** |
| `t.AUDIO_CONFIG=` (16 kHz) | main.js | 1818463 |
| `startMeetingDetector` | main.js | 1836278 |
| `t.SESSION_CREDIT_COST=.5` (constants module @2159779) | renderer.js | **2160177** |
| `aiModelNameMap=` | renderer.js | **1950410** |
| `/api/chat` | renderer.js | **2457324** |
| `prepareSendMessagesRequest` | renderer.js | 1876383 |
| `https://api.openai.com/v1/realtime/calls` | renderer.js | **2200867** |
| `REALTIME_TURN_DETECTION` | renderer.js | 2201779 |
| `x-parakeet-desktop-app-version` | renderer.js | 2224845 |
| `useInstructionsDraft=function` | renderer.js | 1717395 |

## Summary counts

- **OBSERVED:** T-01, T-02, T-03, T-04, T-05, T-06, T-07, T-08, T-09, T-10, T-12, T-13, T-15, T-16 → **14**
- **PARTIAL (mechanism observed, one sub-claim not observable):** T-11 (prompt assembly), T-14 (language count) → **2**
- **UNKNOWN:** 0 rows; sub-claims explicitly flagged UNKNOWN: server-side system prompt text, resume→prompt rendering, exact `/api/chat` body schema, total supported-language count.

## Supporting detail (short)

- **Overlay geometry:** fills display work area minus 12 px per side (`x+12,y+12,w-24,h-24`); macOS temporarily zeroes min/max size; Windows with `scaleFactor!==1` first sets `{x:c/l,y:u/l,width:1,height:1}` to escape DPI scaling, then real bounds (`main.js` @1825526).
- **Additional argv flags:** `--show-meeting-start-toast-only=`, `--shell-theme=`, `--live-call-theme=` (theme passed into the renderer via `additionalArguments`).
- **Preload surface** (`preload.js`, 4247 B): `electron.{ipcRendererProxy, platform, osVersion, enableLoopbackAudio(), disableLoopbackAudio(), showMeetingStartNotificationOnly, initialThemeSettings}` + `__SENTRY_IPC__`.
- **Auth:** Auth.js at `/api/auth/*`, providers **google, apple, email** (live `/api/auth/providers`); protected routes 307 → `/auth/signin?callbackUrl=…` (incl. `/auth/desktop`, `/dashboard/callSessions`, `/callSession/:id/desktop`). Desktop auth handoff uses the `parakeetai://` protocol + `safeStorage`; the handoff payload itself was not observable.
- **Model picker:** `aiModelNameMap` (aliases) + `aiModelTtftMs` (e.g. `gpt-5:506, claude-sonnet-4-5:1774, claude-haiku-4-5:1208, gemini-3-1-flash-lite:387, gemini-3-6-flash:758, gemini-3-5-flash-lite:474, gemini-3-5-flash:null, gpt-4.1:null, cerebras-gpt-oss-120b:null, claude-sonnet-5:1774, claude-opus-5:1554, gpt-5-6-sol:506`).
- **Session lock:** one client per call session, second client must `callSession.takeOver` (`callSessionLockBus`, `ServerError.isCallSessionLockedToOtherClient`).
- **Privacy scrubbing:** Sentry `beforeSend` drops/scrubs `transcript, transcripts, content, transcriptFormatted, transcriptEvents, question, answer, prompt, resume, resumes`; Sentry DSN EU (`o4511434168008704.ingest.de.sentry.io`); Mixpanel EU; FingerprintJS (`m1.openfpcdn.io`); UploadThing; Neon Postgres; Vercel hosting.

## Blocked / unverified

| Item | Status | Evidence of the blocker |
|---|---|---|
| Signed-in web surfaces (`/dashboard/*` 30+ routes, `/callSession/:id/desktop`, admin `prompt-testing/*`, `llm-usage`) | **BLOCKED** | 307 → `/auth/signin`; needs a Google/Apple/email account (`docs/raw/pages/dashboard_callSessions.html`, `docs/raw/probes/requested-paths.txt`) |
| Server-side prompt assembly, resume→prompt rendering, question-bank retrieval | **UNKNOWN** | Runs behind auth; only the client contract observed (T-11) |
| `POST /api/chat` request/response schema | **UNKNOWN** beyond 401 | `docs/raw/probes/probe_api_chat.txt` = `{"message":"UNAUTHORIZED","appCode":"UNAUTHORIZED"}` |
| Windows installer runtime behaviour (DPI/WASAPI at runtime) | **NOT MEASURED** | Static only by rule (no executing untrusted installers). Windows-specific code was read from the win32 `.node` binary and the shared JS |
| Electron/Chromium version | **NOT EXTRACTED** | `package.json` inside asar has no deps; `Electron Framework.framework/Resources/Info.plist` would be the follow-up |
| REA deep/native analysis | **UNAVAILABLE** | `rea analyze <native .node>` → `provider_unavailable` (Ghidra/IDA/Hopper not configured). `rea analyze-javascript-application` stalled at 0/1 after ~15 min. `rea evidence-export` needs an MCP session bundle (`mcp__rea__*` not present). Details: `docs/rea-evidence/README.md` |
| Language count | **UNKNOWN** | Served per-session by the backend; no client-side list (T-14) |

## Retry log (3-way rule)

| Goal | 1) curl + real UA | 2) headless browser | 3) Wayback | Result |
|---|---|---|---|---|
| Desktop installer URL | `/download*`, `/latest.yml`, `/api/releases/latest` → 404 | not needed | CDX exposed `/api/trpc/configuration.getLatestRelease` | **Solved** (public tRPC) |
| Pricing | live `billing.getPrices` → 200 | — | `id_` replay 404 (comma/encoding), CDX gave exact encoded URL | **Solved** (live) |
| Signed-in app | 307 → signin (repeated) | Chrome + Playwright cache + REA `capture-browser-scenario` exist, **no credentials** | no archived authenticated pages | **Blocked**, documented |
| Native addon internals | `rea analyze` → provider missing | — | — | Bounded to strings/import-table evidence |
| Windows exe | 233.8 MB asset reachable | — | — | Deliberately not fetched; mac build carries same JS + both addons |

## Top implications (ranked)

1. Copy the **overlay flag matrix + 3 watchdog mechanisms** (T-02/T-03). Non-obvious: `type:"panel"`+`hiddenInMissionControl`, `screen-saver` level re-assert every 1 s, `disable-features=CalculateNativeWinOcclusion`.
2. Copy **`setContentProtection` as the only exclusion primitive**, persisted and re-applied on every show (T-04).
3. Copy **dynamic click-through** (`[data-transparent]` hit-test, 40 ms throttle, `{forward:true}`) (T-06).
4. Copy **native WASAPI loopback on Windows + Core Audio tap on macOS**; never BlackHole/VB-Cable (T-08).
5. Copy the **transport split**: ASR over WS (16 kHz f32le, JWT), answers over SSE (`X-Accel-Buffering: no`), rest over tRPC batch (T-09/T-10).
6. Copy the **credit unit + ledger/drift/refund-queue** (T-12); the pricing table is in this doc.
7. Prefer **`LSUIElement` + tray** over hiding the Dock with a 2 s poll, and **skip the U+2800 name trick** (T-05/T-16).
8. Make **launch-at-login opt-in** (they set `openAtLogin:true` unconditionally).
