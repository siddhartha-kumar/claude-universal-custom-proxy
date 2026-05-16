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

curl -N "${OPENAI_COMPATIBLE_BASE_URL:-http://localhost:8080/v1}/chat/completions" \
  -H "Authorization: Bearer ${OPENAI_COMPATIBLE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "'"${OPENAI_COMPATIBLE_MODEL:-ollama-cloud/gemma3:4b}"'",
    "stream": true,
    "messages": [{"role": "user", "content": "Write one short sentence."}]
  }'
