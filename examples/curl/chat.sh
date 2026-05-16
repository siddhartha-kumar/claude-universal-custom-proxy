#!/usr/bin/env bash
set -euo pipefail

curl "${OPENAI_COMPATIBLE_BASE_URL:-http://localhost:8080/v1}/chat/completions" \
  -H "Authorization: Bearer ${OPENAI_COMPATIBLE_API_KEY:?set OPENAI_COMPATIBLE_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "'"${OPENAI_COMPATIBLE_MODEL:-ollama-local/llama3.2}"'",
    "messages": [{"role": "user", "content": "Say hello in one sentence."}]
  }'
