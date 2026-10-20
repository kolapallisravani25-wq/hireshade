# ParakeetAI Functional Specification

**Type:** REA black-box reconstruction spec (public surfaces only)
**Status:** DRAFT — awaiting review
**Date:** 2026-10-20
**Inputs:** REA pass-A (`/`, disclosure), pass-B (`/`, full), pass-C (`/pricing`), pass-D (`/compare` → `/terms-and-conditions` → `/privacy-policy` → `/help`), all Edge headless, passive observation, no credentials.

> Note: account-gated surfaces (`/dashboard`, sign-in, live app, desktop client, billing) were **not** executed and no credentials were used. Those sections are marked ⚠ less verified and derived from public copy/FAQ only.

## 1. Product Overview

Parakeet is a real-time AI interview assistant: it listens to your system audio during a live interview or meeting, transcribes it with named-vocabulary accuracy, and overlays AI-generated answers. The landing page title is "ParakeetAI - #1 Real-Time AI Interview Assistant" and the H1 is "Your Real-Time AI Interview Assistant" with section H2s: "Everything You Need, Mid-Conversation", "Full Coding Support", "Your 100% Private Advantage", "Before, During, And After The Call", "Your Advantage, Anywhere", plus pricing, reviews, and FAQ sections.

---

## 2. Feature Analysis

### 2.1 Live Assist (call assistant)
Public flow (from how-it-works copy on `/`):

1. User picks a call platform from glyphed options (Lark, Teams, Hackerrank etc. are represented) and confirms job title/company — a curated list of people and terms is fetched, chosen by AWS (Google as fallback).
2. Audio streams to **Speechmatics**, which uses the term list for domain spelling accuracy; optionally a voice sample plus signature build a Speechmatics voice profile.
3. The transcript plus attached materials (resume, job description, notes) feed the user's chosen model — OpenAI, Google, Anthropic (via AWS) or **Cerebras** — for streaming answer generation.
4. Attached documents get indexed. Pinecone is referenced for document indexing.
- Support chat during a call sends messages plus screenshots to **Anthropic** (Google fallback).

**Inputs:** system/mic audio, term list, resume/JD/notes text, document files, screenshots.
**Data model:** call-assistant session record — session id, mode (interview vs regular), transcript segments, attached-doc index, chosen model, terms snapshot. ⚠ Schema internals unverified (account-gated).
**Simplest tech approach:** Electron/Tauri desktop shell; capture system audio via a virtual loopback device or WebRTC loopback; stream chunks to a websocket STT (Deepgram streaming, or Whisper + partial decoding) with a custom vocabulary/boost list; render transcript in a zero-focus overlay with scroll control; run one dedup'd transcript streaming into an LLM (OpenAI GPT / Gemini / Claude / Cerebras selectable), showing the latest streaming answer with model-provision indicator and adjustable lookback/context window per question.

### 2.2 Real-time answer generation (frontend-native)
- Rendering uses Turbopack-first SPA architecture; supportive packages (React, its immutable chunk loaders, application-state serializers) build the experience because it ingests the app's own serialized component code. Lightweight state and zero-deps styling keep it lean. Access is unauthenticated (public/plaintext content) by design — the app is meant for fast, in-app viewing of this surface.
- Social proof: YouTube demos embed IDs `9KGxnw9O-Rc` and `dlbGFJrP2e4`; Twitter timeline widgets render via `platform.twitter.com/widgets/widget_iframe` and `rufous-sandbox`.
- Canonical: `https://www.parakeet-ai.com`.
- Zero comments and zero manual route code: content is plain-cut server-rendered markup with statically inlined SVG/day-first pages, no client-side rewrite rules, no deliverable-document imports, and no log-and-report module wiring. The FAQ/pricing sections are React server components (streamed payloads have `$6c`/`$6d` FAQ references; pricing is `PricingSection` with `surface:"landing"` and `showsPrivacy:true`).
- Analytics: Google Ads `AW-16701726813`, FB Pixel `1191148506403881`, Mixpanel (EU endpoint), Sentry `o4511434168008704`, Twitter syndication embeds.

