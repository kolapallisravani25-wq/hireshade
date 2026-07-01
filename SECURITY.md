# HireShade Security Policy

## Security Principles

HireShade handles sensitive user data such as resumes, interview sessions, documents, credits, billing metadata, and AI-generated content. Security must be treated as a product requirement, not an afterthought.

## Sensitive Data

The following must never be committed to Git:

- `.env` files
- API keys
- Clerk secret keys
- OpenRouter keys
- Deepgram keys
- Razorpay keys/secrets
- Database URLs/passwords
- SSH keys
- Database dumps
- Uploaded resumes/documents
- Production logs containing user data

## Required Practices

- Use environment variables for secrets.
- Keep production `.env` files only on the server.
- Back up databases before migration or cleanup.
- Restrict VPS access.
- Run services under non-root users where possible.
- Use HTTPS for public routes.
- Keep admin access restricted.

## Incident Response

If a secret is exposed:

1. Revoke/rotate the secret immediately.
2. Remove the secret from the repository history if needed.
3. Check logs for suspicious usage.
4. Update affected services.
5. Record the incident and remediation in internal notes.

## Production Change Safety

Before production changes:

- Confirm the branch and commit.
- Confirm backups.
- Confirm rollback path.
- Confirm service health after deployment.
