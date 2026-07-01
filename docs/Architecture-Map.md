# HireShade Architecture Map

## Purpose
This document maps the HireShade system so each feature can be traced from UI to API to database and back. It will be updated during every audit sprint.

## High-Level System

```text
User
  |
  | Web browser / Tauri desktop
  v
HireShade UI (`artifacts/craft-vita`)
  |
  | Bearer Clerk JWT
  v
HireShade API (`artifacts/api-server`, port 4000)
  |
  v
PostgreSQL (`hireshade` database)
```

Additional services:
- Clerk: authentication and identity
- OpenRouter: AI generation
- Deepgram: speech/transcription support
- Razorpay: payments
- Nginx: reverse proxy and SSL/domain routing
- Kottster Admin: admin panel, currently recovered separately on VPS

## Repository Structure

```text
artifacts/api-server        Backend Express API
artifacts/craft-vita        Main web + Tauri desktop app
artifacts/mockup-sandbox    UI/mockup sandbox
lib/api-client-react        Generated React API client
lib/api-spec                OpenAPI specification
lib/api-zod                 Generated Zod/types layer
lib/db                      Drizzle DB schema/client
scripts                     Utility scripts
```

## Runtime Structure

```text
hireshade.com               Public web app
hireshade.com/admin/        Admin panel
127.0.0.1:4000              API server
127.0.0.1:3000              Admin server
PostgreSQL 5432             HireShade database
```

## Authentication Flow

```text
ClerkProvider in frontend
  -> user signs in
  -> frontend obtains Clerk session token
  -> API calls include Authorization: Bearer <token>
  -> API requireAuth middleware verifies token
  -> API maps Clerk user ID to internal users.id
  -> missing users are auto-created
  -> credits_balance row is created for new users
```

Auth status:
- Backend rejects missing token with 401.
- Authenticated routes are receiving valid requests.
- Web Clerk env is present.
- API Clerk env is present.
- Desktop session hydration exists and needs deeper runtime testing.

## Core API Areas

| Area | API responsibility |
|---|---|
| Auth | `/api/auth/me`, user sync |
| Credits | balance, plans, brackets, purchases, ledger, usage |
| Sessions | create, activate, fetch, list, messages/transcript |
| Assistant | chat sessions and AI response streaming |
| Documents | upload, list, preview/reference |
| Resumes | upload, list, builder, ATS, generated resume flows |
| Projects | AI projects, project versions |
| Question Bank | company/user/general questions |
| Health | API health checks |

## Web Application Areas

| Area | Representative path/code |
|---|---|
| Dashboard | `src/pages/Dashboard` |
| Auth | `src/pages/Auth`, `src/components/auth`, Clerk provider in `src/main.tsx` |
| Billing | `src/pages/Billing`, `src/components/Billing` |
| Resume | `src/pages/Resume`, `src/components/Resume` |
| Sessions | `src/pages/Sessions`, `src/features/session` |
| Assistant | `src/pages/Assistant` |
| AI Projects | `src/pages/AIProjects`, `src/components/AI projects` |
| Documents | `src/pages/Document`, `src/components/Document` |
| Question Bank | `src/pages/QuestionBank` |
| Support/Help | `src/pages/Support`, `src/pages/Help` |

## Desktop Application Areas

Tauri config:
- Product name: HireShade
- Identifier: `org.hireshade.app`
- Deep-link scheme: `hireshade://`

Windows:
- `mini`: floating interview screen
- `launcher`: desktop launcher

Desktop-specific areas:
- `src/pages/Launcher`
- `src/overlay`
- `src/features/session`
- `src/capture`
- `src/services/tauriOverlay.ts`
- `src/services/MiniRemoteAudio.ts`
- `src/lib/desktopAuthSession.ts`
- `src/components/auth/DesktopAuthHydrator.tsx`

## Admin Architecture

Current state:
- Admin project recovered at `/root/scribeshade-admin`
- Runs on port 3000
- Nginx routes `/admin/` to admin server
- Login works

Target state:
- Move admin to `/opt/hireshade/admin`
- Run as `hireshade` user
- Create `hireshade-admin.service`
- Commit admin source into GitHub if not already included
- Rebrand ScribeShade references to HireShade

## Database Areas

Current known HireShade tables include:
- users
- credits_balance
- credits_purchases
- credits_usage
- sessions
- session_messages
- resumes
- documents
- projects
- project_versions
- assistant_chats
- assistant_messages
- questions
- saved_questions
- roles
- user_roles

Old ScribeShade data exists separately in Docker PostgreSQL on old VPS and will be migrated only after production readiness.

## Critical Dependency Map

```text
Authentication -> all protected APIs
Credits -> AI assistant, sessions, resume AI, billing
OpenRouter -> assistant, answer generation, resume AI, AI projects
Deepgram -> desktop transcription/session audio
Razorpay -> purchases/credits
PostgreSQL -> all persistent product state
Admin -> user/credit/content management
```

## Immediate Audit Sequence

1. Authentication and identity
2. Admin stabilization
3. Desktop build and session flow
4. AI/OpenRouter and credit deductions
5. Billing/Razorpay
6. Resume studio
7. AI projects
8. Question bank
9. Data migration
