# Sessions and Desktop Technical Review

## Scope

This review covers the Interview Sessions flow, AI answer generation, transcript rendering, desktop/Tauri flow, launcher, floating session UI, and related runtime risks.

Source areas:

- `artifacts/craft-vita/src/features/session`
- `artifacts/craft-vita/src/pages/Sessions`
- `artifacts/craft-vita/src/components/Sessions`
- `artifacts/craft-vita/src/overlay`
- `artifacts/craft-vita/src/pages/Launcher`
- `artifacts/craft-vita/src/capture`
- `artifacts/craft-vita/src/services/tauriOverlay.ts`
- `artifacts/craft-vita/src/services/MiniRemoteAudio.ts`
- `artifacts/craft-vita/src/lib/generation-pipeline.ts`
- `artifacts/craft-vita/src/lib/stream-orchestrator.ts`
- `artifacts/craft-vita/src/lib/grouped-question-engine.ts`
- `artifacts/craft-vita/src/lib/semantic-classifier.ts`
- `artifacts/craft-vita/src/pages/Sessions/components/TranscriptAnswerMarkdown.tsx`
- `artifacts/craft-vita/src/pages/Sessions/components/TranscriptCodeBlock.tsx`

## Current State

The app already has a stronger architecture than a basic React app. Session logic is split across a feature layer, page layer, component layer, store layer, semantic engine, overlay layer, and Tauri-related services.

This is good, but it also means the biggest risk is not missing code. The biggest risk is inconsistent behavior between layers.

## Main Finding

There are multiple session surfaces:

1. Web session page
2. Active session page
3. Feature session runtime
4. Desktop launcher
5. Floating/overlay session UI
6. Legacy session components
7. Store/session slice
8. Semantic/generation pipeline

Before rewriting anything, the project needs a clear source of truth for which layer owns which responsibility.

## Premortem

### 1. Interview answer style can drift

Risk: Answers may become too textbook-like, too polished, or too AI-generated.

Expected behavior: Answers should sound like a practical experienced engineer speaking in an interview.

Acceptance check: A user should be able to speak the answer naturally without sounding scripted.

### 2. Coding/syntax answers can be incomplete

Risk: Technical answers may explain a concept but omit the actual command, code, or syntax required.

Expected behavior: Include code only when useful, but do not omit code when the answer depends on it.

Acceptance check: Kubernetes, SQL, Python, PySpark, DevOps, Git, Docker, and API answers should include commands/snippets where needed.

### 3. Question-only mode can break

Risk: The app may return an answer when the user requested only a question.

Expected behavior: If the user asks for a single question, return only one question.

Acceptance check: No answer, no hints, no extra sections.

### 4. Formatting can become distracting

Risk: Markdown, bolding, syntax highlighting, and UI styling can make answers look like course notes.

Expected behavior: Keep interview answers simple. Use code blocks only when needed.

Acceptance check: The response should look clean and human, not like a tutorial page.

### 5. Session state can become inconsistent

Risk: User preferences may be applied in one area but not another.

Expected behavior: Style preference, answer mode, question mode, language preference, and session context should be consistent across web and desktop.

Acceptance check: A correction made by the user should affect later answers in the same session.

### 6. Desktop behavior may pass build but fail real use

Risk: Tauri build may pass while launcher, auth hydration, floating UI, audio, or capture fails at runtime.

Expected behavior: Desktop verification must include actual launcher and session flow testing.

Acceptance check: Build success alone is not enough.

### 7. Transcript grouping may over-trigger or under-trigger

Risk: The generation pipeline may treat noise as a question, split one scenario into multiple answers, or merge unrelated questions.

Expected behavior: Auto-generation should be conservative and manual generation should be reliable.

Acceptance check: Real interview transcripts should not produce duplicate, broken, or wrongly grouped answers.

## Postmortem

Observed from current code and docs:

1. Docs already mark Session creation, Transcript, AI generation, Tauri app, Floating window, Clerk auth, and Deep links as needing verification.
2. The architecture map confirms desktop session flow is an immediate audit priority.
3. The generation pipeline has useful classification and grouping, but it does not yet encode the user's preferred answer style as a first-class contract.
4. Transcript answer rendering supports Markdown and code blocks, but the current syntax highlighter can make answers look heavy if overused.
5. Code block rendering exists, which is good. The problem is not UI capability; the problem is when and how answer generation includes snippets.
6. The project has both legacy and newer session paths, so migration boundaries must be made explicit.

## Priority Fix Plan

### P0: Define session output contract

Create a small contract for answer generation modes:

- question_only
- answer_humanized
- coding_question_only
- coding_answer_with_snippet
- scenario_question_only
- scenario_answer_humanized

Each mode should define:

- whether answer is allowed
- whether code is allowed
- expected length
- formatting rules
- tone rules

### P1: Add humanized interview answer rules

The answer-generation prompt should enforce:

- practical first step
- no textbook opening
- no unnecessary buzzwords
- no course-style sections
- code/syntax only when useful
- short enough to speak in an interview

### P2: Separate rendering from answer style

Markdown rendering should only render what it receives. It should not be responsible for deciding whether content is too theoretical or too code-heavy.

Generation should decide content style. Rendering should stay simple.

### P3: Verify desktop session flow

Run a real desktop checklist:

- Tauri build
- launcher opens
- auth session hydrates
- floating session opens
- active session connects
- microphone/transcript path works
- AI answer generation works
- credits are deducted correctly
- session can end cleanly

### P4: Reduce frontend bundle risk

Build output shows large chunks. The session and question-bank areas should be reviewed for heavy imports and lazy loading.

### P5: Update bug tracker after verification

Convert broad items into specific bugs once each flow is tested.

## Recommended Ownership Map

- `features/session`: runtime state, session flow, active/floating session logic
- `pages/Sessions`: route-level UI only
- `components/Sessions`: reusable creation/review dialogs only
- `overlay`: desktop/floating rendering shell only
- `lib/generation-pipeline.ts`: generation trigger decision only
- API server: answer generation, persistence, credit deduction
- markdown/code components: display only

## Acceptance Tests

### Sessions

1. A single-question request returns one question only.
2. A coding-question request returns a coding problem only unless an answer is requested.
3. A humanized answer sounds like a real engineer, not a course explanation.
4. Required command/code snippets appear when needed.
5. Unnecessary code blocks are not generated.
6. Transcript noise does not trigger answers.
7. Follow-up questions preserve context.
8. Manual regeneration does not double-charge credits.
9. Answer revisions can preview, apply, and restore safely.

### Desktop

1. Desktop build succeeds.
2. Launcher opens.
3. Floating session opens.
4. Auth is carried into desktop correctly.
5. Session can be started from desktop.
6. Transcript input reaches the session flow.
7. AI answer generation returns in the floating session.
8. Session can be ended without stale state.
9. User sees clear errors for missing auth, missing API, or missing permissions.

## Decision

Do not create a separate replacement module yet.

The current structure is strong enough to review and stabilize first. A new module should only be created if verification proves that the current session runtime and desktop flow are too tightly coupled to fix safely.

## Next Action

1. Inspect current prompts/API answer-generation endpoints.
2. Add a formal output-mode contract.
3. Connect the contract to session generation calls.
4. Test question-only, humanized answer, and coding-answer flows.
5. Then test desktop runtime end to end.
