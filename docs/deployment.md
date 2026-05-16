# Deployment Guide

## Docker

```bash
docker build -f docker/Dockerfile -t openai-compatible-llm-gateway:latest .
docker run --rm -p 8080:8080 --env-file .env openai-compatible-llm-gateway:latest
```

## Compose

```bash
docker compose -f deployment/docker-compose.yml up --build
```

## Compose With Local Ollama

```bash
docker compose -f deployment/docker-compose.ollama.yml up --build
```

The Ollama variant starts a local Ollama container alongside the gateway and
wires `OLLAMA_LOCAL_BASE_URL` to the in-network Ollama service.

## Production Checklist

- Set `GATEWAY_ENVIRONMENT=production`.
- Set `GATEWAY_API_KEYS` to one or more strong random values.
- Store provider credentials in a secret manager or protected runtime environment.
- Terminate TLS at a trusted reverse proxy or load balancer.
- Restrict direct access to provider credentials and logs.
- Configure request and upstream timeouts for your latency budget.
- Monitor `/health`, `/ready`, and `/metrics`.

## Reverse Proxy

Use `deployment/nginx/llm-gateway.conf` as a starting point for TLS termination and proxy buffering control. Streaming endpoints must disable response buffering.

## systemd

Use `deployment/systemd/llm-gateway.service` for a non-container Linux deployment. Run the service as a dedicated low-privilege user and keep `.env` readable only by that user.
