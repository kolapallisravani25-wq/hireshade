# Quality Gates

A pull request cannot merge unless lint, strict types, unit tests, build, migration checks and secret scanning pass.

Before staging: API contract tests, RLS cross-user tests, billing webhook idempotency, queue retry tests and basic accessibility automation.

Before production: Chromium/Firefox/WebKit critical-flow tests, keyboard and screen-reader review, OWASP testing, backup/restore rehearsal, emergency-stop test, post-stop submission test, duplicate-application test, fake-job false-safe review and rollback rehearsal.

Release blockers: any unsupported resume claim, confirmed fake vacancy marked safe, cross-user data access, payment/credit duplication, post-stop submission, inaccessible critical flow or untracked submitted resume.
