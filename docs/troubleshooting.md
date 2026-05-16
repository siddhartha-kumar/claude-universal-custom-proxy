# Troubleshooting Guide

## `401 authentication required`

Set `Authorization: Bearer <gateway key>` and ensure the key is listed in `GATEWAY_API_KEYS`.

## `404 model_not_found`

The model name does not match a configured prefix. Check `config/default.yaml` and `GET /v1/models`.

## Provider Missing From `/ready`

Disabled providers are not constructed. Enabled providers without required credentials report `configured: false`.

## Streaming Hangs Behind a Proxy

Disable response buffering in the reverse proxy and use `curl -N` or a streaming-aware client.

## Local Ollama Fails

Verify Ollama is running:

```bash
curl http://localhost:11434/api/tags
```

Then call a gateway model name with the `ollama-local/` prefix.

## Production Startup Fails

Production mode requires `GATEWAY_AUTH_ENABLED=true` and at least one `GATEWAY_API_KEYS` value.
