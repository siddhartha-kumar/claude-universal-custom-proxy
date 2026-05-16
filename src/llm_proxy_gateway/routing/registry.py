from __future__ import annotations

import asyncio
import logging
from collections.abc import Iterable

from llm_proxy_gateway.config.settings import Settings
from llm_proxy_gateway.models.openai import ModelCard, ModelListResponse
from llm_proxy_gateway.providers.base import ProviderClient

logger = logging.getLogger(__name__)


class ModelRegistry:
    def __init__(self, settings: Settings, providers: dict[str, ProviderClient]) -> None:
        self._settings = settings
        self._providers = providers

    async def list_models(self) -> ModelListResponse:
        models = self._static_models()
        discovered = await asyncio.gather(
            *(provider.list_models() for provider in self._providers.values()),
            return_exceptions=True,
        )
        for result in discovered:
            if isinstance(result, BaseException):
                logger.warning("model discovery failed", extra={"error": result.__class__.__name__})
                continue
            models.extend(result)
        return ModelListResponse(data=_dedupe_models(models))

    def _static_models(self) -> list[ModelCard]:
        cards: list[ModelCard] = []
        for provider_name, config in self._settings.providers.items():
            if not config.enabled:
                continue
            for model_id in config.static_models:
                exposed = model_id
                if config.model_id_prefix and not model_id.startswith(config.model_id_prefix):
                    exposed = f"{config.model_id_prefix}{model_id}"
                cards.append(ModelCard(id=exposed, owned_by=provider_name, created=0))
        return cards


def _dedupe_models(models: Iterable[ModelCard]) -> list[ModelCard]:
    seen: dict[str, ModelCard] = {}
    for model in models:
        seen.setdefault(model.id, model)
    return [seen[key] for key in sorted(seen)]
