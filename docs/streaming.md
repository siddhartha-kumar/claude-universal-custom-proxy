# Streaming Guide

The gateway supports streaming on both protocol surfaces:

- **OpenAI Chat Completions** (`POST /v1/chat/completions`) emits the
  standard OpenAI SSE format (`data: {"choices":[{"delta":...}]}\n\n`).
- **Anthropic Messages** (`POST /v1/messages`) emits the Anthropic SSE
  event sequence (`event: message_start`, `event: content_block_*`,
  `event: message_delta`, `event: message_stop`).

OpenAI-compatible upstream providers are streamed as direct
passthrough on the OpenAI surface. Ollama responses are transformed
from newline-delimited JSON to OpenAI-compatible SSE chunks. For the
Anthropic surface, the gateway runs the OpenAI passthrough
internally and re-emits the chunks as Anthropic events.

## Client requirements

- Use `stream: true` in the request body.
- For the OpenAI surface, keep the HTTP connection open until
  `data: [DONE]`.
- For the Anthropic surface, keep the connection open until the
  `message_stop` event arrives.
- Disable proxy buffering in reverse proxies (see
  `deployment/nginx/llm-gateway.conf`).
- Handle provider errors sent as final SSE error events when the
  upstream fails after the response has started.

## Anthropic event sequence

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_...","type":"message","role":"assistant","content":[],"model":"...","stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":2,"input_tokens":0}}

event: message_stop
data: {"type":"message_stop"}
```

The translator emits exactly one `content_block_start` /
`content_block_stop` pair around a text block. Tool-call streaming is
intentionally not emitted as Anthropic streaming `tool_use` events —
tool calls do appear correctly in the **non-streaming** Anthropic
response path. Force `stream: false` if you need streaming tool use.

## Cancellation

If a client disconnects, the gateway cancels the upstream stream and
closes the provider response. Cancellation is logged with the
provider name and request correlation ID. The Anthropic translator
still emits a final `content_block_stop` (if a block was open),
`message_delta`, and `message_stop` so partial reads stay well-formed.
