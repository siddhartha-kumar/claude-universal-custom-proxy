"""Minimal OpenAI-compatible chat completion example using httpx."""

from __future__ import annotations

import json
import os
import sys

import httpx


def main() -> int:
    base_url = os.environ.get("OPENAI_COMPATIBLE_BASE_URL", "http://localhost:8080/v1")
    api_key = os.environ.get("OPENAI_COMPATIBLE_API_KEY")
    model = os.environ.get("OPENAI_COMPATIBLE_MODEL", "ollama-local/llama3.2")
    if api_key is None:
        sys.stderr.write("OPENAI_COMPATIBLE_API_KEY is required\n")
        return 1

    request_body = {
        "model": model,
        "messages": [
            {"role": "system", "content": "Be concise."},
            {"role": "user", "content": "Say hello in one short sentence."},
        ],
    }
    with httpx.Client(timeout=60.0) as client:
        response = client.post(
            f"{base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=request_body,
        )
        response.raise_for_status()
        payload = response.json()
        sys.stdout.write(json.dumps(payload, indent=2))
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
