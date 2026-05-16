from __future__ import annotations

import pytest

from llm_proxy_gateway.config.settings import ProviderConfig, ProviderType, RouteRuleConfig
from llm_proxy_gateway.routing.router import ModelRouter
from tests.conftest import FakeProvider


def test_prefix_route_strips_configured_prefix() -> None:
    config = ProviderConfig(
        name="hf",
        type=ProviderType.OPENAI_COMPATIBLE,
        base_url="https://router.huggingface.co/v1",
        model_prefixes=["hf/"],
    )
    provider = FakeProvider(config)
    router = ModelRouter(
        [RouteRuleConfig(provider="hf", prefixes=["hf/"], strip_prefix="hf/")],
        {"hf": provider},
    )

    match = router.route("hf/meta-llama/model")

    assert match.provider_name == "hf"
    assert match.routed_model == "meta-llama/model"


def test_unknown_model_raises_routing_error(fake_provider_config: ProviderConfig) -> None:
    provider = FakeProvider(fake_provider_config)
    router = ModelRouter(
        [RouteRuleConfig(provider="fake", prefixes=["fake-"])],
        {"fake": provider},
    )

    with pytest.raises(Exception, match="no provider route"):
        router.route("missing-model")
