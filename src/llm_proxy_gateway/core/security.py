from __future__ import annotations

import secrets
from collections.abc import Mapping
from typing import Any

from pydantic import SecretStr

SENSITIVE_FIELDS = {
    "authorization",
    "api-key",
    "apikey",
    "api_key",
    "access_token",
    "token",
    "secret",
    "password",
    "x-api-key",
}


def constant_time_match(candidate: str, configured: list[SecretStr]) -> bool:
    return any(secrets.compare_digest(candidate, item.get_secret_value()) for item in configured)


def redact_mapping(values: Mapping[str, Any]) -> dict[str, Any]:
    redacted: dict[str, Any] = {}
    for key, value in values.items():
        if _is_sensitive(key):
            redacted[key] = "[REDACTED]"
        elif isinstance(value, Mapping):
            redacted[key] = redact_mapping(value)
        else:
            redacted[key] = value
    return redacted


def _is_sensitive(key: str) -> bool:
    lowered = key.lower()
    return any(field in lowered for field in SENSITIVE_FIELDS)
