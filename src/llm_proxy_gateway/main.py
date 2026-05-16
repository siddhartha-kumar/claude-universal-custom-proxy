from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from llm_proxy_gateway.api.routes import router
from llm_proxy_gateway.config.settings import Settings, load_settings
from llm_proxy_gateway.core.errors import GatewayError
from llm_proxy_gateway.middleware import (
    BodyLimitMiddleware,
    GatewayAuthMiddleware,
    RateLimitMiddleware,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
)
from llm_proxy_gateway.observability.logging import configure_logging
from llm_proxy_gateway.observability.metrics import MetricsStore
from llm_proxy_gateway.providers.base import ProviderClient
from llm_proxy_gateway.providers.factory import build_providers
from llm_proxy_gateway.routing.router import ModelRouter

logger = logging.getLogger(__name__)


def create_app(
    settings: Settings | None = None,
    providers: dict[str, ProviderClient] | None = None,
) -> FastAPI:
    resolved_settings = settings or load_settings()
    configure_logging(resolved_settings)
    resolved_providers = providers or build_providers(resolved_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        logger.info("gateway starting")
        yield
        for provider in app.state.providers.values():
            await provider.close()
        logger.info("gateway stopped")

    app = FastAPI(
        title=resolved_settings.app_name,
        version="0.1.0",
        docs_url="/docs",
        redoc_url="/redoc",
        lifespan=lifespan,
    )
    app.state.settings = resolved_settings
    app.state.providers = resolved_providers
    app.state.model_router = ModelRouter(resolved_settings.routes, resolved_providers)
    app.state.metrics = MetricsStore()

    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(GatewayAuthMiddleware, settings=resolved_settings)
    app.add_middleware(RateLimitMiddleware, settings=resolved_settings)
    app.add_middleware(BodyLimitMiddleware, max_bytes=resolved_settings.max_request_bytes)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["*"])

    app.include_router(router)
    app.add_exception_handler(GatewayError, _gateway_error_handler)
    app.add_exception_handler(Exception, _unhandled_error_handler)
    return app


async def _gateway_error_handler(request: Request, exc: Exception) -> JSONResponse:
    if not isinstance(exc, GatewayError):
        return await _unhandled_error_handler(request, exc)
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "message": exc.message,
                "type": exc.code,
                "code": exc.code,
            }
        },
    )


async def _unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    settings = request.app.state.settings
    logger.exception("unhandled request error")
    message = "internal server error"
    if getattr(settings, "environment", None) and settings.environment.value != "production":
        message = exc.__class__.__name__
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "message": message,
                "type": "internal_error",
                "code": "internal_error",
            }
        },
    )


def run() -> None:
    settings = load_settings()
    uvicorn.run(
        "llm_proxy_gateway.main:app",
        host=settings.host,
        port=settings.port,
        log_config=None,
        factory=False,
    )


app = create_app()
