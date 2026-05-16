from __future__ import annotations

from llm_proxy_gateway.config.settings import ProviderConfig, ProviderType, Settings
from llm_proxy_gateway.providers.factory import build_providers
from llm_proxy_gateway.providers.ollama import OllamaProvider
from llm_proxy_gateway.providers.openai_compatible import OpenAICompatibleProvider


def test_build_providers_constructs_enabled_provider_types() -> None:
    settings = Settings(
        environment="test",
        providers={
            "openai": ProviderConfig(
                name="openai",
                type=ProviderType.OPENAI_COMPATIBLE,
                base_url="https://api.openai.com/v1",
            ),
            "ollama-local": ProviderConfig(
                name="ollama-local",
                type=ProviderType.OLLAMA,
                base_url="http://localhost:11434",
                allow_private_network=True,
            ),
            "disabled": ProviderConfig(
                name="disabled",
                type=ProviderType.OPENAI_COMPATIBLE,
                base_url="https://disabled.example/v1",
                enabled=False,
            ),
        },
    )

    providers = build_providers(settings)

    assert isinstance(providers["openai"], OpenAICompatibleProvider)
    assert isinstance(providers["ollama-local"], OllamaProvider)
    assert "disabled" not in providers
