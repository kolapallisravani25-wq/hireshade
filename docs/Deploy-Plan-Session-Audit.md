# Deploy & Verification Plan — Recursive Audit Session

All 14 commits from this session are on `develop`, tip `e23ffe5`, on top of the
previously-deployed `a7a52cd`. **No commit changed the DB schema**, so there is
no `drizzle-kit push` step for any of this work. Everything ships as one unit.

Three deploy surfaces are involved:

- **VPS (web + api)** — for the backend and web-frontend changes. One deploy
  covers all of them.
- **GitHub CI (`desktop-build.yml`)** — to `cargo check` + build the Rust
  change. This runs automatically on push to `develop` for `craft-vita/**`
  changes; you don't trigger it manually.
- **Desktop release pipeline** — separate, still blocked on your signing keypair
  (see `Desktop-Release-Runbook.md`). The Rust fix + auth-handoff fix only reach
  desktop *users* through a signed release; the web-served fixes reach everyone
  via the VPS deploy.

---

## Step 0 — Pre-flight (verify env before touching anything)

Two backend commits hard-depend on server env vars. Check them first; a missing
value turns a fix into an outage.

```bash
cd /opt/hireshade/app   # adjust if your repo path differs

# b575919: web transcription now REQUIRES the server Deepgram key (no bundle
# fallback anymore). If unset, live STT on web returns 503 and won't work.
grep -q '^DEEPGRAM_API_KEY=' .env && echo "DEEPGRAM_API_KEY: set" || echo "DEEPGRAM_API_KEY: MISSING — set before deploy"

# 67b536f: Clerk auth now fails CLOSED on a bad/missing domain. It resolves from
# VITE_CLERK_PUBLISHABLE_KEY, or the explicit override CLERK_ISSUER_DOMAIN.
grep -qE '^(VITE_CLERK_PUBLISHABLE_KEY|CLERK_ISSUER_DOMAIN)=' .env && echo "Clerk domain source: set" || echo "Clerk domain source: MISSING — set VITE_CLERK_PUBLISHABLE_KEY or CLERK_ISSUER_DOMAIN"
```

If your env lives in a systemd `EnvironmentFile` rather than `.env`, check there
instead. **Do not proceed if either prints MISSING.**

Recommended (optional, after confirming login works): set
`CLERK_AUTHORIZED_PARTIES` to your frontend origin(s) to turn on the azp replay
check added in `67b536f`.

---

## Step 1 — The one deploy (VPS: backend + web frontend)

This single sequence deploys every web/api commit in the session. `develop` tip
is `e23ffe5`.

```bash
cd /opt/hireshade/app && \
git pull origin develop && \
pnpm install --frozen-lockfile && \
npx tsc -b lib/db --force && \
pnpm --filter @workspace/api-server build && \
pnpm --filter @workspace/craft-vita build && \
systemctl restart hireshade-api && \
sleep 2 && \
systemctl is-active hireshade-api && \
nginx -t && systemctl reload nginx
```

Notes:
- `pnpm install --frozen-lockfile` should now SUCCEED (that's what `3f67674`
  fixed). If it still errors with an overrides mismatch, the VPS pnpm version
  resolves differently than expected — capture the error and report it.
- `pnpm --filter ... build` should no longer die on the pre-run deps check
  (also `3f67674`). If it does, the VPS pnpm predates that behaviour and the
  fix is a harmless no-op there.

---

## Step 2 — Smoke checks (right after restart, before user testing)

```bash
# API alive + auth enforced (not 500 / not open)
curl -s -o /dev/null -w "questions(401): %{http_code}\n"        http://localhost:4000/api/question-bank/questions
curl -s -o /dev/null -w "documents(401): %{http_code}\n"        http://localhost:4000/api/document/list

# f8d0b78: dead legacy route is GONE (want 404, NOT 401/200)
curl -s -o /dev/null -w "legacy array(404): %{http_code}\n"     http://localhost:4000/api/session-notes/x/array

# b441139: the transcript PATCH route now EXISTS (want 401, NOT 404)
curl -s -o /dev/null -w "transcript patch(401): %{http_code}\n" -X PATCH http://localhost:4000/api/session/x/transcript/y

# Boot log has no Clerk domain resolution error (67b536f fails closed loudly)
journalctl -u hireshade-api -n 30 --no-pager | grep -i "clerk\|cannot determine\|not a valid hostname" || echo "no clerk errors"
```

