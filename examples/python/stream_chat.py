"""Streaming chat completion example using OpenAI-style SSE.

Reads OPENAI_COMPATIBLE_* values from the environment, falling back to a
``.env`` file at the repository root if the environment variable is unset.
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
        "stream": True,
        "messages": [{"role": "user", "content": "Write one short sentence."}],
    }
    with (
        httpx.Client(timeout=httpx.Timeout(timeout=None, connect=10.0)) as client,
        client.stream(
            "POST",
            f"{base_url}/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=request_body,
        ) as response,
    ):
        response.raise_for_status()
        for line in response.iter_lines():
            if not line or not line.startswith("data: "):
                continue
            data = line.removeprefix("data: ")
            if data == "[DONE]":
                sys.stdout.write("\n")
                break
            try:
                chunk = json.loads(data)
            except json.JSONDecodeError:
                continue
            for choice in chunk.get("choices") or []:
                delta = choice.get("delta") or {}
                content = delta.get("content")
                if isinstance(content, str):
                    sys.stdout.write(content)
                    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
