"""Shared resolver for OPENAI_COMPATIBLE_* values used by the Python examples.

Precedence:
    1. Existing environment variable.
    2. ``.env`` in the current working directory.
    3. ``.env`` at the repository root (two levels above this file).
    4. Built-in defaults for ``base_url`` and ``model``; ``api_key`` has no default.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _candidate_dotenvs() -> list[Path]:
    here = Path(__file__).resolve().parent
    return [Path.cwd() / ".env", here.parent.parent / ".env"]


def _read_dotenv_value(key: str) -> str | None:
    for path in _candidate_dotenvs():
        if not path.exists():
            continue
        try:
            for raw_line in path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, raw_value = line.split("=", 1)
                if k.strip() == key:
                    value = raw_value.strip().strip('"').strip("'")
                    return value
        except OSError:
            continue
    return None


def resolve_base_url() -> str:
    return os.environ.get("OPENAI_COMPATIBLE_BASE_URL", "http://localhost:8080/v1")


def resolve_model() -> str:
    return os.environ.get("OPENAI_COMPATIBLE_MODEL", "ollama-cloud/gemma3:4b")


def resolve_api_key() -> str:
    key = os.environ.get("OPENAI_COMPATIBLE_API_KEY")
    if key:
        return key
    fallback = _read_dotenv_value("GATEWAY_API_KEYS")
    if fallback:
        return fallback
    sys.stderr.write(
        "OPENAI_COMPATIBLE_API_KEY is not set and no GATEWAY_API_KEYS entry was "
        "found in .env. Either set the env var or add the key to .env.\n"
    )
    raise SystemExit(1)
