from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from typing import Any

import pytest
from pydantic import SecretStr

from llm_proxy_gateway.config.settings import (
    ProviderConfig,
    ProviderType,
    RouteRuleConfig,
    Settings,
)
from llm_proxy_gateway.models.openai import ModelCard
from llm_proxy_gateway.providers.base import ProviderStatus


class FakeProvider:
    def __init__(self, config: ProviderConfig, *, fail: bool = False) -> None:
        self.name = config.name
        self.config = config
        self.fail = fail
        self.closed = False
        self.seen_payloads: list[dict[str, Any]] = []

    async def chat_completion(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        self.seen_payloads.append(dict(payload))
        if self.fail:
            from llm_proxy_gateway.core.errors import ProviderError

            raise ProviderError(self.name, "provider unavailable", status_code=503)
        return {
            "id": "chatcmpl-test",
            "object": "chat.completion",
            "created": 0,
            "model": payload["model"],
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "ok"},
                    "finish_reason": "stop",
                }
            ],
        }

    async def image_generation(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        self.seen_payloads.append(dict(payload))
        return {"created": 0, "data": [{"url": "https://example.test/image.png"}]}

    async def list_models(self) -> list[ModelCard]:
        if self.fail:
            raise RuntimeError("discovery failed")
        return [ModelCard(id="fake-dynamic", owned_by=self.name, created=0)]

    async def healthcheck(self) -> ProviderStatus:
        return ProviderStatus(
            name=self.name,
            configured=True,
            available=not self.fail,
            detail="available" if not self.fail else "unavailable",
        )

    async def close(self) -> None:
        self.closed = True

    async def stream_chat_completion(self, payload: Mapping[str, Any]) -> AsyncIterator[bytes]:
        self.seen_payloads.append(dict(payload))
        yield b'data: {"choices":[{"delta":{"content":"o"}}]}\n\n'
        yield b'data: {"choices":[{"delta":{"content":"k"}}]}\n\n'
        yield b"data: [DONE]\n\n"


@pytest.fixture
def fake_provider_config() -> ProviderConfig:
    return ProviderConfig(
        name="fake",
        type=ProviderType.OPENAI_COMPATIBLE,
        base_url="https://example.test/v1",
        supports_images=True,
        supports_models=True,
        model_prefixes=["fake-"],
        static_models=["fake-static"],
    )


@pytest.fixture
def settings(fake_provider_config: ProviderConfig) -> Settings:
    return Settings(
        environment="test",
        auth_enabled=True,
        gateway_api_keys=[SecretStr("test-key")],
        rate_limit_enabled=False,
        providers={"fake": fake_provider_config},
        routes=[RouteRuleConfig(provider="fake", prefixes=["fake-"])],
    )
