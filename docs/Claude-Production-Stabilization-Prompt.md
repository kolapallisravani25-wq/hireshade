# HireShade Production Stabilization Mission

Use this prompt with Claude/Codex for stabilizing the existing HireShade build.

## Role

You are the Lead Software Architect, Principal Engineer, Senior Full-Stack Engineer, QA Lead, Security Engineer, Performance Engineer, Desktop Engineer, and Release Engineer for HireShade.

## Critical Boundary

Do **not** rewrite or redesign the Sessions module from scratch.

Do **not** build Session Engine V2.

Session Engine V2 is being handled separately.

Your task is to stabilize the **existing implementation** so the current application can be launched safely.

## Objective

The application is close to launch and customers are already waiting.

Your objective is to make the existing application production-ready by identifying and fixing all critical and high-priority issues.

Focus on:

- stability
- correctness
- launch readiness
- low-risk fixes
- preserving working functionality
- avoiding unnecessary architectural churn

## Documentation Priority

Use the uploaded product documentation as the expected behavior.

If implementation differs from documentation, fix the implementation.

Do not invent undocumented behavior unless required to prevent a launch blocker.

## Audit Scope

Recursively inspect all code connected to Sessions and launch stability:

- backend
- frontend
- desktop app
- database
- authentication
- authorization
- credits
- billing
- resume integration
- project integration
- transcript flow
- answer generation
- automatic answer generation
- Ask AI
- analytics
- insights
- review page
- desktop overlay
- question bank integrations

## Backend Audit

Inspect every related endpoint and verify:

- authentication
- authorization
- session ownership
- request validation
- status codes
- error shape compatibility with frontend
- transactions
- rollback safety
- database consistency
- streaming/SSE behavior
- retry behavior
- OpenRouter failures
- Deepgram failures
- Clerk behavior
- credit handling
- resume context
- project context
- custom prompt context
- timeout handling
- logging and observability

## Frontend Audit

Inspect:

- pages
- components
- hooks
- stores
- contexts
- modals
- dialogs
- API calls
- loading states
- error states
- desktop paths
- routing
- build output

Find and fix:

- runtime crashes
- dead code affecting launch
- broken state assumptions
- race conditions
- memory leaks
- duplicate requests
- incorrect API contracts
- missing null checks
- broken map/filter calls
- UI inconsistencies
- bad loading/error UX

## Desktop Audit

Verify:

- Tauri integration
- floating window
- overlay
- always-on-top behavior
- native audio
- microphone
- Deepgram
- IPC
- desktop authentication
- session synchronization
- recovery after restart
- packaging/build issues

## Transcript Audit

Verify:

- capture
- ordering
- timestamps
- saving
- DB persistence
- review rendering
- Ask AI consumption
- analytics consumption
- desktop synchronization
- recovery after page refresh

## AI Audit

Verify:

- prompt construction
- resume grounding
- project grounding
- JD grounding
- custom prompt usage
- conversation history
- question detection
- answer generation
- automatic generation
- manual generation
- regeneration
- token usage
- streaming
- provider failures
- fallback behavior
- duplicate requests
- context explosion

## Database Audit

Verify:

- schema
- indexes
- constraints
- relationships
- migrations
- duplicate records
- orphan rows
- missing columns
- naming consistency
- production safety

## Security Audit

Verify:

- authentication
- authorization
- Clerk/JWT handling
- user ownership checks
- SQL injection risk
- XSS risk
- prompt injection risk
- CSRF risk
- file upload safety
- API key exposure
- desktop secrets
- environment variables
- session isolation

## Performance Audit

Inspect:

- frontend bundle size
- route-level code splitting
- duplicate API calls
- AI request frequency
- React render frequency
- SQL query volume
- Deepgram latency
- OpenRouter latency
- desktop memory/CPU
- unnecessary polling
- caching behavior

## QA Audit

Verify every documented feature actually works, not merely that code exists.

Test:

- session wizard
- session creation
- active-session conflict handling
- session activation
- free-session timer
- paid-session behavior
- transcript save
- transcript review
- question detection
- automatic answer generation
- manual answer generation
- answer regeneration
- Ask AI
- analytics
- insights
- desktop overlay
- floating session
- resume selection
- project selection
- custom prompt
- credits
- question bank

## Fix Policy

Do not stop after identifying problems.

Immediately fix critical and high-priority issues.

If one fix causes a regression, fix the regression before continuing.

Prefer minimal, production-safe patches.

Preserve existing APIs where possible.

Avoid breaking frontend/backend compatibility.

Avoid creating parallel replacement systems.

## Patch Policy

Patch the existing implementation.

Do not rewrite whole modules unless the current module is fundamentally unusable and a smaller patch cannot safely launch the product.

When patching:

- keep changes small and reviewable
- preserve existing route names when possible
- preserve existing UI navigation when possible
- add compatibility response shapes when frontend expectations are unclear
- add defensive null checks around unsafe runtime assumptions
- do not expose broken or incomplete pages to users

## Validation After Each Batch

Run:

- typecheck
- backend build
- frontend build
- desktop build when desktop files changed
- targeted runtime smoke tests
- endpoint checks
- browser checks for edited flows

Do not continue if a regression exists.

## Deliverables

Produce the following after each work batch:

### Bug Report

- issue
- severity
- root cause
- fix applied
- regression risk

### Patch Summary

- files changed
- reason for each change
- expected impact
- possible side effects

### Risk Report

- security risks
- performance risks
- launch risks
- maintainability risks

### Launch Checklist

- resolved blockers
- remaining blockers
- recommended deployment order
- manual tests required

## Completion Criteria

Do not consider the stabilization complete until:

- all critical launch blockers are fixed
- all high-priority launch risks are fixed or explicitly deferred
- backend typecheck passes
- backend build passes
- frontend build passes
- desktop build passes if desktop is part of release
- existing documented functionality works correctly enough for launch
- no known regressions remain
- the current application is stable enough for production customer use

## Final Instruction

Do not build V2.

Do not redesign the product.

Stabilize the current application for launch.

Continue implementing fixes in logical batches until no critical or high-priority launch blockers remain, or until a change requires a human product decision.
