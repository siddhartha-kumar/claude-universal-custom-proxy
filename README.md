# Claude Universal Custom Proxy

[![CI](https://github.com/siddhartha-kumar/claude-universal-custom-proxy/actions/workflows/ci.yml/badge.svg)](https://github.com/siddhartha-kumar/claude-universal-custom-proxy/actions/workflows/ci.yml)
![Node](https://img.shields.io/badge/node-%E2%89%A518-339933)
![License](https://img.shields.io/badge/license-MIT-blue)

A small, dependency-light local HTTP gateway that lets **Claude Desktop** and
**Claude Code** talk to free, openly-served models on **Ollama Cloud**,
**Hugging Face Inference Router**, and **NVIDIA NIM** through Claude's standard
custom-model gateway.

It speaks the Anthropic Messages API on the client side, translates to each
upstream's API (Anthropic Messages or OpenAI Chat Completions) on the server
side, and substitutes your own provider API keys so the gateway's placeholder
credentials never reach an upstream.

---

## Disclaimer

> This project is provided **strictly for educational and personal-learning
> purposes**. It is an independent, community-built utility and is **not
> affiliated with, endorsed by, or sponsored by** Anthropic, Ollama, Hugging
> Face, NVIDIA, or any other party referenced here.
>
> - It implements only the **publicly documented** Anthropic Messages API
>   surface and the **publicly documented** OpenAI-compatible Chat Completions
>   surfaces of the upstream providers. No private, undocumented, or
>   reverse-engineered endpoints are used. Third-party integration follows the
>   **official Anthropic documentation** for configuring custom / third-party
>   models.
> - All third-party models are reached through each provider's **official API**,
>   using **your own API keys**, and remain subject to **each provider's Terms
>   of Service, acceptable-use policies, and rate / credit limits**. You are
>   solely responsible for complying with those terms.
> - No attempt is made to bypass authentication, billing, rate limits, or any
>   usage restriction. The proxy never bundles, ships, or exposes third-party
>   credentials — keys are read only from your local environment.
> - All trademarks, model names, and brand names are the property of their
>   respective owners and are used here solely for **identification and
>   interoperability**.
> - The software is provided **"as is", without warranty of any kind**. Use at
>   your own risk.
>
> No infringement or abuse is intended. By using this project you agree that you
> are solely responsible for ensuring your usage complies with all applicable
> provider terms and laws.

---

## How it works

```
Claude Desktop / Claude Code
        │  Anthropic Messages  (Authorization: Bearer <placeholder>)
        ▼
┌─────────────────────────────┐
│  claude-universal-custom-    │   • resolves the requested model alias
│  proxy   (127.0.0.1:8787)    │   • substitutes YOUR upstream API key
└─────────────────────────────┘   • translates Anthropic <-> OpenAI-chat
        │                          • rewrites response.model back to the alias
        ▼
Ollama Cloud · HuggingFace Router · NVIDIA NIM   (your keys)
```

- Requests are routed by **model alias**: `ollama-*` → Ollama Cloud, `hf-*` →
  Hugging Face Router, `nim-*` → NVIDIA NIM.
- When `ANTHROPIC_API_KEY` is **not** set, the real Claude family models
  (`claude-haiku-*`, `claude-sonnet-*`, `claude-opus-*`, including the dated ids
  Claude Desktop emits internally) are transparently **re-routed** to a
  configurable free Ollama model so the app keeps working.
- Handles `/v1/messages`, `/v1/messages/count_tokens`, and `/v1/models`.

---

## Requirements

- **Node.js >= 18**.
- One or more provider API keys:
  - **Ollama Cloud** — <https://ollama.com/settings/keys>
  - **Hugging Face** (read token) — <https://huggingface.co/settings/tokens>
  - **NVIDIA NIM** (free tier, `nvapi-` key) — <https://build.nvidia.com/>

The only runtime dependency is [`dotenv`](https://www.npmjs.com/package/dotenv).

---

## Quick start

```bash
git clone https://github.com/siddhartha-kumar/claude-universal-custom-proxy.git
cd claude-universal-custom-proxy
npm install

cp .env.example .env        # then add your provider API keys
npm start                   # starts the proxy on http://127.0.0.1:8787
```

You should see a startup banner listing the providers with a check next to each
one that has a key, plus the number of models exposed.

`./start.sh` is an optional POSIX wrapper that runs the same server as a
background daemon (`./start.sh start|stop|restart|status|foreground`).

---

## Configuration

All configuration is via environment variables, loaded from `.env` (see
[`.env.example`](.env.example)). The common ones:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | Local port the proxy listens on |
| `BASE_URL` | `http://127.0.0.1:8787` | URL Claude Desktop calls |
| `DEFAULT_PROVIDER` | `ollama` | Provider for any model not in the routing table (auto-falls-back to a provider that has a key) |
| `OLLAMA_API_KEY` | — | Ollama Cloud key |
| `HUGGINGFACE_API_KEY` / `HF_TOKEN` | — | Hugging Face token |
| `NVIDIA_API_KEY` / `NVAPI_KEY` / `NIM_API_KEY` | — | NVIDIA NIM key |
| `CLAUDE_HAIKU_MODEL` | `ollama-gpt-oss-20b` | Fallback alias for `claude-haiku-*` when no Anthropic key |
| `CLAUDE_SONNET_MODEL` | `ollama-qwen3-coder-480b` | Fallback alias for `claude-sonnet-*` |
| `CLAUDE_OPUS_MODEL` | `ollama-gpt-oss-120b` | Fallback alias for `claude-opus-*` |
| `REWRITE_RESPONSES` | `true` | Rewrite `response.model` back to the alias the client requested |
| `DEBUG_PROXY` | `false` | Verbose request / routing logs |

Optional providers (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`,
`QWEN_API_KEY`, `DEEPSEEK_API_KEY`, `MOONSHOT_API_KEY`, `GLM_API_KEY`,
`XIAOMI_API_KEY`) remain routable upstreams — add a key and map models to them
with `MODEL_MAP` / `MODEL_ROUTES`.

---

## Model catalog

The catalog is built from **live, verified provider data** — each provider's own
`/v1/models` endpoint plus a per-model chat probe. Only models the provider
actually serves on the free tier are included.

| Provider | Aliases | Notes |
| --- | --- | --- |
| Ollama Cloud | **25** | Free Turbo models. Subscription-gated ids (HTTP 403) excluded. |
| Hugging Face Router | **125** | **Credit-metered** — see note below. |
| NVIDIA NIM | **38** | Free tier (rate-limited). Embeddings / guards / OCR excluded. |
| Anthropic (native) | **5** | Used directly when `ANTHROPIC_API_KEY` is set; otherwise family-fallback. |

List the live catalog at any time:

```bash
curl -s http://127.0.0.1:8787/v1/models
```

**Provider availability differs:**

- **Ollama Cloud** and **NVIDIA NIM** offer **rate-limited free** access — the
  mapped models work without per-call charges.
- **Hugging Face Inference Router** is **credit-metered**: requests succeed
  until your monthly included credit is spent, after which models return
  `HTTP 402 Payment Required` until the credit resets or you add billing / a PRO
  plan. The aliases are mapped so they work whenever you have credit available.

### What you pick vs. what runs

Every alias in the picker maps to one real upstream model id. The naming is
mechanical: `ollama-`, `hf-`, and `nim-` prefixes tell you the provider, and
the rest is the model name. Full alias → upstream tables:

<details>
<summary>Ollama Cloud — 25 models</summary>

| Picker alias | Upstream model id |
| --- | --- |
| `ollama-cogito-2.1-671b` | `cogito-2.1:671b` |
| `ollama-devstral-2-123b` | `devstral-2:123b` |
| `ollama-devstral-small-2-24b` | `devstral-small-2:24b` |
| `ollama-gemma3-12b` | `gemma3:12b` |
| `ollama-gemma3-27b` | `gemma3:27b` |
| `ollama-gemma3-4b` | `gemma3:4b` |
| `ollama-gemma4-31b` | `gemma4:31b` |
| `ollama-glm-4.6` | `glm-4.6` |
| `ollama-glm-4.7` | `glm-4.7` |
| `ollama-gpt-oss-120b` | `gpt-oss:120b` |
| `ollama-gpt-oss-20b` | `gpt-oss:20b` |
| `ollama-minimax-m2` | `minimax-m2` |
| `ollama-minimax-m2.1` | `minimax-m2.1` |
| `ollama-minimax-m2.5` | `minimax-m2.5` |
| `ollama-ministral-3-14b` | `ministral-3:14b` |
| `ollama-ministral-3-3b` | `ministral-3:3b` |
| `ollama-ministral-3-8b` | `ministral-3:8b` |
| `ollama-nemotron-3-nano-30b` | `nemotron-3-nano:30b` |
| `ollama-nemotron-3-super` | `nemotron-3-super` |
| `ollama-qwen3-coder-480b` | `qwen3-coder:480b` |
| `ollama-qwen3-coder-next` | `qwen3-coder-next` |
| `ollama-qwen3-next-80b` | `qwen3-next:80b` |
| `ollama-qwen3-vl-235b` | `qwen3-vl:235b` |
| `ollama-qwen3-vl-235b-instruct` | `qwen3-vl:235b-instruct` |
| `ollama-rnj-1-8b` | `rnj-1:8b` |

</details>

<details>
<summary>Hugging Face Router — 125 models</summary>

| Picker alias | Upstream model id |
| --- | --- |
| `hf-apertus-70b-instruct-2509` | `swiss-ai/Apertus-70B-Instruct-2509` |
| `hf-apertus-8b-instruct-2509` | `swiss-ai/Apertus-8B-Instruct-2509` |
| `hf-arch-router-1.5b` | `katanemo/Arch-Router-1.5B` |
| `hf-autoglm-phone-9b-multilingual` | `zai-org/AutoGLM-Phone-9B-Multilingual` |
| `hf-aya-expanse-32b` | `CohereLabs/aya-expanse-32b` |
| `hf-aya-vision-32b` | `CohereLabs/aya-vision-32b` |
| `hf-c4ai-command-a-03-2025` | `CohereLabs/c4ai-command-a-03-2025` |
| `hf-c4ai-command-r-08-2024` | `CohereLabs/c4ai-command-r-08-2024` |
| `hf-c4ai-command-r7b-12-2024` | `CohereLabs/c4ai-command-r7b-12-2024` |
| `hf-c4ai-command-r7b-arabic-02-2025` | `CohereLabs/c4ai-command-r7b-arabic-02-2025` |
| `hf-cogito-671b-v2.1` | `deepcogito/cogito-671b-v2.1` |
| `hf-cogito-671b-v2.1-fp8` | `deepcogito/cogito-671b-v2.1-FP8` |
| `hf-command-a-reasoning-08-2025` | `CohereLabs/command-a-reasoning-08-2025` |
| `hf-deepseek-prover-v2-671b` | `deepseek-ai/DeepSeek-Prover-V2-671B` |
| `hf-deepseek-r1` | `deepseek-ai/DeepSeek-R1` |
| `hf-deepseek-r1-0528` | `deepseek-ai/DeepSeek-R1-0528` |
| `hf-deepseek-r1-distill-llama-70b` | `deepseek-ai/DeepSeek-R1-Distill-Llama-70B` |
| `hf-deepseek-r1-distill-llama-8b` | `deepseek-ai/DeepSeek-R1-Distill-Llama-8B` |
| `hf-deepseek-r1-distill-qwen-1.5b` | `deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B` |
| `hf-deepseek-r1-distill-qwen-14b` | `deepseek-ai/DeepSeek-R1-Distill-Qwen-14B` |
| `hf-deepseek-r1-distill-qwen-32b` | `deepseek-ai/DeepSeek-R1-Distill-Qwen-32B` |
| `hf-deepseek-r1-distill-qwen-7b` | `deepseek-ai/DeepSeek-R1-Distill-Qwen-7B` |
| `hf-deepseek-v3` | `deepseek-ai/DeepSeek-V3` |
| `hf-deepseek-v3-0324` | `deepseek-ai/DeepSeek-V3-0324` |
| `hf-deepseek-v3.1` | `deepseek-ai/DeepSeek-V3.1` |
| `hf-deepseek-v3.1-terminus` | `deepseek-ai/DeepSeek-V3.1-Terminus` |
| `hf-deepseek-v3.2` | `deepseek-ai/DeepSeek-V3.2` |
| `hf-deepseek-v3.2-exp` | `deepseek-ai/DeepSeek-V3.2-Exp` |
| `hf-deepseek-v4-flash` | `deepseek-ai/DeepSeek-V4-Flash` |
| `hf-deepseek-v4-pro` | `deepseek-ai/DeepSeek-V4-Pro` |
| `hf-dictalm-3.0-24b-thinking` | `dicta-il/DictaLM-3.0-24B-Thinking` |
| `hf-ernie-4.5-300b-a47b-base-pt` | `baidu/ERNIE-4.5-300B-A47B-Base-PT` |
| `hf-ernie-4.5-vl-424b-a47b-base-pt` | `baidu/ERNIE-4.5-VL-424B-A47B-Base-PT` |
| `hf-eurollm-22b-instruct-2512` | `utter-project/EuroLLM-22B-Instruct-2512` |
| `hf-gemma-3-27b-it` | `google/gemma-3-27b-it` |
| `hf-gemma-3n-e4b-it` | `google/gemma-3n-E4B-it` |
| `hf-gemma-4-26b-a4b-it` | `google/gemma-4-26B-A4B-it` |
| `hf-gemma-4-31b-it` | `google/gemma-4-31B-it` |
| `hf-gemma-4-31b-it-pearl` | `pearl-ai/Gemma-4-31B-it-pearl` |
| `hf-gemma-sea-lion-v4-27b-it` | `aisingapore/Gemma-SEA-LION-v4-27B-IT` |
| `hf-glm-4-32b-0414` | `zai-org/GLM-4-32B-0414` |
| `hf-glm-4.5` | `zai-org/GLM-4.5` |
| `hf-glm-4.5-air` | `zai-org/GLM-4.5-Air` |
| `hf-glm-4.5v` | `zai-org/GLM-4.5V` |
| `hf-glm-4.5v-fp8` | `zai-org/GLM-4.5V-FP8` |
| `hf-glm-4.6` | `zai-org/GLM-4.6` |
| `hf-glm-4.6-fp8` | `zai-org/GLM-4.6-FP8` |
| `hf-glm-4.6v` | `zai-org/GLM-4.6V` |
| `hf-glm-4.6v-flash` | `zai-org/GLM-4.6V-Flash` |
| `hf-glm-4.6v-fp8` | `zai-org/GLM-4.6V-FP8` |
| `hf-glm-4.7` | `zai-org/GLM-4.7` |
| `hf-glm-4.7-flash` | `zai-org/GLM-4.7-Flash` |
| `hf-glm-4.7-fp8` | `zai-org/GLM-4.7-FP8` |
| `hf-glm-5` | `zai-org/GLM-5` |
| `hf-glm-5.1` | `zai-org/GLM-5.1` |
| `hf-glm-5.1-fp8` | `zai-org/GLM-5.1-FP8` |
| `hf-gpt-oss-120b` | `openai/gpt-oss-120b` |
| `hf-gpt-oss-20b` | `openai/gpt-oss-20b` |
| `hf-hermes-2-pro-llama-3-8b` | `NousResearch/Hermes-2-Pro-Llama-3-8B` |
| `hf-kimi-k2-instruct` | `moonshotai/Kimi-K2-Instruct` |
| `hf-kimi-k2-instruct-0905` | `moonshotai/Kimi-K2-Instruct-0905` |
| `hf-kimi-k2-thinking` | `moonshotai/Kimi-K2-Thinking` |
| `hf-kimi-k2.5` | `moonshotai/Kimi-K2.5` |
| `hf-kimi-k2.6` | `moonshotai/Kimi-K2.6` |
| `hf-l3-70b-euryale-v2.1` | `Sao10K/L3-70B-Euryale-v2.1` |
| `hf-l3-8b-lunaris-v1` | `Sao10K/L3-8B-Lunaris-v1` |
| `hf-l3-8b-stheno-v3.2` | `Sao10K/L3-8B-Stheno-v3.2` |
| `hf-ling-2.6-1t` | `inclusionAI/Ling-2.6-1T` |
| `hf-llama-3.1-70b-instruct` | `meta-llama/Llama-3.1-70B-Instruct` |
| `hf-llama-3.1-8b-instruct` | `meta-llama/Llama-3.1-8B-Instruct` |
| `hf-llama-3.2-1b-instruct` | `meta-llama/Llama-3.2-1B-Instruct` |
| `hf-llama-3.3-70b-instruct` | `meta-llama/Llama-3.3-70B-Instruct` |
| `hf-llama-4-maverick-17b-128e-instruct` | `meta-llama/Llama-4-Maverick-17B-128E-Instruct` |
| `hf-llama-4-maverick-17b-128e-instruct-fp8` | `meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8` |
| `hf-llama-4-scout-17b-16e-instruct` | `meta-llama/Llama-4-Scout-17B-16E-Instruct` |
| `hf-meta-llama-3-70b-instruct` | `meta-llama/Meta-Llama-3-70B-Instruct` |
| `hf-meta-llama-3-8b-instruct` | `meta-llama/Meta-Llama-3-8B-Instruct` |
| `hf-mimo-v2-flash` | `XiaomiMiMo/MiMo-V2-Flash` |
| `hf-minimax-m1-80k` | `MiniMaxAI/MiniMax-M1-80k` |
| `hf-minimax-m2` | `MiniMaxAI/MiniMax-M2` |
| `hf-minimax-m2.1` | `MiniMaxAI/MiniMax-M2.1` |
| `hf-minimax-m2.5` | `MiniMaxAI/MiniMax-M2.5` |
| `hf-minimax-m2.7` | `MiniMaxAI/MiniMax-M2.7` |
| `hf-olmo-3-7b-instruct` | `allenai/Olmo-3-7B-Instruct` |
| `hf-qwen-sea-lion-v4-32b-it` | `aisingapore/Qwen-SEA-LION-v4-32B-IT` |
| `hf-qwen2.5-72b-instruct` | `Qwen/Qwen2.5-72B-Instruct` |
| `hf-qwen2.5-7b-instruct` | `Qwen/Qwen2.5-7B-Instruct` |
| `hf-qwen2.5-coder-32b-instruct` | `Qwen/Qwen2.5-Coder-32B-Instruct` |
| `hf-qwen2.5-coder-3b-instruct` | `Qwen/Qwen2.5-Coder-3B-Instruct` |
| `hf-qwen2.5-coder-7b-instruct` | `Qwen/Qwen2.5-Coder-7B-Instruct` |
| `hf-qwen2.5-vl-72b-instruct` | `Qwen/Qwen2.5-VL-72B-Instruct` |
| `hf-qwen3-14b` | `Qwen/Qwen3-14B` |
| `hf-qwen3-235b-a22b` | `Qwen/Qwen3-235B-A22B` |
| `hf-qwen3-235b-a22b-instruct-2507` | `Qwen/Qwen3-235B-A22B-Instruct-2507` |
| `hf-qwen3-235b-a22b-thinking-2507` | `Qwen/Qwen3-235B-A22B-Thinking-2507` |
| `hf-qwen3-30b-a3b` | `Qwen/Qwen3-30B-A3B` |
| `hf-qwen3-32b` | `Qwen/Qwen3-32B` |
| `hf-qwen3-4b-instruct-2507` | `Qwen/Qwen3-4B-Instruct-2507` |
| `hf-qwen3-4b-thinking-2507` | `Qwen/Qwen3-4B-Thinking-2507` |
| `hf-qwen3-8b` | `Qwen/Qwen3-8B` |
| `hf-qwen3-coder-30b-a3b-instruct` | `Qwen/Qwen3-Coder-30B-A3B-Instruct` |
| `hf-qwen3-coder-480b-a35b-instruct` | `Qwen/Qwen3-Coder-480B-A35B-Instruct` |
| `hf-qwen3-coder-480b-a35b-instruct-fp8` | `Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8` |
| `hf-qwen3-coder-next` | `Qwen/Qwen3-Coder-Next` |
| `hf-qwen3-next-80b-a3b-instruct` | `Qwen/Qwen3-Next-80B-A3B-Instruct` |
| `hf-qwen3-next-80b-a3b-thinking` | `Qwen/Qwen3-Next-80B-A3B-Thinking` |
| `hf-qwen3-vl-235b-a22b-instruct` | `Qwen/Qwen3-VL-235B-A22B-Instruct` |
| `hf-qwen3-vl-235b-a22b-thinking` | `Qwen/Qwen3-VL-235B-A22B-Thinking` |
| `hf-qwen3-vl-30b-a3b-instruct` | `Qwen/Qwen3-VL-30B-A3B-Instruct` |
| `hf-qwen3-vl-30b-a3b-thinking` | `Qwen/Qwen3-VL-30B-A3B-Thinking` |
| `hf-qwen3-vl-8b-instruct` | `Qwen/Qwen3-VL-8B-Instruct` |
| `hf-qwen3.5-122b-a10b` | `Qwen/Qwen3.5-122B-A10B` |
| `hf-qwen3.5-27b` | `Qwen/Qwen3.5-27B` |
| `hf-qwen3.5-35b-a3b` | `Qwen/Qwen3.5-35B-A3B` |
| `hf-qwen3.5-397b-a17b` | `Qwen/Qwen3.5-397B-A17B` |
| `hf-qwen3.5-9b` | `Qwen/Qwen3.5-9B` |
| `hf-qwen3.6-35b-a3b` | `Qwen/Qwen3.6-35B-A3B` |
| `hf-qwq-32b` | `Qwen/QwQ-32B` |
| `hf-rnj-1-instruct` | `EssentialAI/rnj-1-instruct` |
| `hf-step-3.5-flash` | `stepfun-ai/Step-3.5-Flash` |
| `hf-tiny-aya-earth` | `CohereLabs/tiny-aya-earth` |
| `hf-tiny-aya-fire` | `CohereLabs/tiny-aya-fire` |
| `hf-tiny-aya-global` | `CohereLabs/tiny-aya-global` |
| `hf-tiny-aya-water` | `CohereLabs/tiny-aya-water` |
| `hf-wizardlm-2-8x22b` | `alpindale/WizardLM-2-8x22B` |

</details>

<details>
<summary>NVIDIA NIM — 38 models</summary>

| Picker alias | Upstream model id |
| --- | --- |
| `nim-dracarys-llama-3.1-70b-instruct` | `abacusai/dracarys-llama-3.1-70b-instruct` |
| `nim-gemma-2-2b-it` | `google/gemma-2-2b-it` |
| `nim-gemma-3n-e2b-it` | `google/gemma-3n-e2b-it` |
| `nim-gemma-3n-e4b-it` | `google/gemma-3n-e4b-it` |
| `nim-gpt-oss-120b` | `openai/gpt-oss-120b` |
| `nim-gpt-oss-20b` | `openai/gpt-oss-20b` |
| `nim-ising-calibration-1-35b-a3b` | `nvidia/ising-calibration-1-35b-a3b` |
| `nim-kimi-k2.6` | `moonshotai/kimi-k2.6` |
| `nim-llama-3.1-70b-instruct` | `meta/llama-3.1-70b-instruct` |
| `nim-llama-3.1-8b-instruct` | `meta/llama-3.1-8b-instruct` |
| `nim-llama-3.1-nemotron-nano-8b-v1` | `nvidia/llama-3.1-nemotron-nano-8b-v1` |
| `nim-llama-3.1-nemotron-nano-vl-8b-v1` | `nvidia/llama-3.1-nemotron-nano-vl-8b-v1` |
| `nim-llama-3.2-11b-vision-instruct` | `meta/llama-3.2-11b-vision-instruct` |
| `nim-llama-3.2-1b-instruct` | `meta/llama-3.2-1b-instruct` |
| `nim-llama-3.2-3b-instruct` | `meta/llama-3.2-3b-instruct` |
| `nim-llama-3.3-70b-instruct` | `meta/llama-3.3-70b-instruct` |
| `nim-llama-3.3-nemotron-super-49b-v1.5` | `nvidia/llama-3.3-nemotron-super-49b-v1.5` |
| `nim-llama-4-maverick-17b-128e-instruct` | `meta/llama-4-maverick-17b-128e-instruct` |
| `nim-ministral-14b-instruct-2512` | `mistralai/ministral-14b-instruct-2512` |
| `nim-mistral-large-3-675b-instruct-2512` | `mistralai/mistral-large-3-675b-instruct-2512` |
| `nim-mistral-medium-3.5-128b` | `mistralai/mistral-medium-3.5-128b` |
| `nim-mistral-nemotron` | `mistralai/mistral-nemotron` |
| `nim-mistral-small-4-119b-2603` | `mistralai/mistral-small-4-119b-2603` |
| `nim-mixtral-8x22b-instruct-v0.1` | `mistralai/mixtral-8x22b-instruct-v0.1` |
| `nim-mixtral-8x7b-instruct-v0.1` | `mistralai/mixtral-8x7b-instruct-v0.1` |
| `nim-nemotron-3-nano-30b-a3b` | `nvidia/nemotron-3-nano-30b-a3b` |
| `nim-nemotron-3-nano-omni-30b-a3b-reasoning` | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` |
| `nim-nemotron-3-super-120b-a12b` | `nvidia/nemotron-3-super-120b-a12b` |
| `nim-nemotron-mini-4b-instruct` | `nvidia/nemotron-mini-4b-instruct` |
| `nim-nemotron-nano-12b-v2-vl` | `nvidia/nemotron-nano-12b-v2-vl` |
| `nim-nvidia-nemotron-nano-9b-v2` | `nvidia/nvidia-nemotron-nano-9b-v2` |
| `nim-qwen3-coder-480b-a35b-instruct` | `qwen/qwen3-coder-480b-a35b-instruct` |
| `nim-qwen3-next-80b-a3b-instruct` | `qwen/qwen3-next-80b-a3b-instruct` |
| `nim-qwen3-next-80b-a3b-thinking` | `qwen/qwen3-next-80b-a3b-thinking` |
| `nim-sarvam-m` | `sarvamai/sarvam-m` |
| `nim-solar-10.7b-instruct` | `upstage/solar-10.7b-instruct` |
| `nim-step-3.5-flash` | `stepfun-ai/step-3.5-flash` |
| `nim-stockmark-2-100b-instruct` | `stockmark/stockmark-2-100b-instruct` |

</details>

**Native Claude family** (shown in the picker as Claude models):

| Picker alias | With `ANTHROPIC_API_KEY` | Without a key (family fallback) |
| --- | --- | --- |
| `claude-haiku-4-5` | real Anthropic Haiku | `ollama-gpt-oss-20b` → `gpt-oss:20b` |
| `claude-sonnet-4-5`, `claude-sonnet-4-6` | real Anthropic Sonnet | `ollama-qwen3-coder-480b` → `qwen3-coder:480b` |
| `claude-opus-4-1`, `claude-opus-4-7` | real Anthropic Opus | `ollama-gpt-oss-120b` → `gpt-oss:120b` |

The dated ids Claude Desktop emits internally (e.g.
`claude-haiku-4-5-20251001`) follow the same fallback. Override the targets
with `CLAUDE_HAIKU_MODEL` / `CLAUDE_SONNET_MODEL` / `CLAUDE_OPUS_MODEL`.

### Refreshing the catalog

Model availability changes over time. Regenerate from live data:

```bash
npm run models:discover     # print each provider's live /v1/models list
npm run models:probe        # probe every model (writes scripts/.model-probe.json)
node scripts/generate-registry.mjs   # emit the PROVIDER_MODELS array to paste into proxy.mjs
```

---

## Connect Claude Desktop

1. **Start the proxy** — `npm start`. Leave it running; it listens on
   `http://127.0.0.1:8787`.

2. **Turn on Developer Mode** — open **Settings → General** (the exact path
   varies by build; some versions put the toggle under the Help menu), enable
   **Developer Mode**, and restart Claude Desktop.

3. **Add the gateway** — go to **Settings → Developer → Third-party inference →
   Gateway** and fill in:

   | Field | Value |
   | --- | --- |
   | Provider | `Gateway` |
   | Gateway base URL | `http://127.0.0.1:8787` |
   | Gateway API key | any non-empty placeholder, e.g. `local-proxy` — the proxy swaps in your real upstream key |
   | Gateway auth scheme | `bearer` |
   | Model list | **Fetch from gateway** — auto-populates all 193 aliases |

4. **Pick a model** — open a chat, click the model selector (bottom-right), and
   choose any alias. Type part of a name (`deepseek`, `llama`, `qwen`,
   `gpt-oss`) to filter. The background calls the app makes for chat titles,
   token counting, and summaries are routed through the same provider via the
   family-fallback resolver, so a single provider key is enough end to end.

If you don't set `ANTHROPIC_API_KEY`, selecting a native Claude model still
works — it's transparently rerouted to the configured free Ollama fallback (see
the mapping table above).

## Connect Claude Code

Point Claude Code at the proxy with two environment variables, then pick a
model:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:8787
export ANTHROPIC_API_KEY=local-proxy        # any non-empty placeholder
claude
```

Inside the session, list and switch models with `/model` (for example
`/model ollama-qwen3-coder-480b`). The proxy's `/v1/models` feeds the picker.

## Project structure

```
proxy.mjs                 # the entire gateway (single file)
start.sh                  # optional POSIX daemon wrapper
scripts/
  discover-models.mjs     # list each provider's live /v1/models catalog
  probe-models.mjs        # probe every model for free-tier availability
  generate-registry.mjs   # build the PROVIDER_MODELS array from probe data
  real-upstream-smoke.mjs # send one tiny prompt per provider (manual check)
  ensure-node.sh          # node bootstrap used by start.sh
test/
  proxy.test.mjs          # mechanics: translation, streaming, routing, endpoints
  e2e-routing.test.mjs    # every alias routed through mock upstreams
.env.example              # configuration template
```

Run the tests (no network, no credits used):

```bash
npm test
```

---

## Security

- API keys are read only from your local environment / `.env` and are sent only
  to the matching provider. `.env` is git-ignored.
- The proxy binds to `127.0.0.1` (loopback) by default.
- See [SECURITY.md](SECURITY.md) for reporting and supply-chain notes.

---

## Credits

This project is inspired by
[wanghao9610/claude-model-proxy](https://github.com/wanghao9610/claude-model-proxy)
and is a modernization and advancement of it. Building on that project's core
idea — a local gateway that lets Claude clients talk to third-party models — this
version adds:

- a **live, probe-verified** multi-provider catalog (Ollama Cloud, Hugging Face
  Router, NVIDIA NIM) generated from each provider's own `/v1/models` endpoint
  instead of a hand-maintained list;
- **brand-style aliases** that stay visible in Claude Desktop's model picker, a
  **Claude family fallback** so native `claude-*` calls work without an Anthropic
  key, and **default-provider auto-fallback**;
- full **Anthropic ⇄ OpenAI Chat Completions** translation (JSON and streaming
  SSE) with upstream key substitution;
- a dependency-light, **npm-only** runtime with an offline test suite.

Thanks to the original author for the foundation.

## License

[MIT](LICENSE) © Siddhartha Kumar
