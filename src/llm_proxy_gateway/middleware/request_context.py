from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from uuid import uuid4

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from llm_proxy_gateway.observability.context import reset_correlation_id, set_correlation_id

logger = logging.getLogger(__name__)


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        correlation_id = request.headers.get("x-request-id") or uuid4().hex
        token = set_correlation_id(correlation_id)
        start = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            latency_ms = (time.perf_counter() - start) * 1000
            response.headers["X-Request-ID"] = correlation_id
            response.headers["X-Response-Time-ms"] = f"{latency_ms:.3f}"
            return response
        finally:
            latency_ms = (time.perf_counter() - start) * 1000
            logger.info(
                "request completed",
                extra={
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": status_code,
                    "latency_ms": round(latency_ms, 3),
                },
            )
            reset_correlation_id(token)
