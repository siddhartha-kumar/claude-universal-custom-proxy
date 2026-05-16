"""Minimal OpenAI-compatible chat completion example using httpx.

Reads OPENAI_COMPATIBLE_* values from the environment, falling back to a
``.env`` file at the repository root if the environment variable is unset.
See ``_common.py`` for the resolution precedence.
"""

from __future__ import annotations

import json
import sys

import httpx

from _common import resolve_api_key, resolve_base_url, resolve_model


def main() -> int:
    base_url = resolve_base_url()
    api_key = resolve_api_key()
    model = resolve_model()

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
