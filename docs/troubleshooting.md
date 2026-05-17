# Troubleshooting Guide

## `401 authentication required`

The gateway accepts two auth schemes against the same `GATEWAY_API_KEYS` list:

- **OpenAI surface (`/v1/chat/completions`, `/v1/models`, ...)** — send
  `Authorization: Bearer <gateway key>`.
- **Anthropic surface (`/v1/messages`)** — send `x-api-key: <gateway key>`.

Confirm the value matches one of the entries in `GATEWAY_API_KEYS`.
The example scripts auto-load from `.env`; verify your `.env` has a
non-placeholder `GATEWAY_API_KEYS` line.

## `404 model_not_found`

The model name does not match a configured prefix. Check
`config/default.yaml` and `GET /v1/models`.

For the Anthropic surface, model ids that start with `claude-*` fall
back to `anthropic_default_model` from `config/default.yaml` (default
`ollama-cloud/gemma3:4b`). Set this to a routed model id or pass
`--model <routed-name>` to Claude Code.

## Provider missing from `/ready`

Disabled providers are not constructed. Enabled providers without
required credentials report `configured: false`.

## Streaming hangs behind a proxy

Disable response buffering in the reverse proxy and use `curl -N` or
a streaming-aware client. See `deployment/nginx/llm-gateway.conf`
for a working configuration.

## Local Ollama fails

Verify Ollama is running:

```bash
curl http://localhost:11434/api/tags
```

Then call a gateway model name with the `ollama-local/` prefix.

## Claude Code returns empty content

Claude Code sends a tool-heavy system prompt. Small base models
without function-calling training often can't parse it and return
nothing. Switch to an instruction-tuned model with tool-call
training, e.g. `hf/meta-llama/Llama-3.1-8B-Instruct`,
`hf/Qwen/Qwen2.5-Coder-32B-Instruct`, or `ollama-cloud/deepseek-v3.2`.
The same models reply normally when called directly via curl against
the OpenAI surface.

## Claude Code uses Anthropic instead of the gateway

Two common causes:

1. Developer mode / third-party inference is off. Enable it in
   Claude Code's Settings → Developer panel and restart Claude Code.
   See [SETUP.md Step 7-Pre](../SETUP.md#7-pre-enable-third-party-inference-in-claude-code-one-time).
2. `ANTHROPIC_BASE_URL` is unset or pointed at the wrong host.
   Set it to `http://127.0.0.1:8080` (no `/v1` suffix) and restart
   Claude Code fully (Command + Q on macOS).

## Production startup fails

Production mode requires `GATEWAY_AUTH_ENABLED=true` and at least one
`GATEWAY_API_KEYS` value.
