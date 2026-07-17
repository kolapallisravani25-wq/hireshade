# HireShade Job Agent Platform

Code-first foundation for verified job discovery, truthful resume tailoring, controlled applications and email-linked tracking.

Power Automate is optional and not part of the core runtime.

The complete candidate experience is delivered as a responsive, installable Progressive Web App for desktop, tablet and mobile. A focused Expo/React Native companion may be introduced later when native distribution or notification requirements justify it.

## Run

```bash
pnpm install
pnpm dev
```

Copy `.env.example` to `.env.local`. Never commit live secrets.

## Verify

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

See `docs/development-plan.md`, `docs/architecture.md`, `docs/mobile-strategy.md` and `docs/quality-gates.md`.