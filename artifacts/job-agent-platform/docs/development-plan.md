# Development Plan

## Release policy

Software cannot be guaranteed literally bug-free. The release target is zero known critical/high defects, complete automated gates, security review, accessibility review and reversible deployments.

## Phases

1. Foundation: repository, CI, environments, database, auth, audit logging, accessible design system and responsive PWA shell.
2. Candidate profile: resume parsing, verified master profile and role-family suggestions across desktop and mobile.
3. Discovery and trust: supported ATS sources, deduplication, company/vacancy/recruiter checks and moderation.
4. Tailoring: fact-locked resume generation, comparison and exact submitted-resume evidence.
5. Assisted submission: supported form adapters, answer vault, pause/resume, mobile emergency stop and confirmation capture.
6. Tracking: Gmail/Outlook matching, status timeline, in-app/web-push notifications and direct action links.
7. Billing: INR/USD/EUR plans, credit ledger, idempotent webhooks and refunds.
8. PWA hardening: installability, service worker, interrupted-upload handling, slow-network behavior, responsive and device testing.
9. Pilot hardening: load, penetration, accessibility, incident drills and staged rollout.
10. Native companion decision gate: build Expo Android/iOS clients only when measured PWA limitations or mobile adoption justify them.

Every change is delivered through a feature branch and pull request. Main remains deployable.

See `mobile-strategy.md` for the mobile scope, notification rules and native-app decision criteria.