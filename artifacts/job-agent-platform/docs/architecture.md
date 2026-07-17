# Architecture

Power Automate is not a core dependency. The platform uses a code-owned modular monolith first, with independently deployable workers when load requires it.

## Runtime

1. Next.js web and API layer.
2. Supabase PostgreSQL, Auth, private Storage and pgvector.
3. Provider-neutral queue adapter; memory in local development, Cloudflare Queues in the pilot, and a replaceable durable queue later.
4. Playwright application workers in isolated containers for explicitly supported sites only.
5. AI provider adapter for parsing, matching, tailoring and classification.
6. Billing provider adapter; Razorpay first for INR, USD and EUR.
7. Gmail API and Microsoft Graph adapters using least-privilege OAuth.

## Boundaries

- The web service never controls browsers directly.
- Queue messages contain identifiers, not full resumes or email bodies.
- Browser workers receive short-lived, scoped work tokens.
- A submission is billable only after stored confirmation evidence.
- CAPTCHA, OTP, unknown questions and sensitive declarations stop automation.
