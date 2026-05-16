# Local Development Guide

## Setup

```bash
python -m venv .venv
. .venv/bin/activate
python -m pip install -e ".[dev]"
pre-commit install
cp .env.example .env
```

## Common Commands

```bash
make format
make lint
make type
make test
make coverage
make security
```

## Running Locally

```bash
uvicorn llm_proxy_gateway.main:app --reload --host 127.0.0.1 --port 8080
```

For local Ollama:

```bash
ollama pull llama3.2
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer change-this-before-use" \
  -H "Content-Type: application/json" \
  -d '{"model":"ollama-local/llama3.2","messages":[{"role":"user","content":"Hello"}]}'
```