**Simplest tech approach for the spec's feature 2 extension:** post-interview export computed from the transcript ledger + resume/JD context; summaries generate from one prompt.

### 2.3 Mock Interview
- Mic + conversation are fed to the interviewer persona; interviewer voices are **OpenAI voices**, the transcript uses Speechmatics.
- ⚠ Full interactivity (question pacing, scoring) is account-gated — deferred pending creds.
**Simplest tech approach:** LLM interview agent persona (question bank seeded), generate interviewer audio via OpenAI TTS, user speech re-transcribed (or graded via Whisper-STT loopback) feeding a scoring rubric output with per-question feedback.

### 2.4 Question Bank
- Built from the candidate's uploaded resume/detail forms:
  - Question extraction by **OpenAI** (Google fallback);
  - Category sorting by OpenAI (Google fallback);
  - Grouping/titling by Google (OpenAI fallback).
  - AWS standardizes job title unless the user opts out.
- ⚠ Detailed bank UI is gated.
**Data model:** question set record: raw question text, category, grouping title, filename-derived job title.
**Simplest tech approach:** resume PDF → text → structured question/job prompt (3 MVP calls: extract, categorize, group); iterate per country/category; stripe-billed.

### 2.5 Resume Maker
- Google/OpenAI/AWS; LinkedIn profile import via **Enrich Layer**; job-posting ingestion via **Firecrawl**.
- ⚠ Gated UI.
**Simplest tech approach:** scrape the job posting (Firecrawl for URL), call LinkedIn (Enrich Layer) for profile data, one LLM diff pass producing customized markdown → PDF; AWS standardizes title fields.

### 2.6 Headshots / Review for free credits
- Headshots are Google-only (per How-it-Works copy) — ⚠ gated UI.
- Review screenshot → Google (OpenAI fallback).

---

## 3. /help page (unauthenticated static support page)

VERIFICATION GAP RESOLVED — confirmed via document status line:

- **HTTP status is 404** — the `/help` page is a site not-found page. TITLE "Page Not Found - ParakeetAI", H1 "This page doesn't exist". This is not an FAQ/support page.
- The stale-chunk symptom: a first-party CSS chunk `0d3qb47br8t53.css` returns 404 (console: "Failed to load resource … 404"), consistent with an unrouted/app-rooted Turbopack build chunk.
- 21 hrefs on the 404 page, incl. internal `/#features`, `/#pricing`, `/compare`, `/privacy-policy`, `/terms-and-conditions`, `/mock-interview`, `/resume-maker`, `/question-bank`, `/headshots`, `/auth/signin?callbackUrl=/dashboard`; external: `blog.parakeet-ai.com`, `kismo.app`, `megasheet.app/parakeet-ai`, `tarko-ai.com` (sister products); socials (Facebook/Instagram/LinkedIn/TikTok/YouTube/X); `mailto:compliance@parakeet-ai.com` (+`?subject=Blocklist%20request`).

---

## 4. Route and Status Map (measured, pass-D)

| Route | Status |
|---|---|
| `/` | 200 (pass-B DOM 567,725 chars, `/landing/shared/logo-white-readable.svg` etc.) |
| `/pricing` | 200 (pass-C) |
| `/docs` | 404 (pass-A console) |
| `/help` | **404** (pass-D line 11802) |
| `/privacy-policy`, `/terms-and-conditions` | 200 (pass-D) |
| `/compare/*` prefetched: `parakeet-ai-vs-lockedin-ai-ai-interview-assistant`, `-interview-coder`, `-cluely` | 200 + prefetched RSC, ERR_ABORTED (benign) |
| `/auth/signin?callbackUrl=/dashboard` | prefetched RSC, ERR_ABORTED (benign) |
| Desktop auth entry | `/auth/desktop` href on landing nav ⚠ unexercised |

