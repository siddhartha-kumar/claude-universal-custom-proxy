# Python Examples

Minimal `httpx` clients showing how to call the gateway from Python.

## Prerequisites

```bash
python -m pip install httpx
export OPENAI_COMPATIBLE_BASE_URL=http://localhost:8080/v1
export OPENAI_COMPATIBLE_API_KEY=change-this-before-use
export OPENAI_COMPATIBLE_MODEL=ollama-local/llama3.2
```

## Scripts

- `chat_completion.py` - single chat completion call.
- `stream_chat.py` - streaming chat completion using SSE.
- `list_models.py` - dynamic model discovery.

Run any script with `python examples/python/<script>.py`.