Expected: `401, 401, 404, 401`, and "no clerk errors". A `404` on the transcript
PATCH or a `401`/`200` on the legacy array route means the build didn't take.

**Then immediately test a real login in the app** — `67b536f` changed auth
resolution, so confirm sign-in works before declaring success. If login breaks
with "Cannot determine Clerk issuer domain", set `CLERK_ISSUER_DOMAIN=<your
clerk domain>` and restart.

---

## Step 3 — Per-commit manual verification (web/api)

Deploy is one step; verification is per-fix. Do these in the running app.

| Commit | What to test | Pass = |
|---|---|---|
| `af41188` documents upload | Upload a non-PDF via the UI; try a >10MB PDF | Both rejected with a clear error |
| `7082368` question bank | Open the Question Bank; inspect a question's network response in DevTools | No `contributorUserId` / `sessionId` fields present |
| `f8d0b78` session notes | Open a past session → AI Notes tab → "Generate Analytics" | Produces a summary (not an infinite spinner); 422 shown if too little transcript |
| `67b536f` Clerk JWT | Sign in (email + Google) | Works normally; clock-skew 401s gone |
| `b575919` Deepgram key | DevTools → Sources on the deployed site; search bundle for your DG key. Then run a session | Key absent from bundle; live transcription still works (server-minted) |
| `49602ab` auth hand-off | Normal desktop sign-in flow (if testing desktop); confirm `?port=` only accepts numbers | Login works; a crafted `?port=@evil.com` is rejected (console log) |
| `b441139` transcript persistence | Run a session, drop Wi-Fi mid-session for ~10s, restore, end session, open review | All transcript lines present on review (retry recovered them) |
| `f738eac` network recovery | In a session, drop Wi-Fi > 40s (past retry budget), restore | Mic transcription resumes on reconnect |

---

## Step 4 — Rust change (CI, not VPS)

`e23ffe5` (reader-task/fd leak) is **Rust — not compile-verified in the audit
sandbox.** The push to `develop` triggers `desktop-build.yml`, which runs
`cargo`-backed `pnpm tauri build` across macOS/Windows/Linux.

- Go to the repo's **Actions** tab → latest **Desktop Build** run.
- If it's green, the Rust change compiles. If it's red on a `cargo`/Rust error,
  paste me the error and I'll fix it immediately.
- This fix only affects behaviour inside the desktop binary; it reaches users
  only through a signed desktop release (Step 5).

---

## Step 5 — Desktop distribution (blocked on you)

`747e579` / `582e581` wired the download button + updater to a GitHub Releases
manifest, but the pipeline can't cut a release until you complete the one-time
setup in **`docs/Desktop-Release-Runbook.md`**:

1. Add `.github/workflows/desktop-release.yml` (its full contents are in the
   runbook appendix — the audit token lacked `workflow` scope to commit it).
2. `pnpm tauri signer generate`; add `TAURI_SIGNING_PRIVATE_KEY` +
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets; paste the public key into
   `tauri.conf.json` (replace `REPLACE_WITH_TAURI_UPDATER_PUBLIC_KEY`).
3. Bump the version in the 3 files (tauri.conf.json / Cargo.toml / package.json),
   tag `vX.Y.Z`, push, review the draft release, publish.

Until then: the web-served fixes are live for everyone after Step 1; the
desktop-binary fixes (`e23ffe5`, the desktop half of `49602ab`) wait for the
first signed release.

---

## Rollback

Every change is one commit on `develop`. To roll back the whole session:
`git reset --hard a7a52cd && <rebuild steps from Step 1>`. To roll back a single
fix, `git revert <sha>` then redeploy — none of them depend on each other at the
DB level (no schema changes), so reverts are clean.
