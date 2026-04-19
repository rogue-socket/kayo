#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-4173}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="/tmp/finance-dashboard-${PORT}.log"

if lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "http://127.0.0.1:${PORT}/dashboard.html"
  exit 0
fi

nohup conda run -n wa-data python -m http.server "${PORT}" --directory "${ROOT_DIR}" >"${LOG_FILE}" 2>&1 &

echo "http://127.0.0.1:${PORT}/dashboard.html"
