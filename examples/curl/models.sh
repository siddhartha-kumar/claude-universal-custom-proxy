#!/usr/bin/env bash
set -euo pipefail

# Resolve OPENAI_COMPATIBLE_API_KEY with precedence: env var, ./.env, repo-root .env
if [ -z "${OPENAI_COMPATIBLE_API_KEY:-}" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    for envfile in "$PWD/.env" "$SCRIPT_DIR/../../.env"; do
        if [ -f "$envfile" ]; then
            OPENAI_COMPATIBLE_API_KEY=$(grep -m1 '^GATEWAY_API_KEYS=' "$envfile" | cut -d= -f2- | tr -d '"' | tr -d "'")
            export OPENAI_COMPATIBLE_API_KEY
            break
        fi
    done
fi
: "${OPENAI_COMPATIBLE_API_KEY:?set OPENAI_COMPATIBLE_API_KEY or add GATEWAY_API_KEYS=... to .env}"

curl "${OPENAI_COMPATIBLE_BASE_URL:-http://localhost:8080/v1}/models" \
  -H "Authorization: Bearer ${OPENAI_COMPATIBLE_API_KEY}"
