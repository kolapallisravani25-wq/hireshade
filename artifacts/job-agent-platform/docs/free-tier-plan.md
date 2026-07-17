# Free-first Infrastructure Plan

- GitHub private repository and Actions within included usage.
- Supabase Free for local/shared development; upgrade production when backups and non-pausing are required.
- Cloudflare Workers and Queues Free for low-volume pilot orchestration.
- OpenAI API with strict project budget; AI usage is not free and must be metered.
- Razorpay test mode during development; transaction fees begin only on live payments.
- Local Playwright workers for development; pay-as-you-go containers only when unattended pilot runs begin.
- PostgreSQL full-text search and pgvector before buying a separate search service.
- Sentry/PostHog free tiers only after privacy review; structured database audit logs are mandatory regardless.
