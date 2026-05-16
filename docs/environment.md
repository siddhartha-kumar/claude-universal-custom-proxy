# Environment Variable Reference

| Variable | Purpose |
| --- | --- |
| `GATEWAY_ENVIRONMENT` | `development`, `test`, or `production` |
| `GATEWAY_HOST` | Uvicorn host when using the package runner |
| `GATEWAY_PORT` | Uvicorn port when using the package runner |
| `GATEWAY_LOG_LEVEL` | `DEBUG`, `INFO`, `WARNING`, `ERROR`, or `CRITICAL` |
| `GATEWAY_LOG_FORMAT` | `json` or `console` |
| `GATEWAY_AUTH_ENABLED` | Enables bearer-token gateway authentication |
| `GATEWAY_API_KEYS` | Comma-separated gateway API keys accepted from clients |
| `GATEWAY_CONFIG_FILE` | YAML configuration path |
| `GATEWAY_REQUEST_TIMEOUT_SECONDS` | Default upstream request timeout |
| `GATEWAY_MAX_REQUEST_BYTES` | Maximum accepted request body size |
| `GATEWAY_RATE_LIMIT_ENABLED` | Enables in-memory rate limiting |
| `GATEWAY_RATE_LIMIT_REQUESTS` | Requests per window |
| `GATEWAY_RATE_LIMIT_WINDOW_SECONDS` | Rate limit window length |
| `OPENAI_API_KEY` | OpenAI upstream credential |
| `DEEPSEEK_API_KEY` | DeepSeek upstream credential |
| `PERPLEXITY_API_KEY` | Perplexity upstream credential |
| `KIMI_API_KEY` | Kimi upstream credential |
| `ZAI_API_KEY` | Z.AI upstream credential |
| `HF_TOKEN` | Hugging Face Router token |
| `OLLAMA_CLOUD_API_KEY` | Ollama cloud credential |
| `OLLAMA_LOCAL_BASE_URL` | Override local Ollama base URL |
| `OLLAMA_CLOUD_BASE_URL` | Override Ollama cloud base URL |

Environment variables override the YAML file for scalar gateway settings, provider base URLs, and provider secrets.
