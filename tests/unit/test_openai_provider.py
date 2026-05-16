from __future__ import annotations

import httpx
import pytest
from pydantic import SecretStr

from llm_proxy_gateway.config.settings import ProviderConfig, ProviderType
from llm_proxy_gateway.core.errors import ProviderError, RequestValidationError
from llm_proxy_gateway.providers.openai_compatible import OpenAICompatibleProvider


async def test_openai_compatible_provider_chat_and_models() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": "gpt-test", "created": 1}]})
        return httpx.Response(
            200,
            json={
                "id": "chatcmpl-test",
                "object": "chat.completion",
                "choices": [{"message": {"role": "assistant", "content": "ok"}}],
            },
        )

    config = ProviderConfig(
        name="openai",
        type=ProviderType.OPENAI_COMPATIBLE,
        base_url="https://api.openai.com/v1",
    )
    provider = OpenAICompatibleProvider(config)
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    chat = await provider.chat_completion(
        {"model": "gpt-test", "messages": [{"role": "user", "content": "hi"}]}
    )
    models = await provider.list_models()
    await provider.close()

    assert chat["id"] == "chatcmpl-test"
    assert models[0].id == "gpt-test"


async def test_openai_compatible_provider_stream_passthrough() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"data: one\n\ndata: [DONE]\n\n")

    config = ProviderConfig(
        name="openai",
        type=ProviderType.OPENAI_COMPATIBLE,
        base_url="https://api.openai.com/v1",
    )
    provider = OpenAICompatibleProvider(config)
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    chunks = [
        chunk
        async for chunk in provider.stream_chat_completion(
            {"model": "gpt-test", "messages": [{"role": "user", "content": "hi"}]}
        )
    ]
    await provider.close()

    assert b"".join(chunks) == b"data: one\n\ndata: [DONE]\n\n"


async def test_openai_compatible_provider_image_generation() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/images/generations"
        return httpx.Response(
            200, json={"created": 0, "data": [{"url": "https://example.test/a.png"}]}
        )

    config = ProviderConfig(
        name="openai",
        type=ProviderType.OPENAI_COMPATIBLE,
        base_url="https://api.openai.com/v1",
        supports_images=True,
    )
    provider = OpenAICompatibleProvider(config)
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    result = await provider.image_generation({"model": "gpt-image-1", "prompt": "diagram"})
    await provider.close()

    assert result["data"][0]["url"] == "https://example.test/a.png"


async def test_openai_compatible_provider_rejects_unsupported_images() -> None:
    provider = OpenAICompatibleProvider(
        ProviderConfig(
            name="deepseek",
            type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://api.deepseek.com/v1",
            supports_images=False,
        )
    )

    with pytest.raises(RequestValidationError, match="does not support image"):
        await provider.image_generation({"model": "deepseek-chat", "prompt": "diagram"})
    await provider.close()


async def test_openai_compatible_provider_rejects_unsupported_chat() -> None:
    provider = OpenAICompatibleProvider(
        ProviderConfig(
            name="images",
            type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://images.example/v1",
            supports_chat=False,
        )
    )

    with pytest.raises(RequestValidationError, match="does not support chat"):
        await provider.chat_completion({"model": "image-model", "messages": []})
    await provider.close()


async def test_openai_compatible_provider_skips_model_discovery_when_disabled() -> None:
    provider = OpenAICompatibleProvider(
        ProviderConfig(
            name="perplexity",
            type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://api.perplexity.ai/v1",
            supports_models=False,
        )
    )

    models = await provider.list_models()
    status = await provider.healthcheck()
    await provider.close()

    assert models == []
    assert status.available


async def test_openai_compatible_provider_ignores_malformed_models() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [{"id": 42}, "bad", {"id": "model-ok"}]})

    provider = OpenAICompatibleProvider(
        ProviderConfig(
            name="hf",
            type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://router.huggingface.co/v1",
            model_id_prefix="hf/",
        )
    )
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    models = await provider.list_models()
    await provider.close()

    assert [model.id for model in models] == ["hf/model-ok"]


async def test_openai_compatible_provider_healthcheck_missing_key() -> None:
    provider = OpenAICompatibleProvider(
        ProviderConfig(
            name="openai",
            type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://api.openai.com/v1",
            api_key_env="OPENAI_API_KEY",
        )
    )

    status = await provider.healthcheck()
    await provider.close()

    assert not status.configured
    assert "OPENAI_API_KEY" in status.detail


async def test_openai_compatible_provider_healthcheck_available() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": []})

    provider = OpenAICompatibleProvider(
        ProviderConfig(
            name="openai",
            type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://api.openai.com/v1",
            api_key_env="OPENAI_API_KEY",
            api_key=SecretStr("secret"),
        )
    )
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    status = await provider.healthcheck()
    await provider.close()

    assert status.available


async def test_openai_compatible_provider_maps_upstream_error() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": {"message": "slow down"}})

    provider = OpenAICompatibleProvider(
        ProviderConfig(
            name="openai",
            type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://api.openai.com/v1",
        )
    )
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    with pytest.raises(ProviderError, match="slow down") as exc_info:
        await provider.chat_completion({"model": "gpt-test", "messages": []})
    await provider.close()

    assert exc_info.value.status_code == 429


async def test_openai_compatible_stream_maps_http_error() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, content=b"upstream down")

    provider = OpenAICompatibleProvider(
        ProviderConfig(
            name="openai",
            type=ProviderType.OPENAI_COMPATIBLE,
            base_url="https://api.openai.com/v1",
        )
    )
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    with pytest.raises(ProviderError, match="upstream down"):
        _ = [
            chunk
            async for chunk in provider.stream_chat_completion(
                {"model": "gpt-test", "messages": [{"role": "user", "content": "hi"}]}
            )
        ]
    await provider.close()
