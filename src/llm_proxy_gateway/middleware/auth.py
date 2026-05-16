from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from llm_proxy_gateway.config.settings import Settings
from llm_proxy_gateway.core.security import constant_time_match

OPEN_PATHS = {"/health", "/ready", "/openapi.json", "/docs", "/redoc"}


class GatewayAuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: Callable[..., Awaitable[None]], settings: Settings) -> None:
        super().__init__(app)
        self._settings = settings

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if not self._settings.auth_enabled or request.url.path in OPEN_PATHS:
            return await call_next(request)
        if not self._settings.gateway_api_keys:
            return await call_next(request)
        authorization = request.headers.get("authorization", "")
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token:
            return _unauthorized()
        if not constant_time_match(token, self._settings.gateway_api_keys):
            return _unauthorized()
        return await call_next(request)


def _unauthorized() -> Response:
    return Response(
        content=(
            '{"error":{"message":"authentication required",'
            '"type":"authentication_error","code":"authentication_error"}}'
        ),
        status_code=401,
        media_type="application/json",
        headers={"WWW-Authenticate": "Bearer"},
    )
