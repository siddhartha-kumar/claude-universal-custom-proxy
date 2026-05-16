from __future__ import annotations

from llm_proxy_gateway.config.settings import ProviderType, Settings
from llm_proxy_gateway.providers.base import ProviderClient
from llm_proxy_gateway.providers.ollama import OllamaProvider
from llm_proxy_gateway.providers.openai_compatible import OpenAICompatibleProvider


def build_providers(settings: Settings) -> dict[str, ProviderClient]:
    providers: dict[str, ProviderClient] = {}
    for name, config in settings.providers.items():
        if not config.enabled:
            continue
        if config.type is ProviderType.OPENAI_COMPATIBLE:
            providers[name] = OpenAICompatibleProvider(config)
        elif config.type is ProviderType.OLLAMA:
            providers[name] = OllamaProvider(config)
    return providers
