#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="scribeshade-admin"
REMOTE_HOST="${REMOTE_HOST:-hireshade.com}"
REMOTE_USER="${REMOTE_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/root/scribeshade-admin}"
REMOTE="${REMOTE_USER}@${REMOTE_HOST}"
SSH_CONTROL_PATH="/tmp/${APP_NAME}-${REMOTE_HOST}-%r@%h:%p"
SSH_OPTS=(
  -o ControlMaster=auto
  -o ControlPersist=10m
  -o ControlPath="${SSH_CONTROL_PATH}"
  -o StrictHostKeyChecking=accept-new
  -o IdentitiesOnly=yes
  -i "${SSH_IDENTITY_FILE:-$HOME/.ssh/id_ed25519_nopass}"
)

SSH_BIN=(ssh)
SCP_BIN=(scp)
RSYNC_RSH=(ssh)

if command -v sshpass >/dev/null 2>&1 && [[ -n "${SSHPASS:-}" ]]; then
  SSH_BIN=(sshpass -e ssh)
  SCP_BIN=(sshpass -e scp)
  RSYNC_RSH=(sshpass -e ssh)
fi

log() {
  printf '\n[%s] %s\n' "$(date '+%H:%M:%S')" "$*"
}

if ! command -v ssh >/dev/null 2>&1; then
  echo "ssh is required locally." >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "rsync is required locally." >&2
  exit 1
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required locally." >&2
  exit 1
fi

log "Installing local dependencies"
pnpm install --ignore-workspace

log "Building admin app"
pnpm build

log "Preparing ${REMOTE}:${REMOTE_DIR}"
"${SSH_BIN[@]}" "${SSH_OPTS[@]}" "${REMOTE}" "mkdir -p '${REMOTE_DIR}'"

log "Syncing application files"
rsync -az --delete \
  --exclude '.git' \
  --exclude '.DS_Store' \
  --exclude '.env.*' \
  --exclude 'node_modules' \
  --exclude 'app.db' \
  --exclude 'app.db-shm' \
  --exclude 'app.db-wal' \
  --exclude '*.log' \
  --exclude 'docker-compose.yml' \
  --exclude 'Dockerfile' \
  -e "${RSYNC_RSH[*]} ${SSH_OPTS[*]}" \
  ./ "${REMOTE}:${REMOTE_DIR}/"

log "Installing production dependencies on remote"
"${SSH_BIN[@]}" "${SSH_OPTS[@]}" "${REMOTE}" "cd '${REMOTE_DIR}' && if command -v pnpm >/dev/null 2>&1; then pnpm install --prod --frozen-lockfile; elif command -v corepack >/dev/null 2>&1; then corepack pnpm install --prod --frozen-lockfile; else echo 'pnpm or corepack is required on the remote host.' >&2; exit 1; fi"

log "Restarting application process"
"${SSH_BIN[@]}" "${SSH_OPTS[@]}" "${REMOTE}" "cd '${REMOTE_DIR}' && if [ -f app.pid ]; then old_pid=\$(cat app.pid); kill \"\$old_pid\" >/dev/null 2>&1 || true; fi && if command -v pnpm >/dev/null 2>&1; then nohup pnpm start > app.log 2>&1 & echo \$! > app.pid; elif command -v corepack >/dev/null 2>&1; then nohup corepack pnpm start > app.log 2>&1 & echo \$! > app.pid; else echo 'pnpm or corepack is required on the remote host.' >&2; exit 1; fi"

log "Deployment complete"
