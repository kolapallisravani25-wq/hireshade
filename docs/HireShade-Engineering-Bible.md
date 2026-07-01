# HireShade Engineering Bible

## Mission
Make HireShade a production-ready AI career platform with a web app, desktop interview assistant, backend API, admin panel, and safe ScribeShade data migration.

## Current Architecture
- Web/Desktop app: `artifacts/craft-vita`
- API server: `artifacts/api-server`
- Shared API client: `lib/api-client-react`
- API spec: `lib/api-spec`
- DB layer: `lib/db`
- Admin panel: currently recovered separately on VPS at `/root/scribeshade-admin`; to be moved into `/opt/hireshade/admin`

## Product Areas
1. Authentication and user sync
2. Dashboard
3. Resume studio
4. ATS analysis
5. AI projects
6. Question bank
7. Interview sessions
8. Desktop floating interview assistant
9. Credits and billing
10. Admin management
11. Analytics
12. Data migration

## Engineering Principles
- No production changes without Git tracking.
- Backup before database or deployment changes.
- Main branch is production baseline.
- Develop branch is active work.
- All migrations must be reversible or backed up.
- No secrets in Git.

## Immediate Priorities
1. Complete production audit.
2. Fix critical bugs.
3. Rebrand remaining ScribeShade/CraftVita references.
4. Stabilize admin as a systemd service.
5. Prepare migration scripts and validation reports.
