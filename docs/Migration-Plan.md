# ScribeShade to HireShade Migration Plan

## Decision
Do not blindly restore old ScribeShade DB over HireShade. Final agreed plan:
1. Make HireShade fully functional and production-ready.
2. Back up old and new systems.
3. Clean the new HireShade database.
4. Migrate old ScribeShade data into HireShade.
5. Validate all migrated records.

## Known Old ScribeShade Data
Old DB is in Docker on `srv1092432`:
- Container: `scribeshade-db`
- Database: `scribeshade`
- User: `scribe-user`

Confirmed old production counts:
- Users: 110
- Resumes: 60
- Sessions: 241
- Built resumes: 61
- Projects: 47
- Documents: 9

## Known New HireShade Data
New DB is on `srv1776003`:
- Database: `hireshade`
- User: `hireshade`
- Host: `127.0.0.1:5432`

New DB already contains data, so it must be backed up before cleanup.

## Mandatory Pre-Migration Backups
- Old ScribeShade PostgreSQL dump
- New HireShade PostgreSQL dump
- Old uploads/documents
- New uploads/documents
- VPS snapshot if available
- Git tag before migration

## Migration Mapping Draft
| Old Table | New Table | Notes |
|---|---|---|
| `User` | `users` | Match by email/Clerk identity strategy |
| `Resume` | `resumes` | Preserve ownership |
| `BuiltResume` | `resumes` or derived table | Needs schema inspection |
| `Session` | `sessions` | Preserve session metadata |
| `SessionMessage` or equivalent | `session_messages` | Needs old schema check |
| `Project` | `projects` | Preserve versions where possible |
| `ProjectVersion` | `project_versions` | Map old IDs to new project IDs |
| `Document` | `documents` | Verify file paths/storage |
| Credit tables | credits tables | Recalculate and validate balance |

## Migration Tool Requirements
- Dry-run mode
- Idempotent inserts
- Mapping table for old IDs to new IDs
- Validation report
- Error log
- Re-runnable per module

## Validation
- Count comparison
- Random user verification
- Resume ownership checks
- Session transcript checks
- Credit balance checks
- Admin dashboard verification
- Web login verification
