from __future__ import annotations

import ipaddress
import os
from enum import StrEnum
from pathlib import Path
from typing import Any, Self
from urllib.parse import urlparse

import yaml
from pydantic import BaseModel, Field, SecretStr, field_validator, model_validator


class Environment(StrEnum):
    DEVELOPMENT = "development"
    TEST = "test"
    PRODUCTION = "production"


class LogFormat(StrEnum):
    JSON = "json"
    CONSOLE = "console"


class ProviderType(StrEnum):
    OPENAI_COMPATIBLE = "openai_compatible"
    OLLAMA = "ollama"


class RetryConfig(BaseModel):
    max_attempts: int = Field(default=2, ge=1, le=5)
    backoff_seconds: float = Field(default=0.25, ge=0.0, le=10.0)
    retry_status_codes: list[int] = Field(
        default_factory=lambda: [408, 409, 425, 429, 500, 502, 503, 504]
    )


class ProviderConfig(BaseModel):
    name: str
    type: ProviderType
    base_url: str
    api_key_env: str | None = None
    api_key: SecretStr | None = None
    enabled: bool = True
    timeout_seconds: float = Field(default=60.0, gt=0.0, le=600.0)
    connect_timeout_seconds: float = Field(default=10.0, gt=0.0, le=60.0)
    supports_chat: bool = True
    supports_streaming: bool = True
    supports_images: bool = False
    supports_models: bool = True
    strip_model_prefix: bool = False
    model_id_prefix: str | None = None
    model_prefixes: list[str] = Field(default_factory=list)
    static_models: list[str] = Field(default_factory=list)
    headers: dict[str, str] = Field(default_factory=dict)
    retry: RetryConfig = Field(default_factory=RetryConfig)
    allow_private_network: bool = False

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not value or not value.replace("-", "").replace("_", "").isalnum():
            raise ValueError(
                "provider name must contain only letters, numbers, hyphen, or underscore"
            )
        return value

    @field_validator("base_url")
    @classmethod
    def validate_base_url(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise ValueError("base_url must be an absolute http or https URL")
        return value.rstrip("/")

    @model_validator(mode="after")
    def validate_network_boundary(self) -> Self:
        parsed = urlparse(self.base_url)
        host = parsed.hostname
        if host is None:
            raise ValueError("base_url must include a host")
        if self.allow_private_network:
            return self
        if host in {"localhost", "localhost.localdomain"}:
            raise ValueError(
                f"provider {self.name} uses a local host without allow_private_network"
            )
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            return self
        if address.is_private or address.is_loopback or address.is_link_local:
            raise ValueError(
                f"provider {self.name} uses a private address without allow_private_network"
            )
        return self


class RouteRuleConfig(BaseModel):
    provider: str
    prefixes: list[str]
    strip_prefix: str | None = None

    @model_validator(mode="after")
    def validate_prefixes(self) -> Self:
        if not self.prefixes:
            raise ValueError("route rule must declare at least one prefix")
        if self.strip_prefix is not None and self.strip_prefix not in self.prefixes:
            raise ValueError("strip_prefix must also be listed as a route prefix")
        return self


class Settings(BaseModel):
    app_name: str = "OpenAI Compatible LLM Gateway"
    environment: Environment = Environment.DEVELOPMENT
    host: str = "127.0.0.1"
    port: int = Field(default=8080, ge=1, le=65535)
    log_level: str = "INFO"
    log_format: LogFormat = LogFormat.JSON
    auth_enabled: bool = True
    gateway_api_keys: list[SecretStr] = Field(default_factory=list)
    request_timeout_seconds: float = Field(default=60.0, gt=0.0, le=600.0)
    max_request_bytes: int = Field(default=1_048_576, ge=1024, le=50_000_000)
    rate_limit_enabled: bool = True
    rate_limit_requests: int = Field(default=120, ge=1)
    rate_limit_window_seconds: int = Field(default=60, ge=1)
    provider_readiness_timeout_seconds: float = Field(default=2.0, gt=0.0, le=30.0)
    providers: dict[str, ProviderConfig] = Field(default_factory=dict)
    routes: list[RouteRuleConfig] = Field(default_factory=list)

    @field_validator("log_level")
    @classmethod
    def normalize_log_level(cls, value: str) -> str:
        level = value.upper()
        allowed = {"CRITICAL", "ERROR", "WARNING", "INFO", "DEBUG"}
        if level not in allowed:
            raise ValueError(f"log_level must be one of {sorted(allowed)}")
        return level

    @model_validator(mode="after")
    def validate_settings(self) -> Self:
        missing = {rule.provider for rule in self.routes if rule.provider not in self.providers}
        if missing:
            names = ", ".join(sorted(missing))
            raise ValueError(f"routes reference unknown providers: {names}")
        if self.environment is Environment.PRODUCTION:
            if not self.auth_enabled:
                raise ValueError("production requires auth_enabled=true")
            if not self.gateway_api_keys:
                raise ValueError("production requires at least one gateway API key")
        return self


def load_settings(config_path: str | Path | None = None, env_file: str | Path = ".env") -> Settings:
    dotenv = _read_dotenv(Path(env_file))
    requested_config = (
        config_path or _get_env("GATEWAY_CONFIG_FILE", dotenv) or "config/default.yaml"
    )
    data = _read_yaml(Path(requested_config))
    data = _apply_environment_overrides(data, dotenv)
    return Settings.model_validate(data)


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"configuration file not found: {path}")
    loaded = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(loaded, dict):
        raise ValueError("configuration root must be a mapping")
    return dict(loaded)


