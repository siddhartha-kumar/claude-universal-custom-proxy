from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any


@dataclass
class ProviderMetric:
    request_count: int = 0
    error_count: int = 0
    stream_count: int = 0
    total_latency_ms: float = 0.0
    last_status_code: int | None = None

    @property
    def average_latency_ms(self) -> float:
        if self.request_count == 0:
            return 0.0
        return self.total_latency_ms / self.request_count


class MetricsStore:
    def __init__(self) -> None:
        self._providers: dict[str, ProviderMetric] = {}
        self._lock = asyncio.Lock()

    async def record_provider(
        self,
        provider: str,
        *,
        latency_ms: float,
        status_code: int | None,
        error: bool,
        stream: bool = False,
    ) -> None:
        async with self._lock:
            metric = self._providers.setdefault(provider, ProviderMetric())
            metric.request_count += 1
            metric.total_latency_ms += latency_ms
            metric.last_status_code = status_code
            if error:
                metric.error_count += 1
            if stream:
                metric.stream_count += 1

    async def snapshot(self) -> dict[str, Any]:
        async with self._lock:
            return {
                provider: {
                    "request_count": metric.request_count,
                    "error_count": metric.error_count,
                    "stream_count": metric.stream_count,
                    "average_latency_ms": round(metric.average_latency_ms, 3),
                    "last_status_code": metric.last_status_code,
                }
                for provider, metric in sorted(self._providers.items())
            }
