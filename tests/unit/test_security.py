from __future__ import annotations

from pydantic import SecretStr

from llm_proxy_gateway.core.security import constant_time_match, redact_mapping


def test_constant_time_match() -> None:
    assert constant_time_match("secret", [SecretStr("secret")])
    assert not constant_time_match("wrong", [SecretStr("secret")])


def test_redact_mapping_recurses_sensitive_fields() -> None:
    redacted = redact_mapping(
        {
            "Authorization": "Bearer secret",
            "nested": {"api_key": "secret", "visible": "value"},
        }
    )

    assert redacted["Authorization"] == "[REDACTED]"
    assert redacted["nested"] == {"api_key": "[REDACTED]", "visible": "value"}