def _read_dotenv(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, raw_value = line.split("=", 1)
        value = raw_value.strip().strip('"').strip("'")
        values[key.strip()] = value
    return values


def _get_env(name: str, dotenv: dict[str, str]) -> str | None:
    return os.environ.get(name) or dotenv.get(name)


def _apply_environment_overrides(data: dict[str, Any], dotenv: dict[str, str]) -> dict[str, Any]:
    updated = dict(data)
    scalar_overrides: dict[str, tuple[str, type[object]]] = {
        "GATEWAY_ENVIRONMENT": ("environment", str),
        "GATEWAY_HOST": ("host", str),
        "GATEWAY_PORT": ("port", int),
        "GATEWAY_LOG_LEVEL": ("log_level", str),
        "GATEWAY_LOG_FORMAT": ("log_format", str),
        "GATEWAY_AUTH_ENABLED": ("auth_enabled", bool),
        "GATEWAY_REQUEST_TIMEOUT_SECONDS": ("request_timeout_seconds", float),
        "GATEWAY_MAX_REQUEST_BYTES": ("max_request_bytes", int),
        "GATEWAY_RATE_LIMIT_ENABLED": ("rate_limit_enabled", bool),
        "GATEWAY_RATE_LIMIT_REQUESTS": ("rate_limit_requests", int),
        "GATEWAY_RATE_LIMIT_WINDOW_SECONDS": ("rate_limit_window_seconds", int),
    }
    for env_name, (field_name, value_type) in scalar_overrides.items():
        raw = _get_env(env_name, dotenv)
        if raw is not None:
            updated[field_name] = _coerce_value(raw, value_type)

    raw_keys = _get_env("GATEWAY_API_KEYS", dotenv)
    if raw_keys is not None:
        updated["gateway_api_keys"] = [key for key in _csv(raw_keys) if key]

    providers = dict(updated.get("providers") or {})
    for provider_name, provider_data in providers.items():
        if not isinstance(provider_data, dict):
            continue
        provider = dict(provider_data)
        env_prefix = provider_name.upper().replace("-", "_")
        base_url = _get_env(f"{env_prefix}_BASE_URL", dotenv)
        if base_url:
            provider["base_url"] = base_url
        api_key_env = provider.get("api_key_env")
        if isinstance(api_key_env, str):
            api_key = _get_env(api_key_env, dotenv)
            if api_key:
                provider["api_key"] = api_key
        providers[provider_name] = provider
    updated["providers"] = providers
    return updated


def _csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",")]


def _coerce_value(value: str, value_type: type[object]) -> object:
    if value_type is bool:
        return value.strip().lower() in {"1", "true", "yes", "on"}
    if value_type is int:
        return int(value)
    if value_type is float:
        return float(value)
    return value
