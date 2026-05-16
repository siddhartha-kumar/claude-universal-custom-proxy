# Streaming Guide

The gateway supports OpenAI-style Server-Sent Events.

OpenAI-compatible providers are streamed as upstream passthrough. Ollama responses are transformed from newline-delimited JSON to OpenAI-compatible SSE chunks.

## Client Requirements

- Use `stream: true` in the request body.
- Keep the HTTP connection open until `data: [DONE]`.
- Disable proxy buffering in reverse proxies.
- Handle provider errors sent as final SSE error events when the upstream fails after the response has started.

## Cancellation

If a client disconnects, the gateway cancels the upstream stream and closes the provider response. Cancellation is logged with the provider name and request correlation ID.
