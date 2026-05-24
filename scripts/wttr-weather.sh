#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  cat <<'EOF'
Usage: wttr-weather.sh [location]

Fetch a one-line forecast from wttr.in (format=3).
Default location: Bangalore.

Example:
  wttr-weather.sh "New York"
EOF
  exit 0
fi

location="${1:-Bangalore}"
encoded_location="${location// /%20}"

curl --silent "wttr.in/${encoded_location}?format=3"
