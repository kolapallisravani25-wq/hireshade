# HireShade Release Checklist

## Before Any Release
- [ ] Git status clean
- [ ] Changes committed to `develop`
- [ ] Pull request reviewed before merge to `main`
- [ ] API build passes
- [ ] Web/Desktop build passes
- [ ] Typecheck passes
- [ ] No secrets committed
- [ ] `.env` values verified on VPS
- [ ] Database backup completed if schema/data changes exist

## Infrastructure
- [ ] API service healthy
- [ ] Admin service healthy
- [ ] Nginx config valid
- [ ] SSL/domain working
- [ ] PostgreSQL running
- [ ] Disk/memory healthy

## Functional Smoke Test
- [ ] Landing page loads
- [ ] Login works
- [ ] Dashboard loads
- [ ] Resume upload/build works
- [ ] ATS analysis works
- [ ] AI assistant works
- [ ] Session creation works
- [ ] Desktop launcher works
- [ ] Floating interview window works
- [ ] Transcript works
- [ ] AI answer generation works
- [ ] Credits deduct correctly
- [ ] Razorpay payment works
- [ ] Admin login works
- [ ] Admin data screens load

## After Release
- [ ] Tag release
- [ ] Monitor logs
- [ ] Verify user flow manually
- [ ] Update bug tracker
- [ ] Update engineering bible
