# Mobile Delivery Strategy

## Decision

Mobile is a first-class product surface. The initial release will provide the complete candidate experience as a responsive Progressive Web App (PWA), installable from supported mobile browsers. A native Android/iOS companion will be added only when store distribution, stronger native notification reliability, background capabilities or mobile usage justify its operating cost.

## Phase 1: Complete responsive PWA

The PWA must support:

- Registration, sign-in and account recovery.
- Candidate profile and preference management.
- Resume upload, preview, verification and download.
- Job discovery, search, filters and trust evidence.
- Application queue and submitted-application timeline.
- Assessment, interview, rejection and offer notifications.
- Open email, assessment, meeting and company-source links.
- Session start, extension, pause and emergency stop.
- Credits, subscriptions and invoices.
- Privacy, consent, account export and deletion.

Long-form resume editing, bulk comparison and dense administration screens may use simplified mobile layouts, but must remain available and accessible.

## Mobile notification priority

Notifications are grouped by urgency:

1. Critical: suspicious response, security event or automation stopped unexpectedly.
2. Action required: CAPTCHA/OTP handoff, unknown application question, expiring assessment or recruiter request.
3. Progress: application acknowledged, assessment received, interview scheduled, offer or rejection.
4. Summary: daily activity and applications awaiting review.

Every notification deep-links to the relevant application event. Email and in-app notification remain fallbacks when push permission is not granted or delivery is unavailable.

## Phase 2: Native companion, when justified

Use Expo + React Native for a focused native client sharing API contracts, schemas, domain types and business rules with the web platform. The native client should initially include:

- Push notifications and notification preferences.
- Application timeline and action centre.
- Search and saved jobs.
- Resume preview/download.
- Session controls and emergency stop.
- Assessment/interview links and calendar actions.
- Subscription and credit visibility.

Complex resume authoring, moderation and operational administration can continue to open the responsive web application until native demand is proven.

## Architecture rules

- The web and native clients consume the same versioned APIs.
- No business rule exists only inside a client.
- Device push tokens are encrypted at rest and revocable per device.
- Notification payloads contain identifiers and minimal display text, never full resume or email content.
- Deep links are allowlisted and validated before navigation.
- Authentication sessions use secure platform storage and short-lived access tokens.
- Mobile analytics must not receive resumes, email bodies, access tokens or sensitive application answers.

## Quality gates

- Test at 320, 375, 390, 412 and 768 CSS-pixel widths.
- No horizontal scrolling in core journeys.
- Touch targets meet accessibility requirements.
- Full keyboard and screen-reader support remains available on mobile web.
- Test slow networks, offline transitions and interrupted uploads.
- Push-notification opt-in is contextual, never requested on first page load.
- Critical actions require clear confirmation and provide reversible outcomes where possible.
- Emergency stop must work from mobile even when a desktop application worker is active.

## Cost control

The responsive PWA uses the existing Next.js codebase and is the default mobile delivery method. Expo and app-store work begins only after mobile analytics show meaningful recurring usage or PWA limitations block important candidate outcomes.