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
        token = _extract_token(request)
        if not token:
            return _unauthorized()
        if not constant_time_match(token, self._settings.gateway_api_keys):
            return _unauthorized()
        return await call_next(request)


def _extract_token(request: Request) -> str | None:
    """Return the bearer token from either of the two supported headers.

    Accept ``Authorization: Bearer <token>`` (the OpenAI convention) and
    ``x-api-key: <token>`` (Anthropic's native scheme). The latter lets
    Claude Code, Claude Desktop, and any Anthropic SDK authenticate
    without translation.
    """
    authorization = request.headers.get("authorization")
    if authorization:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() == "bearer" and token:
            return token.strip()
    api_key = request.headers.get("x-api-key")
    if api_key:
        return api_key.strip()
    return None


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
