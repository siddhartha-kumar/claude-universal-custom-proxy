from __future__ import annotations

import httpx
from starlette.testclient import TestClient

from llm_proxy_gateway.config.settings import Settings
from llm_proxy_gateway.core.errors import ProviderError
from llm_proxy_gateway.main import create_app
from llm_proxy_gateway.providers.base import ProviderStatus
from tests.conftest import FakeProvider


async def test_chat_completion_requires_auth(settings: Settings) -> None:
    provider = FakeProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/chat/completions",
            json={"model": "fake-chat", "messages": [{"role": "user", "content": "hi"}]},
        )

    assert response.status_code == 401


async def test_chat_completion_routes_to_provider(settings: Settings) -> None:
    provider = FakeProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer test-key"},
            json={"model": "fake-chat", "messages": [{"role": "user", "content": "hi"}]},
        )

    assert response.status_code == 200
    assert response.json()["choices"][0]["message"]["content"] == "ok"
    assert provider.seen_payloads[0]["model"] == "fake-chat"


async def test_streaming_chat_completion(settings: Settings) -> None:
    provider = FakeProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with (
        httpx.AsyncClient(transport=transport, base_url="http://test") as client,
        client.stream(
            "POST",
            "/v1/chat/completions",
            headers={"Authorization": "Bearer test-key"},
            json={
                "model": "fake-chat",
                "stream": True,
                "messages": [{"role": "user", "content": "hi"}],
            },
        ) as response,
    ):
        body = await response.aread()

    assert response.status_code == 200
    assert body.endswith(b"data: [DONE]\n\n")


async def test_models_endpoint_merges_models(settings: Settings) -> None:
    provider = FakeProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/v1/models", headers={"Authorization": "Bearer test-key"})

    assert response.status_code == 200
    assert [item["id"] for item in response.json()["data"]] == ["fake-dynamic", "fake-static"]


async def test_unknown_model_returns_openai_error(settings: Settings) -> None:
    provider = FakeProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer test-key"},
            json={"model": "missing-chat", "messages": [{"role": "user", "content": "hi"}]},
        )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "model_not_found"


async def test_image_generation(settings: Settings) -> None:
    provider = FakeProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/images/generations",
            headers={"Authorization": "Bearer test-key"},
            json={"model": "fake-image", "prompt": "diagram"},
        )

    assert response.status_code == 200
    assert response.json()["data"][0]["url"] == "https://example.test/image.png"


async def test_health_ready_and_metrics(settings: Settings) -> None:
    provider = FakeProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        health = await client.get("/health")
        ready = await client.get("/ready")
        metrics = await client.get("/metrics", headers={"Authorization": "Bearer test-key"})

    assert health.status_code == 200
    assert ready.json()["status"] == "ready"
    assert metrics.json()["providers"] == {}


def test_lifespan_closes_providers(settings: Settings) -> None:
    provider = FakeProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})

    with TestClient(app) as client:
        response = client.get("/health")

    assert response.status_code == 200
    assert provider.closed


def test_unhandled_errors_are_sanitized(settings: Settings) -> None:
    provider = FakeProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("sensitive detail")

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/boom", headers={"Authorization": "Bearer test-key"})

    assert response.status_code == 500
    assert response.json()["error"]["message"] == "RuntimeError"


async def test_ready_handles_provider_health_exception(settings: Settings) -> None:
    class BrokenHealthProvider(FakeProvider):
        async def healthcheck(self) -> ProviderStatus:
            raise RuntimeError("health failed")

    provider = BrokenHealthProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/ready")

    assert response.status_code == 503
    assert response.json()["providers"][0]["detail"] == "RuntimeError"


async def test_invalid_json_returns_openai_error(settings: Settings) -> None:
    provider = FakeProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer test-key", "Content-Type": "application/json"},
            content="{",
        )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_request_error"


async def test_non_object_json_returns_validation_error(settings: Settings) -> None:
    provider = FakeProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer test-key"},
            json=[],
        )

    assert response.status_code == 400
    assert response.json()["error"]["message"] == "request body must be a JSON object"


async def test_provider_error_is_sanitized(settings: Settings) -> None:
    provider = FakeProvider(settings.providers["fake"], fail=True)
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/chat/completions",
            headers={"Authorization": "Bearer test-key"},
            json={"model": "fake-chat", "messages": [{"role": "user", "content": "hi"}]},
        )

    assert response.status_code == 503
    assert response.json()["error"]["message"] == "provider unavailable"


async def test_streaming_provider_error_emits_sse_error(settings: Settings) -> None:
    class FailingStreamProvider(FakeProvider):
        async def stream_chat_completion(self, payload):  # type: ignore[no-untyped-def]
            raise ProviderError(self.name, "stream failed", status_code=502)
            yield b""

    provider = FailingStreamProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with (
        httpx.AsyncClient(transport=transport, base_url="http://test") as client,
        client.stream(
            "POST",
            "/v1/chat/completions",
            headers={"Authorization": "Bearer test-key"},
            json={
                "model": "fake-chat",
                "stream": True,
                "messages": [{"role": "user", "content": "hi"}],
            },
        ) as response,
    ):
        body = await response.aread()

    assert response.status_code == 200
    assert b"stream failed" in body
    assert body.endswith(b"data: [DONE]\n\n")


async def test_rate_limit_blocks_excess_requests(settings: Settings) -> None:
    limited = settings.model_copy(
        update={
            "rate_limit_enabled": True,
            "rate_limit_requests": 1,
            "rate_limit_window_seconds": 60,
        }
    )
    provider = FakeProvider(limited.providers["fake"])
    app = create_app(limited, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        first = await client.get("/v1/models", headers={"Authorization": "Bearer test-key"})
        second = await client.get("/v1/models", headers={"Authorization": "Bearer test-key"})

    assert first.status_code == 200
    assert second.status_code == 429


async def test_body_limit_rejects_large_content_length(settings: Settings) -> None:
    limited = settings.model_copy(update={"max_request_bytes": 1024})
    provider = FakeProvider(limited.providers["fake"])
    app = create_app(limited, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/images/generations",
            headers={"Authorization": "Bearer test-key"},
            json={"model": "fake-image", "prompt": "x" * 2000},
        )

    assert response.status_code == 413
