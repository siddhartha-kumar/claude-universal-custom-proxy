from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware


class BodyLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: Callable[..., Awaitable[None]], max_bytes: int) -> None:
        super().__init__(app)
        self._max_bytes = max_bytes

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        content_length = request.headers.get("content-length")
        if content_length is not None:
            try:
                length = int(content_length)
            except ValueError:
                length = 0
            if length > self._max_bytes:
                return Response(
                    content=(
                        '{"error":{"message":"request body too large",'
                        '"type":"invalid_request_error","code":"request_too_large"}}'
                    ),
                    status_code=413,
                    media_type="application/json",
                )
        return await call_next(request)
