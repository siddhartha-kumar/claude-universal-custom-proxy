# Python Examples

Minimal `httpx` clients showing how to call the gateway from Python.

## Configuration precedence

Each script resolves the gateway API key in this order:

1. The `OPENAI_COMPATIBLE_API_KEY` environment variable.
2. `GATEWAY_API_KEYS` from `.env` in the current working directory.
3. `GATEWAY_API_KEYS` from `.env` at the repository root.

`OPENAI_COMPATIBLE_BASE_URL` defaults to `http://localhost:8080/v1` and
`OPENAI_COMPATIBLE_MODEL` defaults to `ollama-cloud/gemma3:4b`. Override
either via the corresponding environment variable.

## Scripts

- `chat_completion.py` - single chat completion call.
- `stream_chat.py` - streaming chat completion using SSE.
- `list_models.py` - dynamic model discovery.
- `_common.py` - shared resolver, not a runnable example.

Run any script from the repo root:

```bash
python examples/python/chat_completion.py
```

Requires `httpx` (already installed when you install the gateway with the
dev extras).
