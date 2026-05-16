from __future__ import annotations

from llm_proxy_gateway.config.settings import (
    ProviderConfig,
    ProviderType,
    RouteRuleConfig,
    Settings,
)
from llm_proxy_gateway.routing.registry import ModelRegistry
from tests.conftest import FakeProvider


async def test_registry_merges_static_and_dynamic_models() -> None:
    config = ProviderConfig(
        name="fake",
        type=ProviderType.OPENAI_COMPATIBLE,
        base_url="https://example.test/v1",
        static_models=["fake-static"],
    )
    settings = Settings(
        environment="test",
        providers={"fake": config},
        routes=[RouteRuleConfig(provider="fake", prefixes=["fake-"])],
    )
    registry = ModelRegistry(settings, {"fake": FakeProvider(config)})

    response = await registry.list_models()

    assert [model.id for model in response.data] == ["fake-dynamic", "fake-static"]


async def test_registry_ignores_unavailable_provider() -> None:
    config = ProviderConfig(
        name="fake",
        type=ProviderType.OPENAI_COMPATIBLE,
        base_url="https://example.test/v1",
        static_models=["fake-static"],
    )
    settings = Settings(
        environment="test",
        providers={"fake": config},
        routes=[RouteRuleConfig(provider="fake", prefixes=["fake-"])],
    )
    registry = ModelRegistry(settings, {"fake": FakeProvider(config, fail=True)})

    response = await registry.list_models()

    assert [model.id for model in response.data] == ["fake-static"]
