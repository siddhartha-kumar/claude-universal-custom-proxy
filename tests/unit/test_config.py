from __future__ import annotations

from pathlib import Path

import pytest
from pydantic import ValidationError

from llm_proxy_gateway.config.settings import ProviderConfig, ProviderType, Settings, load_settings


def test_production_requires_auth_and_gateway_keys() -> None:
    with pytest.raises(ValidationError, match="production requires at least one gateway API key"):
        Settings(environment="production", auth_enabled=True, gateway_api_keys=[])


def test_production_rejects_disabled_auth() -> None:
    with pytest.raises(ValidationError, match="production requires auth_enabled=true"):
        Settings(environment="production", auth_enabled=False, gateway_api_keys=["key"])


def test_provider_blocks_private_network_without_explicit_allowance() -> None:
    with pytest.raises(ValidationError, match="private address"):
        ProviderConfig(
            name="unsafe",
            type=ProviderType.OPENAI_COMPATIBLE,
            base_url="http://127.0.0.1:8000/v1",
        )


def test_provider_allows_private_network_when_explicit() -> None:
    provider = ProviderConfig(
        name="ollama-local",
        type=ProviderType.OLLAMA,
        base_url="http://127.0.0.1:11434",
        allow_private_network=True,
    )

    assert provider.base_url == "http://127.0.0.1:11434"


def test_route_references_known_provider() -> None:
    with pytest.raises(ValidationError, match="routes reference unknown providers"):
        Settings(
            environment="test",
            providers={},
            routes=[{"provider": "missing", "prefixes": ["missing-"]}],
        )


def test_load_settings_supports_dotenv_provider_key(tmp_path: Path) -> None:
    config = tmp_path / "config.yaml"
    dotenv = tmp_path / ".env"
    config.write_text(
        """
providers:
  openai:
    name: openai
    type: openai_compatible
    base_url: https://api.openai.com/v1
    api_key_env: OPENAI_API_KEY
routes:
  - provider: openai
    prefixes: ["gpt-"]
""",
        encoding="utf-8",
    )
    dotenv.write_text("OPENAI_API_KEY=secret\nGATEWAY_API_KEYS=proxy-key\n", encoding="utf-8")

    settings = load_settings(config, env_file=dotenv)

    assert settings.providers["openai"].api_key is not None
    assert settings.providers["openai"].api_key.get_secret_value() == "secret"
    assert settings.gateway_api_keys[0].get_secret_value() == "proxy-key"
