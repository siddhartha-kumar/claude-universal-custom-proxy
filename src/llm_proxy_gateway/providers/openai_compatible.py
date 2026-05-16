from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Mapping
from time import monotonic
from typing import Any

import httpx

from llm_proxy_gateway.config.settings import ProviderConfig
from llm_proxy_gateway.core.errors import ProviderError, RequestValidationError
from llm_proxy_gateway.core.http import join_url
from llm_proxy_gateway.models.openai import ModelCard
from llm_proxy_gateway.providers.base import ProviderStatus

logger = logging.getLogger(__name__)


class OpenAICompatibleProvider:
    def __init__(self, config: ProviderConfig) -> None:
        self.name = config.name
        self.config = config
        timeout = httpx.Timeout(
            timeout=config.timeout_seconds,
            connect=config.connect_timeout_seconds,
        )
        self._client = httpx.AsyncClient(timeout=timeout, follow_redirects=False)

    async def chat_completion(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not self.config.supports_chat:
            raise RequestValidationError(f"provider {self.name} does not support chat completions")
        request_payload = dict(payload)
        request_payload["stream"] = False
        return await self._request_json("POST", "/chat/completions", json=request_payload)

    async def image_generation(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        if not self.config.supports_images:
            raise RequestValidationError(f"provider {self.name} does not support image generation")
        return await self._request_json("POST", "/images/generations", json=dict(payload))

    async def list_models(self) -> list[ModelCard]:
        if not self.config.supports_models:
            return []
        data = await self._request_json("GET", "/models")
        raw_models = data.get("data", [])
        if not isinstance(raw_models, list):
            return []
        models: list[ModelCard] = []
        for item in raw_models:
            if not isinstance(item, dict):
                continue
            model_id = item.get("id")
            if not isinstance(model_id, str):
                continue
            exposed_id = self._expose_model_id(model_id)
            created = item.get("created")
            models.append(
                ModelCard(
                    id=exposed_id,
                    created=created if isinstance(created, int) else 0,
                    owned_by=self.name,
                )
            )
        return models

    async def healthcheck(self) -> ProviderStatus:
        if not self.config.enabled:
            return ProviderStatus(
                name=self.name,
                configured=False,
                available=False,
                detail="provider disabled",
            )
        if self.config.api_key_env and self.config.api_key is None:
            return ProviderStatus(
                name=self.name,
                configured=False,
                available=False,
                detail=f"missing {self.config.api_key_env}",
            )
        if not self.config.supports_models:
            return ProviderStatus(
                name=self.name, configured=True, available=True, detail="configured"
            )
        start = monotonic()
        try:
            await self._request_json("GET", "/models", attempts=1)
        except ProviderError as exc:
            return ProviderStatus(
                name=self.name,
                configured=True,
                available=False,
                detail=exc.message,
                latency_ms=round((monotonic() - start) * 1000, 3),
            )
        return ProviderStatus(
            name=self.name,
            configured=True,
            available=True,
            detail="available",
            latency_ms=round((monotonic() - start) * 1000, 3),
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def _request_json(
        self,
        method: str,
        path: str,
        *,
        json: Mapping[str, Any] | None = None,
        attempts: int | None = None,
    ) -> dict[str, Any]:
        max_attempts = attempts or self.config.retry.max_attempts
        url = join_url(self.config.base_url, path)
        last_error: ProviderError | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                response = await self._client.request(
                    method,
                    url,
                    json=json,
                    headers=self._headers(),
                )
            except httpx.TimeoutException:
                last_error = ProviderError(
                    self.name, "upstream provider timed out", status_code=504
                )
                logger.warning("provider timeout", extra={"provider": self.name})
            except httpx.HTTPError as exc:
                last_error = ProviderError(self.name, "upstream provider request failed")
                logger.warning(
                    "provider request failed",
                    extra={"provider": self.name, "error": exc.__class__.__name__},
                )
            else:
                if response.status_code < 400:
                    payload = response.json()
                    if not isinstance(payload, dict):
                        raise ProviderError(self.name, "upstream provider returned non-object JSON")
                    return payload
                last_error = ProviderError(
                    self.name,
                    self._safe_error_message(response),
                    status_code=_map_status(response.status_code),
                    upstream_status_code=response.status_code,
                )
                if response.status_code not in self.config.retry.retry_status_codes:
                    break
            if attempt < max_attempts:
                await asyncio.sleep(self.config.retry.backoff_seconds * attempt)
        if last_error is not None:
            raise last_error
        raise ProviderError(self.name, "upstream provider request failed")

    async def stream_chat_completion(self, payload: Mapping[str, Any]) -> AsyncIterator[bytes]:
        if not self.config.supports_streaming:
            raise RequestValidationError(f"provider {self.name} does not support streaming")
        request_payload = dict(payload)
        request_payload["stream"] = True
        url = join_url(self.config.base_url, "/chat/completions")
        request = self._client.build_request(
            "POST",
            url,
            json=request_payload,
            headers=self._headers(),
        )
        response: httpx.Response | None = None
        try:
            response = await self._client.send(request, stream=True)
            if response.status_code >= 400:
                body = await response.aread()
                raise ProviderError(
                    self.name,
                    _truncate(body.decode("utf-8", errors="replace")),
                    status_code=_map_status(response.status_code),
                    upstream_status_code=response.status_code,
                )
            async for chunk in response.aiter_bytes():
                if chunk:
                    yield chunk
        except asyncio.CancelledError:
            logger.info("stream cancelled", extra={"provider": self.name})
            raise
        except httpx.TimeoutException as exc:
            raise ProviderError(
                self.name, "upstream provider stream timed out", status_code=504
            ) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(self.name, "upstream provider stream failed") from exc
        finally:
            if response is not None:
                await response.aclose()

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": "application/json", "Content-Type": "application/json"}
        headers.update(self.config.headers)
        if self.config.api_key is not None:
            headers["Authorization"] = f"Bearer {self.config.api_key.get_secret_value()}"
        return headers

    def _expose_model_id(self, model_id: str) -> str:
        prefix = self.config.model_id_prefix
        if prefix and not model_id.startswith(prefix):
            return f"{prefix}{model_id}"
        return model_id

    def _safe_error_message(self, response: httpx.Response) -> str:
        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            try:
                data = response.json()
            except ValueError:
                return f"upstream provider returned HTTP {response.status_code}"
            if isinstance(data, dict):
                error = data.get("error")
                if isinstance(error, dict):
                    message = error.get("message")
                    if isinstance(message, str):
                        return _truncate(message)
                message = data.get("message")
                if isinstance(message, str):
                    return _truncate(message)
        return f"upstream provider returned HTTP {response.status_code}"


def _map_status(status_code: int) -> int:
    if status_code in {400, 401, 403, 404, 408, 409, 422, 429}:
        return status_code
    if status_code == 504:
        return 504
    return 502


def _truncate(value: str, limit: int = 500) -> str:
    return value if len(value) <= limit else f"{value[:limit]}..."
