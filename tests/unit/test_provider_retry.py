from __future__ import annotations

import httpx
import pytest

from llm_proxy_gateway.config.settings import ProviderConfig, ProviderType, RetryConfig
from llm_proxy_gateway.core.errors import ProviderError
from llm_proxy_gateway.providers.ollama import OllamaProvider
from llm_proxy_gateway.providers.openai_compatible import OpenAICompatibleProvider


async def test_openai_provider_retries_then_succeeds() -> None:
    attempts = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(503, json={"error": {"message": "unavailable"}})
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-test",
                "object": "chat.completion",
                "choices": [{"message": {"role": "assistant", "content": "ok"}}],
            },
        )

    provider = OpenAICompatibleProvider(
        ProviderConfig(
            name="openai",
            type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://api.openai.com/v1",
            retry=RetryConfig(max_attempts=3, backoff_seconds=0.0),
        )
    )
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    payload = await provider.chat_completion(
        {"model": "gpt-test", "messages": [{"role": "user", "content": "hi"}]}
    )
    await provider.close()

    assert attempts == 2
    assert payload["id"] == "chatcmpl-test"


async def test_openai_provider_does_not_retry_non_retryable_status() -> None:
    attempts = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        return httpx.Response(400, json={"error": {"message": "bad request"}})

    provider = OpenAICompatibleProvider(
        ProviderConfig(
            name="openai",
            type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://api.openai.com/v1",
            retry=RetryConfig(max_attempts=3, backoff_seconds=0.0),
        )
    )
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    with pytest.raises(ProviderError, match="bad request") as exc_info:
        await provider.chat_completion(
            {"model": "gpt-test", "messages": [{"role": "user", "content": "hi"}]}
        )
    await provider.close()

    assert attempts == 1
    assert exc_info.value.status_code == 400


async def test_openai_provider_handles_timeout_with_retry_exhaustion() -> None:
    attempts = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        raise httpx.ConnectTimeout("timed out")

    provider = OpenAICompatibleProvider(
        ProviderConfig(
            name="openai",
            type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://api.openai.com/v1",
            retry=RetryConfig(max_attempts=2, backoff_seconds=0.0),
        )
    )
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    with pytest.raises(ProviderError, match="timed out") as exc_info:
        await provider.chat_completion(
            {"model": "gpt-test", "messages": [{"role": "user", "content": "hi"}]}
        )
    await provider.close()

    assert attempts == 2
    assert exc_info.value.status_code == 504


async def test_openai_provider_handles_transport_error() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connect refused")

    provider = OpenAICompatibleProvider(
        ProviderConfig(
            name="openai",
            type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://api.openai.com/v1",
            retry=RetryConfig(max_attempts=1, backoff_seconds=0.0),
        )
    )
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    with pytest.raises(ProviderError, match="upstream provider request failed"):
        await provider.list_models()
    await provider.close()


async def test_ollama_provider_retries_on_retryable_status() -> None:
    attempts = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            return httpx.Response(503, json={"error": "unavailable"})
        return httpx.Response(200, json={"models": []})

    provider = OllamaProvider(
        ProviderConfig(
            name="ollama-local",
            type=ProviderType.OLLAMA,
            base_url="http://localhost:11434",
            allow_private_network=True,
            retry=RetryConfig(max_attempts=3, backoff_seconds=0.0),
        )
    )
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    models = await provider.list_models()
    await provider.close()

    assert attempts == 2
    assert models == []


async def test_ollama_provider_handles_timeout() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("timed out")

    provider = OllamaProvider(
        ProviderConfig(
            name="ollama-local",
            type=ProviderType.OLLAMA,
            base_url="http://localhost:11434",
            allow_private_network=True,
            retry=RetryConfig(max_attempts=1, backoff_seconds=0.0),
        )
    )
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    with pytest.raises(ProviderError, match="timed out") as exc_info:
        await provider.list_models()
    await provider.close()

    assert exc_info.value.status_code == 504


async def test_ollama_provider_stream_maps_http_error() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, content=b"down")

    provider = OllamaProvider(
        ProviderConfig(
            name="ollama-local",
            type=ProviderType.OLLAMA,
            base_url="http://localhost:11434",
            allow_private_network=True,
        )
    )
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    payload = {"model": "llama3.2", "messages": [{"role": "user", "content": "hi"}]}
    with pytest.raises(ProviderError, match="down"):
        _ = [chunk async for chunk in provider.stream_chat_completion(payload)]
    await provider.close()


async def test_openai_compatible_safe_error_message_falls_back() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            500,
            content=b"<html>upstream failed</html>",
            headers={"content-type": "text/html"},
        )

    provider = OpenAICompatibleProvider(
        ProviderConfig(
            name="openai",
            type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://api.openai.com/v1",
            retry=RetryConfig(max_attempts=1, backoff_seconds=0.0),
        )
    )
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    with pytest.raises(ProviderError, match="upstream provider returned HTTP 500"):
        await provider.list_models()
    await provider.close()
