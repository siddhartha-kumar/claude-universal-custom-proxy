from __future__ import annotations

import io
import json
import logging

import pytest

from llm_proxy_gateway.config.settings import LogFormat, Settings
from llm_proxy_gateway.observability.context import (
    get_correlation_id,
    reset_correlation_id,
    set_correlation_id,
)
from llm_proxy_gateway.observability.logging import JsonFormatter, configure_logging
from llm_proxy_gateway.observability.metrics import MetricsStore, ProviderMetric


def test_json_formatter_emits_structured_payload() -> None:
    formatter = JsonFormatter()
    record = logging.LogRecord(
        name="gateway",
        level=logging.INFO,
        pathname="test",
        lineno=1,
        msg="request handled",
        args=(),
        exc_info=None,
    )
    record.method = "POST"
    record.path = "/v1/chat/completions"
    record.status_code = 200
    record.latency_ms = 12.345
    token = set_correlation_id("abc")
    try:
        output = formatter.format(record)
    finally:
        reset_correlation_id(token)

    payload = json.loads(output)
    assert payload["message"] == "request handled"
    assert payload["status_code"] == 200
    assert payload["latency_ms"] == 12.345
    assert payload["correlation_id"] == "abc"


def test_json_formatter_serializes_exceptions() -> None:
    formatter = JsonFormatter()
    try:
        raise RuntimeError("boom")
    except RuntimeError:
        import sys

        exc_info = sys.exc_info()
        record = logging.LogRecord(
            name="gateway",
            level=logging.ERROR,
            pathname="test",
            lineno=1,
            msg="failed",
            args=(),
            exc_info=exc_info,
        )

    output = formatter.format(record)
    payload = json.loads(output)
    assert payload["level"] == "ERROR"
    assert "RuntimeError" in payload["exception"]


def test_configure_logging_supports_console_format() -> None:
    settings = Settings(log_format=LogFormat.CONSOLE, log_level="DEBUG")
    configure_logging(settings)
    root = logging.getLogger()
    assert root.handlers
    formatter = root.handlers[0].formatter
    assert formatter is not None
    assert not isinstance(formatter, JsonFormatter)

    buffer = io.StringIO()
    handler = logging.StreamHandler(buffer)
    handler.setFormatter(formatter)
    record = logging.LogRecord(
        name="gateway",
        level=logging.INFO,
        pathname="test",
        lineno=1,
        msg="hello",
        args=(),
        exc_info=None,
    )
    handler.emit(record)
    assert "hello" in buffer.getvalue()


def test_correlation_context_resets() -> None:
    token = set_correlation_id("trace")
    try:
        assert get_correlation_id() == "trace"
    finally:
        reset_correlation_id(token)
    assert get_correlation_id() is None


@pytest.mark.asyncio
async def test_metrics_store_aggregates_provider_metrics() -> None:
    store = MetricsStore()
    await store.record_provider("openai", latency_ms=10.0, status_code=200, error=False)
    await store.record_provider(
        "openai", latency_ms=30.0, status_code=200, error=False, stream=True
    )
    await store.record_provider("openai", latency_ms=20.0, status_code=502, error=True)

    snapshot = await store.snapshot()

    assert snapshot["openai"]["request_count"] == 3
    assert snapshot["openai"]["error_count"] == 1
    assert snapshot["openai"]["stream_count"] == 1
    assert snapshot["openai"]["average_latency_ms"] == 20.0
    assert snapshot["openai"]["last_status_code"] == 502


def test_provider_metric_zero_division() -> None:
    metric = ProviderMetric()
    assert metric.average_latency_ms == 0.0
