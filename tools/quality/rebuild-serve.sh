#!/usr/bin/env bash
# Local helper: rebuild the landing and restart the standalone server on :3000.
set -e
cd "$(dirname "$0")/../.."
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id \$_.OwningProcess -Force }" || true
pnpm build 2>&1 | grep -E "rror|Compiled|Failed" || true
# Fully detach the server (stdin/stdout/stderr) so callers piping this script do not wait on it.
(cd apps/landing-web && nohup node scripts/start-standalone.mjs 3000 < /dev/null > "${TMPDIR:-/tmp}/landing-server.log" 2>&1 & disown) > /dev/null 2>&1
for i in $(seq 1 30); do curl -sf http://localhost:3000/health >/dev/null && echo "serving :3000" && exit 0; sleep 1; done
echo "server did not start"; exit 1
