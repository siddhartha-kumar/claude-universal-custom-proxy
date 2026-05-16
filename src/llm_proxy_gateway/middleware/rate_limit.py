from __future__ import annotations

import time
from collections import defaultdict, deque
from collections.abc import Awaitable, Callable
from hashlib import sha256

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from llm_proxy_gateway.config.settings import Settings

OPEN_PATHS = {"/health", "/ready"}


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: Callable[..., Awaitable[None]], settings: Settings) -> None:
        super().__init__(app)
        self._settings = settings
        self._buckets: dict[str, deque[float]] = defaultdict(deque)

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        if not self._settings.rate_limit_enabled or request.url.path in OPEN_PATHS:
            return await call_next(request)
        key = _client_key(request)
        now = time.monotonic()
        bucket = self._buckets[key]
        window = self._settings.rate_limit_window_seconds
        while bucket and now - bucket[0] > window:
            bucket.popleft()
        if len(bucket) >= self._settings.rate_limit_requests:
            return Response(
                content=(
                    '{"error":{"message":"rate limit exceeded",'
                    '"type":"rate_limit_exceeded","code":"rate_limit_exceeded"}}'
                ),
                status_code=429,
                media_type="application/json",
                headers={"Retry-After": str(window)},
            )
        bucket.append(now)
        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(self._settings.rate_limit_requests)
        response.headers["X-RateLimit-Remaining"] = str(
            max(0, self._settings.rate_limit_requests - len(bucket))
        )
        return response


def _client_key(request: Request) -> str:
    authorization = request.headers.get("authorization")
    if authorization:
        return sha256(authorization.encode()).hexdigest()
    if request.client is not None:
        return request.client.host
    return "unknown"
