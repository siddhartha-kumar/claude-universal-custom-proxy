from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from typing import Any

import httpx
from pydantic import SecretStr

from llm_proxy_gateway.config.settings import (
    ProviderConfig,
    ProviderType,
    RouteRuleConfig,
    Settings,
)
from llm_proxy_gateway.main import create_app
from llm_proxy_gateway.models.openai import ModelCard
from llm_proxy_gateway.providers.base import ProviderStatus


class RecordingProvider:
    """Fake provider that records what it receives and returns deterministic
    OpenAI-shaped responses or streams.
    """

    def __init__(self, config: ProviderConfig, *, stream_chunks: list[bytes] | None = None) -> None:
        self.name = config.name
        self.config = config
        self.seen_payloads: list[dict[str, Any]] = []
        self.stream_chunks = stream_chunks or [
            b'data: {"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant"},'
            b'"finish_reason":null}]}\n\n',
            b'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Hel"},'
            b'"finish_reason":null}]}\n\n',
            b'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"lo"},'
            b'"finish_reason":null}]}\n\n',
            b'data: {"id":"chatcmpl-1","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
            b"data: [DONE]\n\n",
        ]

    async def chat_completion(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        self.seen_payloads.append(dict(payload))
        return {
            "id": "chatcmpl-test",
            "object": "chat.completion",
            "created": 0,
            "model": payload["model"],
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "Hello there."},
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": 4,
                "completion_tokens": 3,
                "total_tokens": 7,
            },
        }

    async def stream_chat_completion(self, payload: Mapping[str, Any]) -> AsyncIterator[bytes]:
        self.seen_payloads.append(dict(payload))
        for chunk in self.stream_chunks:
            yield chunk

    async def image_generation(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        return {"created": 0, "data": []}

    async def list_models(self) -> list[ModelCard]:
        return [ModelCard(id="ollama-cloud/gemma3:4b", owned_by=self.name, created=0)]

    async def healthcheck(self) -> ProviderStatus:
        return ProviderStatus(name=self.name, configured=True, available=True, detail="ok")

    async def close(self) -> None:
        return None


def _settings_with_anthropic_default(default_model: str = "ollama-cloud/gemma3:4b") -> Settings:
    fake = ProviderConfig(
        name="fake",
        type=ProviderType.OPENAI_COMPATIBLE,
        base_url="https://example.test/v1",
        model_prefixes=["ollama-cloud/"],
    )
    return Settings(
        environment="test",
        auth_enabled=True,
        gateway_api_keys=[SecretStr("test-key")],
        rate_limit_enabled=False,
        anthropic_default_model=default_model,
        providers={"fake": fake},
        routes=[RouteRuleConfig(provider="fake", prefixes=["ollama-cloud/"])],
    )


async def test_anthropic_messages_translates_round_trip() -> None:
    settings = _settings_with_anthropic_default()
    provider = RecordingProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/messages",
            headers={"x-api-key": "test-key", "Content-Type": "application/json"},
            json={
                "model": "claude-sonnet-4",
                "max_tokens": 32,
                "system": "Be concise.",
                "messages": [{"role": "user", "content": "Say hi"}],
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "message"
    assert body["role"] == "assistant"
    assert body["model"] == "claude-sonnet-4"
    assert body["content"] == [{"type": "text", "text": "Hello there."}]
    assert body["stop_reason"] == "end_turn"
    assert body["usage"] == {"input_tokens": 4, "output_tokens": 3}

    forwarded = provider.seen_payloads[0]
    assert forwarded["model"] == "ollama-cloud/gemma3:4b"
    assert forwarded["messages"][0] == {"role": "system", "content": "Be concise."}
    assert forwarded["messages"][1] == {"role": "user", "content": "Say hi"}


async def test_anthropic_messages_authenticates_via_x_api_key() -> None:
    settings = _settings_with_anthropic_default()
    provider = RecordingProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/messages",
            headers={"Content-Type": "application/json"},
            json={
                "model": "claude-sonnet-4",
                "max_tokens": 32,
                "messages": [{"role": "user", "content": "hi"}],
            },
        )

    assert response.status_code == 401


async def test_anthropic_messages_streaming_emits_event_sequence() -> None:
    settings = _settings_with_anthropic_default()
    provider = RecordingProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with (
        httpx.AsyncClient(transport=transport, base_url="http://test") as client,
        client.stream(
            "POST",
            "/v1/messages",
            headers={"x-api-key": "test-key", "Content-Type": "application/json"},
            json={
                "model": "claude-sonnet-4",
                "max_tokens": 32,
                "stream": True,
                "messages": [{"role": "user", "content": "stream"}],
            },
        ) as response,
    ):
        body = await response.aread()

    assert response.status_code == 200
    text = body.decode()
    assert "event: message_start" in text
    assert "event: content_block_start" in text
    assert '"text":"Hel"' in text
    assert '"text":"lo"' in text
    assert "event: content_block_stop" in text
    assert "event: message_delta" in text
    assert "event: message_stop" in text


async def test_anthropic_default_model_used_when_prefix_unmatched() -> None:
    settings = _settings_with_anthropic_default(default_model="ollama-cloud/gemma3:4b")
    provider = RecordingProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/messages",
            headers={"x-api-key": "test-key", "Content-Type": "application/json"},
            json={
                "model": "claude-opus-4-7",
                "max_tokens": 16,
                "messages": [{"role": "user", "content": "x"}],
            },
        )

    assert response.status_code == 200
    forwarded = provider.seen_payloads[0]
    assert forwarded["model"] == "ollama-cloud/gemma3:4b"
    # Anthropic response model field echoes the original Claude name back
    assert response.json()["model"] == "claude-opus-4-7"


async def test_anthropic_default_model_unset_returns_model_not_found() -> None:
    fake = ProviderConfig(
        name="fake",
        type=ProviderType.OPENAI_COMPATIBLE,
        base_url="https://example.test/v1",
        model_prefixes=["ollama-cloud/"],
    )
    settings = Settings(
        environment="test",
        auth_enabled=True,
        gateway_api_keys=[SecretStr("test-key")],
        rate_limit_enabled=False,
        anthropic_default_model=None,
        providers={"fake": fake},
        routes=[RouteRuleConfig(provider="fake", prefixes=["ollama-cloud/"])],
    )
    provider = RecordingProvider(fake)
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/messages",
            headers={"x-api-key": "test-key", "Content-Type": "application/json"},
            json={
                "model": "claude-opus-4",
                "max_tokens": 16,
                "messages": [{"role": "user", "content": "x"}],
            },
        )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "model_not_found"


async def test_anthropic_messages_validation_error_for_empty_messages() -> None:
    settings = _settings_with_anthropic_default()
    provider = RecordingProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/messages",
            headers={"x-api-key": "test-key", "Content-Type": "application/json"},
            json={"model": "claude-sonnet-4", "max_tokens": 16, "messages": []},
        )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request_error"
