from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from typing import Any, Protocol

from pydantic import BaseModel

from llm_proxy_gateway.config.settings import ProviderConfig
from llm_proxy_gateway.models.openai import ModelCard


class ProviderStatus(BaseModel):
    name: str
    configured: bool
    available: bool
    detail: str
    latency_ms: float | None = None


class ProviderClient(Protocol):
    name: str
    config: ProviderConfig

    async def chat_completion(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    def stream_chat_completion(self, payload: Mapping[str, Any]) -> AsyncIterator[bytes]:
        raise NotImplementedError

    async def image_generation(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        raise NotImplementedError

    async def list_models(self) -> list[ModelCard]:
        raise NotImplementedError

    async def healthcheck(self) -> ProviderStatus:
        raise NotImplementedError

    async def close(self) -> None:
        raise NotImplementedError
