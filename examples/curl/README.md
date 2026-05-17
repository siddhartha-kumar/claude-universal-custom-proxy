# curl Examples

POSIX-shell scripts that exercise the gateway from any terminal that
has `curl` and `bash` (macOS Terminal, Linux, WSL, Git Bash on
Windows).

## Configuration precedence

Each script resolves the gateway API key in this order, stopping at
the first hit:

1. The `OPENAI_COMPATIBLE_API_KEY` environment variable.
2. `GATEWAY_API_KEYS` from `./.env` in the current working directory.
3. `GATEWAY_API_KEYS` from `<repo-root>/.env`.

`OPENAI_COMPATIBLE_BASE_URL` defaults to `http://localhost:8080/v1`
and `OPENAI_COMPATIBLE_MODEL` defaults to `ollama-cloud/gemma3:4b`.
Override either with the matching environment variable.

## Scripts

- `chat.sh` — single chat completion.
- `stream.sh` — streaming chat completion using SSE.
- `models.sh` — dynamic model discovery.

Run any script from the repo root:

```bash
./examples/curl/chat.sh
```

## Anthropic Messages API

For the Anthropic-shape surface (Claude Code, Claude Desktop,
Anthropic SDK), see [`docs/api-examples.md`](../../docs/api-examples.md)
for ready-to-paste `curl` invocations against `POST /v1/messages` with
`x-api-key` auth. The example scripts in this directory target the
OpenAI surface only.
