# Environment Variable Reference

## Gateway behaviour

| Variable | Purpose |
| --- | --- |
| `GATEWAY_ENVIRONMENT` | `development`, `test`, or `production` |
| `GATEWAY_HOST` | Uvicorn host when using the package runner |
| `GATEWAY_PORT` | Uvicorn port when using the package runner |
| `GATEWAY_LOG_LEVEL` | `DEBUG`, `INFO`, `WARNING`, `ERROR`, or `CRITICAL` |
| `GATEWAY_LOG_FORMAT` | `json` or `console` |
| `GATEWAY_AUTH_ENABLED` | Enables bearer-token gateway authentication |
| `GATEWAY_API_KEYS` | Comma-separated gateway API keys accepted from clients (matched against `Authorization: Bearer` and `x-api-key`) |
| `GATEWAY_CONFIG_FILE` | YAML configuration path |
| `GATEWAY_REQUEST_TIMEOUT_SECONDS` | Default upstream request timeout |
| `GATEWAY_MAX_REQUEST_BYTES` | Maximum accepted request body size |
| `GATEWAY_RATE_LIMIT_ENABLED` | Enables in-memory rate limiting |
| `GATEWAY_RATE_LIMIT_REQUESTS` | Requests per window |
| `GATEWAY_RATE_LIMIT_WINDOW_SECONDS` | Rate limit window length |
| `GATEWAY_ANTHROPIC_DEFAULT_MODEL` | When `/v1/messages` receives a `claude-*` model id with no matching route, the gateway substitutes this routed model id. Default `hf/meta-llama/Llama-3.1-8B-Instruct` (works well with Claude Code's tool prompt). Leave blank to return `404 model_not_found` instead. |

## Provider credentials (upstream)

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI upstream credential |
| `DEEPSEEK_API_KEY` | DeepSeek upstream credential |
| `PERPLEXITY_API_KEY` | Perplexity upstream credential |
| `KIMI_API_KEY` | Kimi upstream credential |
| `ZAI_API_KEY` | Z.AI upstream credential |
| `HF_TOKEN` | Hugging Face Router token |
| `OLLAMA_CLOUD_API_KEY` | Ollama cloud credential |
| `OLLAMA_LOCAL_BASE_URL` | Override local Ollama base URL |
| `OLLAMA_CLOUD_BASE_URL` | Override Ollama cloud base URL |

## Client-side variables (set on whichever client is calling the gateway)

These are **not** read by the gateway. They are read by client tools you
point at the gateway.

| Variable | Read by |
| --- | --- |
| `ANTHROPIC_BASE_URL` | Claude Code, Claude Desktop, Anthropic SDK — base URL (no `/v1` suffix). |
| `ANTHROPIC_API_KEY` | Claude Code, Claude Desktop, Anthropic SDK — sent as `x-api-key`. |
| `OPENAI_COMPATIBLE_BASE_URL` | Continue, Cline, Cursor, LM Studio, LiteLLM, OpenAI SDK — base URL with `/v1` suffix. |
| `OPENAI_COMPATIBLE_API_KEY` | Same OpenAI-compatible clients — sent as `Authorization: Bearer`. |
| `OPENAI_COMPATIBLE_MODEL` | Same OpenAI-compatible clients — routed model id. |

Environment variables override the YAML file for scalar gateway settings,
provider base URLs, and provider secrets.
