"""List models exposed by the gateway."""

from __future__ import annotations

import json
import os
import sys

import httpx


def main() -> int:
    base_url = os.environ.get("OPENAI_COMPATIBLE_BASE_URL", "http://localhost:8080/v1")
    api_key = os.environ.get("OPENAI_COMPATIBLE_API_KEY")
    if api_key is None:
        sys.stderr.write("OPENAI_COMPATIBLE_API_KEY is required\n")
        return 1

    with httpx.Client(timeout=30.0) as client:
        response = client.get(
            f"{base_url}/models",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        response.raise_for_status()
        payload = response.json()
        sys.stdout.write(json.dumps(payload, indent=2))
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