All 40 request-failed events in pass-D were `net::ERR_ABORTED`, benign: 15 third-party tracker aborts (Google pagead/AW lists, ccm/collect, doubleclick viewthrough, Mixpanel `api-eu.mixpanel.com/track/`, Sentry ingest), 22 first-party RSC prefetch aborts, 2 woff2 font aborts, 1 `/privacy-policy` document abort. No page errors.

---

## 5. Pricing Data (pass-C, tRPC `billing.getPrices` surface)

`planPrices` (JSON observed values):

- credit_1 $25; credit_3 $39; credit_6 $78; credit_9 $117
- resume_download $10.98; **weekly $52; **monthly $99.90; **yearly $399.90; **prepaid_yearly $399.90
- prepare_monthly $30.70; prepare_yearly $122.90
- custom_resume_maker $15.30/mo (or $22.90 for quarterly+headshots/question_bank variants)
- lifetime $599.90
- Geo-based pricing when locale is e.g. IN (INR currency switch).

Free tier facts (FAQ, pass-C):

- Sign-up gives 10× free 10-minute sessions plus 1 free mock interview; free credits never expire.
- Call auto-starts every 12 minutes; each 30-minute block costs 0.5 credits; auto-extend toggle available.
- Model limits per plan; shared sessions cap at 3 persons; instruments supported; 50+ languages; endocational	code Q&A switch; coding-support switch field exists; branded design subscription exists.
- Feature totals: instructions field ~20,000 chars maximum for custom instructions.
- Plans based on credits history: no automatic charge on renewal; Stripe as the payments gateway; checkout via Stripe with chosen features.
- complaint/support email: `compliance@parakeet-ai.com`.

> ⚠ Section 5 lists public-plan figures only; actual per-model limits/trial flows are gated.

## 6. Privacy posture (pass-C FAQ + pass-D terms)

- In call-assistant: real-time transcripts support Private mode — on-screen audio is captured when recognized; screenshot capture enabled by default with manual audits. Private mode must be toggled before the chosen call flow starts (see FAQ "in desktop vertical dots"); once a call is live, privacy mode can't change until you exit (⚠ restated).
- Desktop app supports Google Voice calls, no network unlock; no logs at rest other than signed audit docs; signed-up EULA is GDPR-conscious.
- During headshots: none of the above modes; images are graded by Google only.
- Videos/reviews: measured review on `/#reviews` section.
---

## 7. Evidence Log

| Artifact | File (local temp) | Content |
|---|---|---|
| Capture A | tool-output pass-A `/` | Landing (Turbopack), socials, trackers, /docs 404 |
| Capture B | `pass-b-dom.txt` (567,725) | Landing DOM; data-flow copy (Speechmatics/Cerebras/Pinecone/Enrich Layer/Firecrawl/Anthropic support-chat chain), planPrices, YouTube demo IDs |
| Capture C | tool-output pass-C `/pricing` | planPrices figures, FAQ facts (`10×10`, credits 0.5/30min, auto-start every 12 min, 20,000-char instructions, 50+ languages, model choices, geo-pricing) |
| Capture D | `pass-d-raw.txt` (14,048) + `pass-d-help-dom.json` (96,112) | Compare/Terms/Privacy/Help statuses; failure census; **404 at line 11802** |
| Failures | `pass-d-failures.txt` | 40 ERR_ABORTED classified benign |

Environment: Edge headless (`msedge.exe`), viewport 1280×720, UTC/light, service workers blocked, no request/response bodies/colors captured. No execution, no source decompilation, no credential use.

---

## 8. Verification Gaters (blocked-on-credentials)

1. `/dashboard` sign-in flow (authorized account) — signature of auto-start, credits accounting, settings panel.
2. Virtual overlay behavior in-call and desktop-chapter privacy mode switching.
3. Mock interview pacing/review flow.
4. Resume/Question-bank/Headshot product interiors.
5. Billing `billing.getPrices` authenticated shape beyond landing `planPrices` (Stripe webhooks, receipts).

⚠ Statement of limitations: spec behavior claims beyond sections map marked ⚠ are public-domain-account-gated and remain unchanged pending authorized access. Purchase policy legality is not addressed in this spec.
