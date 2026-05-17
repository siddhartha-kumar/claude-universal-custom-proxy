# Configuration Reference

Configuration starts from YAML and is then overridden by environment variables.

## Top-level Fields

| Field | Description |
| --- | --- |
| `app_name` | Display name in `/health` and `/status` responses |
| `environment` | `development`, `test`, or `production` |
| `host`, `port` | Uvicorn bind address |
| `log_level`, `log_format` | Logging knobs (`DEBUG`/`INFO`/... and `json`/`console`) |
| `auth_enabled` | Toggles gateway bearer authentication |
| `gateway_api_keys` | List of accepted gateway keys (matched against `Authorization: Bearer` and `x-api-key`) |
| `request_timeout_seconds`, `max_request_bytes` | Per-request limits |
| `rate_limit_enabled`, `rate_limit_requests`, `rate_limit_window_seconds` | In-memory rate limiter |
| `provider_readiness_timeout_seconds` | Per-provider timeout used by `/ready` probes |
| `anthropic_default_model` | When `/v1/messages` receives a `claude-*` model id with no matching route, the gateway substitutes this id for routing. Default `ollama-cloud/gemma3:4b`. Set to `null` to return `404 model_not_found` instead. |
| `providers` | Map of provider configurations (see below) |
| `routes` | List of prefix routing rules (see below) |

## Provider Fields

| Field | Description |
| --- | --- |
| `name` | Stable provider identifier |
| `type` | `openai_compatible` or `ollama` |
| `base_url` | Upstream base URL |
| `api_key_env` | Environment variable that contains the provider secret |
| `enabled` | Enables provider construction and routing |
| `timeout_seconds` | Total upstream timeout |
| `connect_timeout_seconds` | TCP/TLS connection timeout |
| `supports_chat` | Enables chat completions |
| `supports_streaming` | Enables streaming chat completions |
| `supports_images` | Enables image generation |
| `supports_models` | Enables dynamic model discovery |
| `model_prefixes` | Client-facing model prefixes for this provider |
| `model_id_prefix` | Prefix added to discovered model IDs |
| `strip_model_prefix` | Documents provider-level prefix behavior |
| `static_models` | Models returned even when discovery is unavailable |
| `allow_private_network` | Allows private or loopback provider URL |

## Route Fields

| Field | Description |
| --- | --- |
| `provider` | Provider name |
| `prefixes` | Prefixes matched against the client model name |
| `strip_prefix` | Optional prefix removed before the upstream request |

Routes are evaluated in file order.
