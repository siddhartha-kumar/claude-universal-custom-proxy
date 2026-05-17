# API Examples

The gateway speaks **two protocols** on the same port. Use whichever
shape your client speaks natively.

## OpenAI Chat Completions API

### Chat completion

```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer ${GATEWAY_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4.1-mini",
    "messages": [
      {"role": "system", "content": "Be concise."},
      {"role": "user", "content": "Explain request correlation IDs."}
    ]
  }'
```

### Streaming chat

```bash
curl -N http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer ${GATEWAY_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "ollama-cloud/gemma3:4b",
    "stream": true,
    "messages": [{"role": "user", "content": "Write one sentence."}]
  }'
```

### Image generation

```bash
curl http://localhost:8080/v1/images/generations \
  -H "Authorization: Bearer ${GATEWAY_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-image-1",
    "prompt": "A clean network architecture diagram",
    "size": "1024x1024"
  }'
```

### Models

```bash
curl http://localhost:8080/v1/models \
  -H "Authorization: Bearer ${GATEWAY_KEY}"
```

## Anthropic Messages API

This is the surface Claude Code, Claude Desktop, and the Anthropic SDK
use natively. Authentication is via `x-api-key` (same gateway key as
above).

### Messages (non-streaming)

```bash
curl http://localhost:8080/v1/messages \
  -H "x-api-key: ${GATEWAY_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "hf/meta-llama/Llama-3.1-8B-Instruct",
    "max_tokens": 128,
    "system": "Be concise.",
    "messages": [
      {"role": "user", "content": "Explain request correlation IDs."}
    ]
  }'
```

Returns an Anthropic-shape response:

```json
{
  "id": "msg_...",
  "type": "message",
  "role": "assistant",
  "model": "hf/meta-llama/Llama-3.1-8B-Instruct",
  "content": [{"type": "text", "text": "..."}],
  "stop_reason": "end_turn",
  "stop_sequence": null,
  "usage": {"input_tokens": 14, "output_tokens": 36}
}
```

### Messages (streaming)

```bash
curl -N http://localhost:8080/v1/messages \
  -H "x-api-key: ${GATEWAY_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "ollama-cloud/deepseek-v3.2",
    "max_tokens": 128,
    "stream": true,
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

Returns a Server-Sent Events stream:

```
event: message_start
data: {"type":"message_start","message":{...,"usage":{"input_tokens":0,"output_tokens":0}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{...}}

event: message_stop
data: {"type":"message_stop"}
```

### Messages with tool use

```bash
curl http://localhost:8080/v1/messages \
  -H "x-api-key: ${GATEWAY_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "hf/Qwen/Qwen2.5-Coder-32B-Instruct",
    "max_tokens": 256,
    "messages": [{"role": "user", "content": "What is the weather in Paris?"}],
    "tools": [
      {
        "name": "get_weather",
        "description": "Get the current weather for a city",
        "input_schema": {
          "type": "object",
          "properties": {"city": {"type": "string"}},
          "required": ["city"]
        }
      }
    ]
  }'
```

When the model emits a tool call, the response includes a `tool_use`
content block:

```json
{
  "content": [
    {"type": "text", "text": "Let me check that for you."},
    {"type": "tool_use", "id": "toolu_...", "name": "get_weather", "input": {"city": "Paris"}}
  ],
  "stop_reason": "tool_use",
  ...
}
```
