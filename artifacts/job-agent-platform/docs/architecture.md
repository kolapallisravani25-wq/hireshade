# Architecture

Power Automate is not a core dependency. The platform uses a code-owned modular monolith first, with independently deployable workers when load requires it.

## Client surfaces

1. Responsive Next.js web application and installable Progressive Web App for the complete candidate journey on desktop, tablet and mobile.
2. Expo + React Native companion application only after native distribution, notification reliability or mobile usage justifies it.
3. Web and native clients consume the same versioned APIs, schemas and business rules.

## Runtime

1. Next.js web and API layer.
2. Supabase PostgreSQL, Auth, private Storage and pgvector.
3. Provider-neutral queue adapter; memory in local development, Cloudflare Queues in the pilot, and a replaceable durable queue later.
4. Playwright application workers in isolated containers for explicitly supported sites only.
5. AI provider adapter for parsing, matching, tailoring and classification.
6. Billing provider adapter; Razorpay first for INR, USD and EUR.
7. Gmail API and Microsoft Graph adapters using least-privilege OAuth.
8. Web Push for the PWA; Expo Notifications or direct FCM/APNs support when a native companion is introduced.

## Boundaries

- The web service never controls browsers directly.
- Queue messages contain identifiers, not full resumes or email bodies.
- Browser workers receive short-lived, scoped work tokens.
- A submission is billable only after stored confirmation evidence.
- CAPTCHA, OTP, unknown questions and sensitive declarations stop automation.
- Notification payloads contain minimal event metadata and deep-link identifiers, not sensitive document or mailbox content.
- Emergency stop is available from every supported client and is enforced server-side.