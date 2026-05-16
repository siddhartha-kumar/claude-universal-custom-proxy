from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator, Mapping
from datetime import datetime
from time import time
from typing import Any
from uuid import uuid4

import httpx

from llm_proxy_gateway.config.settings import ProviderConfig
from llm_proxy_gateway.core.errors import ProviderError, RequestValidationError
from llm_proxy_gateway.core.http import join_url
from llm_proxy_gateway.models.openai import ModelCard
from llm_proxy_gateway.providers.base import ProviderStatus

logger = logging.getLogger(__name__)


class OllamaProvider:
    def __init__(self, config: ProviderConfig) -> None:
        self.name = config.name
        self.config = config
        timeout = httpx.Timeout(
            timeout=config.timeout_seconds,
            connect=config.connect_timeout_seconds,
        )
        self._client = httpx.AsyncClient(timeout=timeout, follow_redirects=False)

    async def chat_completion(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        request = self._to_ollama_request(payload, stream=False)
        data = await self._request_json("POST", "/api/chat", json=request)
        return self._to_openai_completion(data, str(payload["model"]))

    async def image_generation(self, payload: Mapping[str, Any]) -> dict[str, Any]:
        raise RequestValidationError(f"provider {self.name} does not support image generation")

    async def list_models(self) -> list[ModelCard]:
        data = await self._request_json("GET", "/api/tags")
        raw_models = data.get("models", [])
        if not isinstance(raw_models, list):
            return []
        models: list[ModelCard] = []
        for item in raw_models:
            if not isinstance(item, dict):
                continue
            name = item.get("name")
            if not isinstance(name, str):
                continue
            created = _timestamp(item.get("modified_at"))
            models.append(
                ModelCard(
                    id=self._expose_model_id(name),
                    created=created,
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
        start = time()
        try:
            await self._request_json("GET", "/api/tags", attempts=1)
        except ProviderError as exc:
            return ProviderStatus(
                name=self.name,
                configured=True,
                available=False,
                detail=exc.message,
                latency_ms=round((time() - start) * 1000, 3),
            )
        return ProviderStatus(
            name=self.name,
            configured=True,
            available=True,
            detail="available",
            latency_ms=round((time() - start) * 1000, 3),
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
        last_error: ProviderError | None = None
        for attempt in range(1, max_attempts + 1):
            try:
                response = await self._client.request(
                    method,
                    join_url(self.config.base_url, path),
                    json=json,
                    headers=self._headers(),
                )
            except httpx.TimeoutException:
                last_error = ProviderError(self.name, "Ollama request timed out", status_code=504)
            except httpx.HTTPError:
                last_error = ProviderError(self.name, "Ollama request failed")
            else:
                if response.status_code < 400:
                    data = response.json()
                    if not isinstance(data, dict):
                        raise ProviderError(self.name, "Ollama returned non-object JSON")
                    return data
                last_error = ProviderError(
                    self.name,
                    f"Ollama returned HTTP {response.status_code}",
                    status_code=502,
                    upstream_status_code=response.status_code,
                )
                if response.status_code not in self.config.retry.retry_status_codes:
                    break
            if attempt < max_attempts:
                await asyncio.sleep(self.config.retry.backoff_seconds * attempt)
        if last_error is not None:
            raise last_error
        raise ProviderError(self.name, "Ollama request failed")

    async def stream_chat_completion(self, payload: Mapping[str, Any]) -> AsyncIterator[bytes]:
        request_payload = self._to_ollama_request(payload, stream=True)
        request = self._client.build_request(
            "POST",
            join_url(self.config.base_url, "/api/chat"),
            json=request_payload,
            headers=self._headers(),
        )
        response: httpx.Response | None = None
        stream_id = f"chatcmpl-{uuid4().hex}"
        created = int(time())
        model = str(payload["model"])
        try:
            response = await self._client.send(request, stream=True)
            if response.status_code >= 400:
                body = await response.aread()
                raise ProviderError(
                    self.name,
                    body.decode("utf-8", errors="replace")[:500],
                    status_code=502,
                    upstream_status_code=response.status_code,
                )
            async for line in response.aiter_lines():
                if not line:
                    continue
                chunk = json.loads(line)
                if not isinstance(chunk, dict):
                    continue
                message = chunk.get("message")
                content = ""
                if isinstance(message, dict) and isinstance(message.get("content"), str):
                    content = message["content"]
                done = chunk.get("done") is True
                if content:
                    yield _sse(
                        {
                            "id": stream_id,
                            "object": "chat.completion.chunk",
                            "created": created,
                            "model": model,
                            "choices": [
                                {
                                    "index": 0,
                                    "delta": {"content": content},
                                    "finish_reason": None,
                                }
                            ],
                        }
                    )
                if done:
                    yield _sse(
                        {
                            "id": stream_id,
                            "object": "chat.completion.chunk",
                            "created": created,
                            "model": model,
                            "choices": [
                                {"index": 0, "delta": {}, "finish_reason": "stop"},
                            ],
                        }
                    )
                    yield b"data: [DONE]\n\n"
        except asyncio.CancelledError:
            logger.info("Ollama stream cancelled", extra={"provider": self.name})
            raise
        except httpx.TimeoutException as exc:
            raise ProviderError(self.name, "Ollama stream timed out", status_code=504) from exc
        except httpx.HTTPError as exc:
            raise ProviderError(self.name, "Ollama stream failed") from exc
        finally:
            if response is not None:
                await response.aclose()

    def _to_ollama_request(self, payload: Mapping[str, Any], *, stream: bool) -> dict[str, Any]:
        messages = payload.get("messages")
        if not isinstance(messages, list):
            raise RequestValidationError("messages must be a list")
        request: dict[str, Any] = {
            "model": str(payload["model"]),
            "messages": [_normalize_message(message) for message in messages],
            "stream": stream,
        }
        options: dict[str, Any] = {}
        for source, target in (
            ("temperature", "temperature"),
            ("top_p", "top_p"),
            ("max_tokens", "num_predict"),
        ):
            value = payload.get(source)
            if value is not None:
                options[target] = value
        if options:
            request["options"] = options
        response_format = payload.get("response_format")
        if isinstance(response_format, dict) and response_format.get("type") == "json_object":
            request["format"] = "json"
        tools = payload.get("tools")
        if isinstance(tools, list):
            request["tools"] = tools
        return request

    def _to_openai_completion(self, data: Mapping[str, Any], model: str) -> dict[str, Any]:
        message = data.get("message")
        role = "assistant"
        content = ""
        if isinstance(message, dict):
            role_value = message.get("role")
            content_value = message.get("content")
            if isinstance(role_value, str):
                role = role_value
            if isinstance(content_value, str):
                content = content_value
        return {
            "id": f"chatcmpl-{uuid4().hex}",
            "object": "chat.completion",
            "created": int(time()),
            "model": model,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": role, "content": content},
                    "finish_reason": "stop" if data.get("done") is True else None,
                }
            ],
            "usage": {
                "prompt_tokens": _int_or_zero(data.get("prompt_eval_count")),
                "completion_tokens": _int_or_zero(data.get("eval_count")),
                "total_tokens": _int_or_zero(data.get("prompt_eval_count"))
                + _int_or_zero(data.get("eval_count")),
            },
        }

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


def _normalize_message(message: Any) -> dict[str, Any]:
    if not isinstance(message, Mapping):
        raise RequestValidationError("each message must be an object")
    normalized = dict(message)
    role = normalized.get("role")
    if role == "developer":
        normalized["role"] = "system"
    return normalized


def _timestamp(value: Any) -> int:
    if not isinstance(value, str):
        return 0
    try:
        return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
    except ValueError:
        return 0


def _int_or_zero(value: Any) -> int:
    return value if isinstance(value, int) else 0


def _sse(payload: Mapping[str, Any]) -> bytes:
    return f"data: {json.dumps(payload, separators=(',', ':'))}\n\n".encode()
