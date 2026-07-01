# ADR-001: HireShade Engineering Workflow

## Status
Accepted

## Date
2026-07-01

## Context
HireShade was recovered from a VPS-hosted state with multiple moving parts: web app, desktop app, API, admin, database, and old ScribeShade production data. Changes were previously difficult to track because some runtime components lived outside version control.

## Decision
HireShade will use a structured engineering workflow:

- `main` is the production baseline.
- `develop` is the active engineering branch.
- All meaningful changes must be committed.
- Production changes must be documented.
- Database/data changes require backups first.
- Each sprint must update relevant documentation.

## Consequences
- Future changes are traceable and reversible.
- Engineering history becomes visible.
- Migration risk is reduced.
- The repository becomes the source of truth for code, docs, and operational procedures.
