"""Streaming chat completion example using OpenAI-style SSE."""

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
