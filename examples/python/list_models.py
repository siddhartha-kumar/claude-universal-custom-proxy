"""List models exposed by the gateway.

Reads OPENAI_COMPATIBLE_* values from the environment, falling back to a
``.env`` file at the repository root if the environment variable is unset.
"""

from __future__ import annotations

import json
import sys

import httpx
from _common import resolve_api_key, resolve_base_url


def main() -> int:
    base_url = resolve_base_url()
    api_key = resolve_api_key()

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
