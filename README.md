# Claude Universal Custom Proxy

Claude Universal Custom Proxy is a production-grade Python ASGI gateway that exposes OpenAI-compatible APIs over a multi-provider backend. It routes OpenAI-style traffic to OpenAI, DeepSeek, Perplexity, Kimi, Z.AI, the Hugging Face router, and local or cloud Ollama, while keeping provider credentials and routing rules server side. The gateway is designed to work transparently with Claude Code and any other OpenAI-compatible client.

## Capabilities

- OpenAI-compatible `POST /v1/chat/completions`
- OpenAI-compatible `POST /v1/images/generations`
- OpenAI-compatible `GET /v1/models`
- SSE streaming passthrough for OpenAI-compatible providers
- Native Ollama `/api/chat` transformation for local and cloud endpoints
- Prefix-based routing for OpenAI, DeepSeek, Perplexity, Kimi, Z.AI, Hugging Face Router, Ollama local, and Ollama cloud
- Request authentication, rate limiting, body size limits, security headers, and SSRF-aware provider URL validation
- Structured JSON logging, request correlation IDs, provider metrics, health, and readiness endpoints
- Docker, docker-compose, pre-commit, CI, security scanning, and release automation

## Routing

| Model prefix | Provider |
| --- | --- |
| `gpt-*`, `o3-*` | OpenAI |
| `deepseek-*` | DeepSeek |
| `sonar-*` | Perplexity |
| `kimi-*` | Kimi |
| `glm-*` | Z.AI |
| `hf/*` | Hugging Face Router |
| `ollama-local/*` | Local Ollama |
| `ollama-cloud/*` | Ollama cloud |

Prefixes using `/` are stripped before the upstream call. For example, `ollama-local/llama3.2` is sent to Ollama as `llama3.2`.

## Quick Start

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -e ".[dev]"
cp .env.example .env
uvicorn llm_proxy_gateway.main:app --host 0.0.0.0 --port 8080
```

Set at least one proxy key in `GATEWAY_API_KEYS` before exposing the service.

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer change-this-before-use" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "ollama-local/llama3.2",
    "messages": [{"role": "user", "content": "Say hello in one sentence."}]
  }'
```

## Documentation

- [Architecture](docs/architecture.md)
- [Provider integration](docs/providers.md)
- [Configuration reference](docs/configuration.md)
- [Environment variables](docs/environment.md)
- [API examples](docs/api-examples.md)
- [Streaming](docs/streaming.md)
- [Deployment](docs/deployment.md)
- [Local development](docs/local-development.md)
- [Security notes](docs/security.md)
- [Claude Code integration](docs/claude-code-integration.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Contribution standards](docs/contributing.md)
- [Branching strategy](docs/branching-strategy.md)

## Production Notes

Run behind TLS, configure `GATEWAY_ENVIRONMENT=production`, set `GATEWAY_API_KEYS`, keep provider credentials in environment variables or a secret manager, and expose only the gateway to clients. Production mode refuses to start without gateway authentication.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md), [docs/contributing.md](docs/contributing.md), and [docs/branching-strategy.md](docs/branching-strategy.md). Code of conduct in [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security disclosures in [SECURITY.md](SECURITY.md).

## License

MIT License. Copyright (c) 2026 Siddhartha Kumar. See [LICENSE](LICENSE).
