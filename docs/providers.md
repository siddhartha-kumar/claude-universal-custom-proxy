# Provider Integration Guide

Providers are configured in `config/default.yaml` under the `providers` map. Each provider declares its base URL, secret environment variable, supported features, and model prefixes.

## Defaults

| Provider | Base URL | Secret |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `OPENAI_API_KEY` |
| DeepSeek | `https://api.deepseek.com/v1` | `DEEPSEEK_API_KEY` |
| Perplexity | `https://api.perplexity.ai/v1` | `PERPLEXITY_API_KEY` |
| Kimi | `https://api.moonshot.ai/v1` | `KIMI_API_KEY` |
| Z.AI | `https://api.z.ai/api/paas/v4` | `ZAI_API_KEY` |
| Hugging Face Router | `https://router.huggingface.co/v1` | `HF_TOKEN` |
| Ollama local | `http://localhost:11434` | none |
| Ollama cloud | `https://ollama.com` | `OLLAMA_CLOUD_API_KEY` |

## Adding a Provider

1. Add a provider entry with `type: openai_compatible` or `type: ollama`.
2. Add the provider key environment variable with `api_key_env`.
3. Add one or more `model_prefixes`.
4. Add a route under `routes`.
5. Add static model hints if the provider does not expose `/models`.

Example:

```yaml
providers:
  custom:
    name: custom
    type: openai_compatible
    base_url: https://llm.example.com/v1
    api_key_env: CUSTOM_API_KEY
    supports_chat: true
    supports_streaming: true
    supports_models: true
    model_prefixes: ["custom-"]
routes:
  - provider: custom
    prefixes: ["custom-"]
```

## SSRF Guardrails

Provider URLs must be absolute HTTP or HTTPS URLs. Private, loopback, and link-local IPs are rejected unless `allow_private_network: true` is explicitly set. This exception should be limited to trusted local providers such as Ollama.
