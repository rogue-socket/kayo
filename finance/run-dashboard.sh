#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-4173}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST="127.0.0.1"

is_port_listening() {
  local port="$1"
  lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1
}

is_finance_server_on_port() {
  local port="$1"
  local pids pid cmd
  pids="$(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true)"
  for pid in ${pids}; do
    cmd="$(ps -p "${pid}" -o command= 2>/dev/null || true)"
    if [[ "${cmd}" == *"python -m http.server"* && "${cmd}" == *"--directory ${ROOT_DIR}"* ]]; then
      return 0
    fi
  done
  return 1
}

find_free_port() {
  local candidate="$1"
  while is_port_listening "${candidate}"; do
    candidate=$((candidate + 1))
  done
  echo "${candidate}"
}

url_for_port() {
  local port="$1"
  echo "http://${HOST}:${port}/dashboard.html"
}

if is_finance_server_on_port "${PORT}"; then
  url_for_port "${PORT}"
  exit 0
fi

if is_port_listening "${PORT}"; then
  PORT="$(find_free_port "$PORT")"
fi

LOG_FILE="/tmp/finance-dashboard-${PORT}.log"
nohup conda run -n wa-data python -m http.server "${PORT}" --directory "${ROOT_DIR}" >"${LOG_FILE}" 2>&1 &

url_for_port "${PORT}"
