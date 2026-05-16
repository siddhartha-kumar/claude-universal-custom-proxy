# Security Notes

## Defaults

- Production mode requires gateway authentication.
- Provider secrets are loaded from environment variables, not YAML.
- Request bodies are capped by `GATEWAY_MAX_REQUEST_BYTES`.
- Rate limiting is enabled by default.
- Security headers are attached to all responses.
- Provider base URLs are validated to reduce SSRF exposure.
- Error responses avoid stack traces in production.
- Logs are structured and do not include provider secrets.

## Operational Guidance

- Rotate `GATEWAY_API_KEYS` and provider credentials regularly.
- Keep `.env` out of git and restrict its filesystem permissions.
- Use TLS between clients and the gateway.
- Prefer private networking between the gateway and local providers.
- Restrict egress to known provider endpoints where the platform allows it.
- Monitor authentication failures and rate limit events.

## Private Network Providers

Only set `allow_private_network: true` for providers intentionally hosted on local or private networks. The default configuration uses this for local Ollama.
