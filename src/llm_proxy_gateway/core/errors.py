from __future__ import annotations

from typing import Any


class GatewayError(Exception):
    def __init__(
        self,
        message: str,
        *,
        status_code: int = 500,
        code: str = "gateway_error",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.details = details or {}


class AuthenticationError(GatewayError):
    def __init__(self, message: str = "authentication required") -> None:
        super().__init__(message, status_code=401, code="authentication_error")


class RateLimitError(GatewayError):
    def __init__(self, message: str = "rate limit exceeded") -> None:
        super().__init__(message, status_code=429, code="rate_limit_exceeded")


class RequestValidationError(GatewayError):
    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message, status_code=status_code, code="invalid_request_error")


class RoutingError(GatewayError):
    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=404, code="model_not_found")


class ProviderError(GatewayError):
    def __init__(
        self,
        provider: str,
        message: str,
        *,
        status_code: int = 502,
        upstream_status_code: int | None = None,
    ) -> None:
        super().__init__(
            message,
            status_code=status_code,
            code="provider_error",
            details={"provider": provider, "upstream_status_code": upstream_status_code},
        )
        self.provider = provider
        self.upstream_status_code = upstream_status_code
