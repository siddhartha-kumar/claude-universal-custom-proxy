from __future__ import annotations

from dataclasses import dataclass

from llm_proxy_gateway.config.settings import RouteRuleConfig
from llm_proxy_gateway.core.errors import RoutingError
from llm_proxy_gateway.providers.base import ProviderClient


@dataclass(frozen=True)
class RouteMatch:
    provider_name: str
    provider: ProviderClient
    original_model: str
    routed_model: str


class ModelRouter:
    def __init__(
        self,
        routes: list[RouteRuleConfig],
        providers: dict[str, ProviderClient],
    ) -> None:
        self._routes = routes
        self._providers = providers

    def route(self, model: str) -> RouteMatch:
        for rule in self._routes:
            provider = self._providers.get(rule.provider)
            if provider is None:
                continue
            for prefix in rule.prefixes:
                if model.startswith(prefix):
                    routed_model = model
                    if rule.strip_prefix:
                        routed_model = model.removeprefix(rule.strip_prefix)
                    return RouteMatch(
                        provider_name=rule.provider,
                        provider=provider,
                        original_model=model,
                        routed_model=routed_model,
                    )
        raise RoutingError(f"no provider route configured for model '{model}'")
