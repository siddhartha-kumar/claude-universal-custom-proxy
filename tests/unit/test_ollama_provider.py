from __future__ import annotations

import json

import httpx
import pytest
from pydantic import SecretStr

from llm_proxy_gateway.config.settings import ProviderConfig, ProviderType
from llm_proxy_gateway.core.errors import ProviderError, RequestValidationError
from llm_proxy_gateway.providers.ollama import OllamaProvider


async def test_ollama_provider_transforms_chat_and_models() -> None:
    seen: list[dict[str, object]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/tags":
            return httpx.Response(
                200, json={"models": [{"name": "llama3.2", "modified_at": "2026-01-01T00:00:00Z"}]}
            )
        seen.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "message": {"role": "assistant", "content": "ok"},
                "done": True,
                "prompt_eval_count": 2,
                "eval_count": 3,
            },
        )

    provider = OllamaProvider(
        ProviderConfig(
            name="ollama-local",
            type=ProviderType.OLLAMA,
            base_url="http://localhost:11434",
            allow_private_network=True,
            model_id_prefix="ollama-local/",
        )
    )
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    chat = await provider.chat_completion(
        {
            "model": "llama3.2",
            "messages": [{"role": "developer", "content": "be concise"}],
            "max_tokens": 5,
        }
    )
    models = await provider.list_models()
    await provider.close()

    assert chat["usage"]["total_tokens"] == 5
    assert seen[0]["messages"] == [{"role": "system", "content": "be concise"}]
    assert seen[0]["options"] == {"num_predict": 5}
    assert models[0].id == "ollama-local/llama3.2"


async def test_ollama_stream_outputs_openai_sse() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        body = (
            b'{"message":{"role":"assistant","content":"o"},"done":false}\n'
            b'{"message":{"role":"assistant","content":"k"},"done":true}\n'
        )
        return httpx.Response(200, content=body)

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
    chunks = [chunk async for chunk in provider.stream_chat_completion(payload)]
    await provider.close()

    output = b"".join(chunks).decode()
    assert '"content":"o"' in output
    assert '"finish_reason":"stop"' in output
    assert output.endswith("data: [DONE]\n\n")


async def test_ollama_healthcheck_missing_cloud_key() -> None:
    provider = OllamaProvider(
        ProviderConfig(
            name="ollama-cloud",
            type=ProviderType.OLLAMA,
            base_url="https://ollama.com",
            api_key_env="OLLAMA_CLOUD_API_KEY",
        )
    )

    status = await provider.healthcheck()
    await provider.close()

    assert not status.configured
    assert "OLLAMA_CLOUD_API_KEY" in status.detail


async def test_ollama_healthcheck_disabled_provider() -> None:
    provider = OllamaProvider(
        ProviderConfig(
            name="ollama-local",
            type=ProviderType.OLLAMA,
            base_url="http://localhost:11434",
            allow_private_network=True,
            enabled=False,
        )
    )

    status = await provider.healthcheck()
    await provider.close()

    assert not status.configured
    assert status.detail == "provider disabled"


async def test_ollama_healthcheck_available() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"models": []})

    provider = OllamaProvider(
        ProviderConfig(
            name="ollama-cloud",
            type=ProviderType.OLLAMA,
            base_url="https://ollama.com",
            api_key_env="OLLAMA_CLOUD_API_KEY",
            api_key=SecretStr("secret"),
        )
    )
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    status = await provider.healthcheck()
    await provider.close()

    assert status.available


async def test_ollama_healthcheck_unavailable() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "down"})

    provider = OllamaProvider(
        ProviderConfig(
            name="ollama-local",
            type=ProviderType.OLLAMA,
            base_url="http://localhost:11434",
            allow_private_network=True,
        )
    )
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    status = await provider.healthcheck()
    await provider.close()

    assert not status.available
    assert "HTTP 500" in status.detail


async def test_ollama_ignores_malformed_model_entries() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"models": [{"name": 42}, "bad", {"name": "ok"}]})

    provider = OllamaProvider(
        ProviderConfig(
            name="ollama-local",
            type=ProviderType.OLLAMA,
            base_url="http://localhost:11434",
            allow_private_network=True,
            model_id_prefix="ollama-local/",
        )
    )
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    models = await provider.list_models()
    await provider.close()

    assert [model.id for model in models] == ["ollama-local/ok"]


async def test_ollama_rejects_image_generation() -> None:
    provider = OllamaProvider(
        ProviderConfig(
            name="ollama-local",
            type=ProviderType.OLLAMA,
            base_url="http://localhost:11434",
            allow_private_network=True,
        )
    )

    with pytest.raises(RequestValidationError, match="does not support image"):
        await provider.image_generation({"model": "llama3.2", "prompt": "diagram"})
    await provider.close()


async def test_ollama_rejects_invalid_messages() -> None:
    provider = OllamaProvider(
        ProviderConfig(
            name="ollama-local",
            type=ProviderType.OLLAMA,
            base_url="http://localhost:11434",
            allow_private_network=True,
        )
    )

    with pytest.raises(RequestValidationError, match="messages must be a list"):
        await provider.chat_completion({"model": "llama3.2", "messages": "bad"})
    await provider.close()


async def test_ollama_rejects_non_object_message() -> None:
    provider = OllamaProvider(
        ProviderConfig(
            name="ollama-local",
            type=ProviderType.OLLAMA,
            base_url="http://localhost:11434",
            allow_private_network=True,
        )
    )

    with pytest.raises(RequestValidationError, match="each message must be an object"):
        await provider.chat_completion({"model": "llama3.2", "messages": ["bad"]})
    await provider.close()


async def test_ollama_maps_http_error() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "down"})

    provider = OllamaProvider(
        ProviderConfig(
            name="ollama-local",
            type=ProviderType.OLLAMA,
            base_url="http://localhost:11434",
            allow_private_network=True,
        )
    )
    provider._client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

    with pytest.raises(ProviderError, match="Ollama returned HTTP 500"):
        await provider.list_models()
    await provider.close()
