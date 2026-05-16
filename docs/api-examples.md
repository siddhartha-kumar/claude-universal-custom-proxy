# API Examples

## Chat Completion

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

## Streaming Chat

```bash
curl -N http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer ${GATEWAY_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "ollama-local/llama3.2",
    "stream": true,
    "messages": [{"role": "user", "content": "Write one sentence."}]
  }'
```

## Image Generation

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

## Models

```bash
curl http://localhost:8080/v1/models \
  -H "Authorization: Bearer ${GATEWAY_KEY}"
```
