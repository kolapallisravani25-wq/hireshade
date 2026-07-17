# Threat Model Summary

Protected assets include resumes, contact information, application answers, email metadata, OAuth tokens, billing state and submission evidence.

Primary threats: fake vacancies, lookalike domains, malicious links, prompt injection inside job descriptions or emails, cross-user access, forged webhooks, duplicate submissions, worker credential theft and accidental fabrication in tailored resumes.

Controls: RLS, private storage, short-lived signed URLs, HMAC/webhook verification, idempotency keys, allowlisted automation adapters, external content isolation, fact-locked resume claims, trust hard blocks, audit logs and a global emergency stop.
