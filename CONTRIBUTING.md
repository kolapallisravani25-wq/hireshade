# Contributing to HireShade

## Branch Strategy

- `main` is the production baseline.
- `develop` is the active engineering branch.
- Feature work should happen on focused branches such as:
  - `feature/desktop-platform`
  - `feature/admin-stabilization`
  - `feature/billing-audit`
  - `feature/data-migration`

## Workflow

1. Create or reference a GitHub issue.
2. Work from `develop` or a feature branch.
3. Keep changes focused.
4. Run local checks before committing.
5. Update documentation when architecture, deployment, APIs, or data behavior changes.
6. Open a pull request into `develop`.
7. Merge into `main` only after production validation.

## Required Checks Before Commit

- No secrets committed.
- No `.env` files committed.
- No temporary logs, database dumps, or personal files committed.
- Build or typecheck completed where relevant.
- Documentation updated for meaningful changes.

## Commit Style

Use clear, descriptive commits:

```text
Add admin systemd deployment docs
Fix Clerk desktop session restore
Document ScribeShade migration validation flow
```

## Documentation Rule

Every sprint must update at least one of:

- `docs/HireShade-Engineering-Bible.md`
- `docs/Architecture-Map.md`
- `docs/Module-Audit.md`
- `docs/Bug-Tracker.md`
- `docs/Release-Checklist.md`
- `CHANGELOG.md`
- `docs/adr/*`

## Production Safety Rule

Before any database cleanup, migration, or deployment-risk change:

- Take database backup.
- Confirm rollback path.
- Record the operation in docs.
- Commit relevant scripts before execution.
