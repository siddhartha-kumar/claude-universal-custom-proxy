# Claude Code Integration Guide

The gateway can be used by OpenAI-compatible coding clients by pointing the client at the gateway base URL and selecting a routed model.

```bash
export OPENAI_COMPATIBLE_BASE_URL=http://localhost:8080/v1
export OPENAI_COMPATIBLE_API_KEY=change-this-before-use
export OPENAI_COMPATIBLE_MODEL=ollama-local/llama3.2
```

Use any configured model prefix:

- `gpt-4.1-mini`
- `deepseek-chat`
- `sonar-pro`
- `kimi-k2-0711-preview`
- `glm-4.6`
- `hf/meta-llama/Llama-3.1-8B-Instruct`
- `ollama-local/llama3.2`
- `ollama-cloud/gpt-oss:20b`

When a client sends a `developer` role to Ollama, the gateway normalizes that role to `system` because Ollama chat messages accept the standard local role set.
