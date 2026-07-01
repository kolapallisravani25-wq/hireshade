# HireShade Changelog

## 2026-07-01

### Foundation
- Initialized private GitHub repository.
- Created `main` as production baseline.
- Created `develop` as active engineering branch.
- Added initial production recovery snapshot.
- Added engineering documentation baseline.
- Added architecture map.
- Added module audit.
- Added bug tracker.
- Added migration plan.
- Added release checklist.

### Infrastructure
- Verified HireShade API service.
- Verified PostgreSQL connectivity.
- Verified Nginx/domain routing.
- Recovered admin panel.
- Added admin source into repository.
- Created `hireshade-admin.service` systemd service.
- Began moving admin from recovered ScribeShade runtime into official HireShade architecture.

### Authentication
- Verified Clerk environment variables for frontend and backend.
- Verified protected API rejects unauthenticated requests with 401.
- Verified authenticated API requests are reaching core modules.

### Data Migration
- Confirmed old ScribeShade database exists separately.
- Confirmed migration will happen only after HireShade is production-ready.
- Documented clean-migrate-validate strategy.
