#!/usr/bin/env bash
set -euo pipefail

curl "${OPENAI_COMPATIBLE_BASE_URL:-http://localhost:8080/v1}/models" \
  -H "Authorization: Bearer ${OPENAI_COMPATIBLE_API_KEY:?set OPENAI_COMPATIBLE_API_KEY}"
