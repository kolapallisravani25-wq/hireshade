# Accounts and Secrets Checklist

## Needed for local foundation

- Supabase development project: URL, anon key, service-role key and database URL.
- OpenAI development project key with a low hard budget.
- Razorpay test key ID, test secret and webhook secret.

## Needed for integration testing

- Google Cloud OAuth client and Gmail API test users.
- Microsoft Entra OAuth client for Outlook test accounts.
- Cloudflare account, Worker and Queue bindings.
- A container host only when remote Playwright workers are tested.

## Production only

- Live Razorpay keys and approved international payments.
- Verified Gmail OAuth consent and required security assessment.
- Production email domain, SMTP provider, legal pages and data deletion process.
- Domain-risk and commercial threat-intelligence API keys.

Never commit secrets. Use GitHub Environment Secrets and provider secret stores.
