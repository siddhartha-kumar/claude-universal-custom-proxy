# Configuration Reference

Configuration starts from YAML and is then overridden by environment variables.

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
