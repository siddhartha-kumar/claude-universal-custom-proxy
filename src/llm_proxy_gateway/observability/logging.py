from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime
from typing import Any

from llm_proxy_gateway.config.settings import LogFormat, Settings
from llm_proxy_gateway.observability.context import get_correlation_id


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        correlation_id = get_correlation_id()
        if correlation_id:
            payload["correlation_id"] = correlation_id
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        for key in ("method", "path", "status_code", "latency_ms", "provider", "model"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def configure_logging(settings: Settings) -> None:
    root = logging.getLogger()
    root.handlers.clear()
    handler = logging.StreamHandler(sys.stdout)
    if settings.log_format is LogFormat.JSON:
        handler.setFormatter(JsonFormatter())
    else:
        handler.setFormatter(
            logging.Formatter(
                "%(asctime)s %(levelname)s %(name)s %(message)s",
                datefmt="%Y-%m-%dT%H:%M:%S%z",
            )
        )
    root.addHandler(handler)
    root.setLevel(settings.log_level)
