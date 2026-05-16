from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator, Mapping
from typing import Any, cast

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from pydantic import ValidationError

from llm_proxy_gateway.config.settings import Settings
from llm_proxy_gateway.core.errors import GatewayError, ProviderError, RequestValidationError
from llm_proxy_gateway.models.openai import ChatCompletionRequest, ImageGenerationRequest
from llm_proxy_gateway.observability.metrics import MetricsStore
from llm_proxy_gateway.providers.base import ProviderClient, ProviderStatus
from llm_proxy_gateway.routing.registry import ModelRegistry
from llm_proxy_gateway.routing.router import ModelRouter

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/health")
async def health(request: Request) -> dict[str, Any]:
    settings = _settings(request)
    metrics = await _metrics(request).snapshot()
    return {
        "status": "ok",
        "service": settings.app_name,
        "environment": settings.environment.value,
        "metrics": metrics,
    }


@router.get("/ready")
async def ready(request: Request) -> JSONResponse:
    settings = _settings(request)
    providers = _providers(request)
    statuses = await asyncio.gather(
        *(
            asyncio.wait_for(
                provider.healthcheck(),
                timeout=settings.provider_readiness_timeout_seconds,
            )
            for provider in providers.values()
        ),
        return_exceptions=True,
    )
    provider_statuses: list[dict[str, Any]] = []
    available = False
    for status in statuses:
        if isinstance(status, ProviderStatus):
            provider_statuses.append(status.model_dump())
            available = available or status.available or not status.configured
        else:
            provider_statuses.append(
                {
                    "name": "unknown",
                    "configured": True,
                    "available": False,
                    "detail": status.__class__.__name__,
                    "latency_ms": None,
                }
            )
    status_code = 200 if available or not providers else 503
    return JSONResponse(
        {
            "status": "ready" if status_code == 200 else "not_ready",
            "providers": provider_statuses,
        },
        status_code=status_code,
    )


@router.get("/metrics")
async def metrics(request: Request) -> dict[str, Any]:
    return {"providers": await _metrics(request).snapshot()}


@router.get("/v1/models")
async def list_models(request: Request) -> dict[str, Any]:
    registry = ModelRegistry(_settings(request), _providers(request))
    return (await registry.list_models()).model_dump()


@router.post("/v1/chat/completions", response_model=None)
async def chat_completions(request: Request) -> Response:
    payload = await _json_body(request)
    try:
        chat_request = ChatCompletionRequest.model_validate(payload)
    except ValidationError as exc:
        raise RequestValidationError(_validation_message(exc)) from exc
    match = _model_router(request).route(chat_request.model)
    provider_payload = dict(payload)
    provider_payload["model"] = match.routed_model
    if chat_request.stream:
        stream = _stream_with_metrics(
            provider=match.provider,
            provider_name=match.provider_name,
            payload=provider_payload,
            metrics=_metrics(request),
        )
        return StreamingResponse(
            stream,
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    start = time.perf_counter()
    error = False
    status_code = 200
    try:
        result = await match.provider.chat_completion(provider_payload)
    except GatewayError as exc:
        error = True
        status_code = exc.status_code
        raise
    finally:
        await _metrics(request).record_provider(
            match.provider_name,
            latency_ms=(time.perf_counter() - start) * 1000,
            status_code=status_code,
            error=error,
        )
    return JSONResponse(result)


@router.post("/v1/images/generations")
async def image_generations(request: Request) -> JSONResponse:
    payload = await _json_body(request)
    try:
        image_request = ImageGenerationRequest.model_validate(payload)
    except ValidationError as exc:
        raise RequestValidationError(_validation_message(exc)) from exc
    match = _model_router(request).route(image_request.model)
    provider_payload = dict(payload)
    provider_payload["model"] = match.routed_model
    start = time.perf_counter()
    error = False
    status_code = 200
    try:
        result = await match.provider.image_generation(provider_payload)
    except GatewayError as exc:
        error = True
        status_code = exc.status_code
        raise
    finally:
        await _metrics(request).record_provider(
            match.provider_name,
            latency_ms=(time.perf_counter() - start) * 1000,
            status_code=status_code,
            error=error,
        )
    return JSONResponse(result)


async def _json_body(request: Request) -> dict[str, Any]:
    try:
        payload = await request.json()
    except json.JSONDecodeError as exc:
        raise RequestValidationError("request body must be valid JSON") from exc
    if not isinstance(payload, dict):
        raise RequestValidationError("request body must be a JSON object")
    return payload


async def _stream_with_metrics(
    *,
    provider: ProviderClient,
    provider_name: str,
    payload: Mapping[str, Any],
    metrics: MetricsStore,
) -> AsyncIterator[bytes]:
    start = time.perf_counter()
    status_code = 200
    error = False
    try:
        async for chunk in provider.stream_chat_completion(payload):
            yield chunk
    except ProviderError as exc:
        error = True
        status_code = exc.status_code
        logger.warning("stream provider error", extra={"provider": provider_name})
        yield _sse_error(exc)
    except asyncio.CancelledError:
        error = True
        status_code = 499
        raise
    finally:
        await metrics.record_provider(
            provider_name,
            latency_ms=(time.perf_counter() - start) * 1000,
            status_code=status_code,
            error=error,
            stream=True,
        )


def _sse_error(exc: ProviderError) -> bytes:
    payload = {
        "error": {
            "message": exc.message,
            "type": exc.code,
            "code": exc.code,
            "provider": exc.provider,
        }
    }
    return f"data: {json.dumps(payload, separators=(',', ':'))}\n\ndata: [DONE]\n\n".encode()


def _validation_message(exc: ValidationError) -> str:
    first = exc.errors()[0]
    loc = ".".join(str(part) for part in first.get("loc", ()))
    message = str(first.get("msg", "validation error"))
    if loc:
        return f"{loc}: {message}"
    return message


def _settings(request: Request) -> Settings:
    return cast(Settings, request.app.state.settings)


def _providers(request: Request) -> dict[str, ProviderClient]:
    return cast(dict[str, ProviderClient], request.app.state.providers)


def _model_router(request: Request) -> ModelRouter:
    return cast(ModelRouter, request.app.state.model_router)


def _metrics(request: Request) -> MetricsStore:
    return cast(MetricsStore, request.app.state.metrics)
