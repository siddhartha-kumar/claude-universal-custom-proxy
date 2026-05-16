from __future__ import annotations

import httpx
from pydantic import SecretStr
from starlette.testclient import TestClient

from llm_proxy_gateway.config.settings import (
    ProviderConfig,
    ProviderType,
    RouteRuleConfig,
    Settings,
)
from llm_proxy_gateway.main import create_app
from tests.conftest import FakeProvider


def _settings_with_auth(
    *, auth_enabled: bool = True, api_keys: list[str] | None = None
) -> Settings:
    fake = ProviderConfig(
        name="fake",
        type=ProviderType.OPENAI_COMPATIBLE,
        base_url="https://example.test/v1",
        supports_images=True,
        supports_models=True,
        model_prefixes=["fake-"],
    )
    keys = [SecretStr(key) for key in (api_keys or ["test-key"])]
    return Settings(
        environment="test",
        auth_enabled=auth_enabled,
        gateway_api_keys=keys,
        rate_limit_enabled=False,
        providers={"fake": fake},
        routes=[RouteRuleConfig(provider="fake", prefixes=["fake-"])],
    )


async def test_auth_middleware_allows_open_paths() -> None:
    settings = _settings_with_auth()
    provider = FakeProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200


async def test_auth_middleware_skips_when_no_keys_configured() -> None:
    settings = _settings_with_auth(api_keys=[])
    settings = settings.model_copy(update={"gateway_api_keys": []})
    provider = FakeProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/v1/models")

    assert response.status_code == 200


async def test_auth_middleware_skips_when_disabled() -> None:
    settings = _settings_with_auth(auth_enabled=False)
    provider = FakeProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/v1/models")

    assert response.status_code == 200


async def test_auth_middleware_rejects_invalid_scheme() -> None:
    settings = _settings_with_auth()
    provider = FakeProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/v1/models",
            headers={"Authorization": "Basic test-key"},
        )

    assert response.status_code == 401


async def test_auth_middleware_rejects_bad_token() -> None:
    settings = _settings_with_auth()
    provider = FakeProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/v1/models",
            headers={"Authorization": "Bearer wrong-key"},
        )

    assert response.status_code == 401


async def test_body_limit_middleware_ignores_invalid_content_length() -> None:
    settings = _settings_with_auth()
    settings = settings.model_copy(update={"max_request_bytes": 1024})
    provider = FakeProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/v1/chat/completions",
            headers={
                "Authorization": "Bearer test-key",
                "Content-Length": "not-a-number",
            },
            json={"model": "fake-chat", "messages": [{"role": "user", "content": "hi"}]},
        )

    assert response.status_code == 200


async def test_rate_limit_buckets_by_client_host() -> None:
    settings = _settings_with_auth()
    settings = settings.model_copy(
        update={
            "rate_limit_enabled": True,
            "rate_limit_requests": 1,
            "rate_limit_window_seconds": 60,
            "auth_enabled": False,
        }
    )
    provider = FakeProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})

    with TestClient(app) as client:
        first = client.get("/v1/models")
        second = client.get("/v1/models")

    assert first.status_code == 200
    assert second.status_code == 429
    assert second.headers["Retry-After"] == "60"


async def test_security_headers_applied() -> None:
    settings = _settings_with_auth()
    provider = FakeProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Referrer-Policy"] == "no-referrer"
    assert "geolocation=()" in response.headers["Permissions-Policy"]
    assert response.headers["Cache-Control"] == "no-store"


async def test_correlation_id_is_echoed() -> None:
    settings = _settings_with_auth()
    provider = FakeProvider(settings.providers["fake"])
    app = create_app(settings, {"fake": provider})
    transport = httpx.ASGITransport(app=app)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(
            "/health",
            headers={"x-request-id": "trace-12345"},
        )

    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "trace-12345"
    assert "X-Response-Time-ms" in response.headers
