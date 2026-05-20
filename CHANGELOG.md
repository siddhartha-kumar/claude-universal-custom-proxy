# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.10.0] — 2026-05-20

### Changed (breaking)

- **Model catalog rebuilt from live, verified data.** Every model is now sourced
  by querying each provider's own `/v1/models` endpoint and probing a 1-token
  chat completion per model (`scripts/probe-models.mjs`,
  `scripts/generate-registry.mjs`). Speculative / unverifiable model ids from
  earlier versions were removed. The catalog is **193 aliases**:
  - **Ollama Cloud — 25** free models (subscription-gated ids that return
    HTTP 403, e.g. `deepseek-v3.2`, `glm-5.1`, `kimi-k2.6`, were excluded).
  - **HuggingFace Inference Router — 125** served chat models. The Router is
    **credit-metered**: calls succeed until your monthly free credit is spent,
    then return HTTP 402 until it resets (or you add billing / HF PRO).
  - **NVIDIA NIM — 38** free chat models (embeddings, rerankers, safety guards,
    OCR/parse, and unreliable/cold endpoints excluded).
  - **5** native Anthropic Claude family models.
- **Single brand alias per model.** Third-party models are advertised as
  `ollama-<name>`, `hf-<name>`, `nim-<name>` (no `claude-` prefix), so Claude
  Desktop's Cowork picker shows them and they're findable by typing the model
  name. The tiered `claude-<tier>-<prov>-<short>` and legacy
  `claude-<prov>-<brand>` alias schemes were removed.
- **`DEFAULT_PROVIDER` defaults to `ollama`**; family fallback defaults are
  `haiku → ollama-gpt-oss-20b`, `sonnet → ollama-qwen3-coder-480b`,
  `opus → ollama-gpt-oss-120b`.

### Removed

- **All MCPB / Claude Desktop extension packaging.** `manifest.json`,
  `scripts/build-mcpb.mjs`, `server/index.mjs` (MCP stdio wrapper), the
  LaunchAgent installer scripts, the `archiver` dependency, and the
  `build:mcpb` / `launch-agent:*` npm scripts are gone. The proxy now runs as a
  plain Node.js HTTP server — `npm start` (or `./start.sh`) is the only entry
  point.

### Added

- `scripts/probe-models.mjs`, `scripts/discover-models.mjs`,
  `scripts/generate-registry.mjs` — maintenance tooling to refresh the catalog
  from live provider data (`npm run models:probe`, `npm run models:discover`).
- A professional **Disclaimer** section in the README (educational/learning
  purpose, no infringement, official Anthropic third-party-integration docs
  followed, third-party access via official APIs and your own keys under each
  provider's Terms of Service).

## [0.9.0] — 2026-05-19

### Fixed

- **The 401 "Your api key: \*\*\*\*ummy is invalid" error** — every non-Anthropic
  alias used to fall through the routing table to `DEFAULT_PROVIDER='deepseek'`
  (which has no API key in most installs), so the gateway's placeholder
  `Bearer dummy-…` header got forwarded to the upstream verbatim. `resolveProvider`
  now looks up `modelRoutes` by the **request alias** first (the only key the
  route table actually carries), falling back to the upstream id, then to
  `defaultProvider`.
- **`defaultProvider` auto-fallback at startup** — if the configured (or
  hardcoded) default has no API key, the proxy now picks the first provider
  that does, in priority order: `ollama → huggingface → nvidia → openai →
  gemini → qwen → glm → moonshot → xiaomi → anthropic → deepseek`. Prints a
  warning when this kicks in.
- **DeepSeek (and Llama / Qwen / Phi / Mistral / etc.) visibility in Claude
  Desktop's picker** — the picker hides `claude-*` ids containing a foundation
  model brand keyword. Every model from Ollama Cloud / HuggingFace Router /
  NVIDIA NIM now has a brand alias (`ollama-deepseek-v3.1`, `nim-deepseek-r1`,
  `hf-deepseek-r1`, …) that bypasses the filter, so typing "deepseek" in the
  picker now finds all 17 DeepSeek variants across the three providers.

### Added

- **Single source of truth model registry** — `PROVIDER_MODELS` + 
  `ANTHROPIC_COMPAT_MODELS` + `OPENAI_COMPAT_MODELS` + `NATIVE_ANTHROPIC_MODELS`.
  `DEFAULT_MODEL_MAP` / `DEFAULT_MODEL_ROUTES` / `DEFAULT_MODEL_ALIASES` /
  `DEFAULT_VISIBLE_MODELS` / `DEFAULT_HIDDEN_ALIASES` all derive from it at
  module load. Adding a new model means editing one place.
- **Three-alias scheme** for every picker-sensitive provider model:
  1. Brand alias (visible): `ollama-deepseek-v3.1`, `nim-deepseek-r1`,
     `hf-deepseek-r1` — survives the picker brand filter.
  2. Tiered alias (visible): `claude-opus-ol-ds-v3.1`,
     `claude-opus-nv-ds-r1`, `claude-opus-hr-ds-r1` — carries Claude's
     haiku/sonnet/opus tier signal via 2-letter codes that bypass the filter.
  3. Legacy `claude-<prov>-<brand>` alias (hidden): routable for back-compat
     with existing `.env` configs and Claude Code CLI integrations, but not
     advertised in `/v1/models` since the picker would drop it anyway.
- **Claude family fallback resolver** (re-added) — dated names like
  `claude-haiku-4-5-20251001` and bare `claude-haiku-4-5` re-route to
  `claudeFamilyFallback.haiku` (default: `ollama-qwen3-coder-next`) when
  `ANTHROPIC_API_KEY` is empty.
- **End-to-end mock test** (`test/e2e-routing.test.mjs`) — spins up 11 mock
  upstream servers, sends Claude Desktop-style `Bearer dummy-…` requests for
  every alias in the registry, asserts the right provider received it with
  the real key substituted. **276 aliases verified.**
- **Real-upstream smoke script** (`scripts/real-upstream-smoke.mjs`, not run
  by `npm test`) — sends one tiny prompt per free-tier provider to confirm
  end-to-end production behavior.

### Changed (breaking — but legacy aliases keep routing)

- `DEFAULT_PROVIDER` now defaults to `ollama` (was `deepseek`), reflecting
  the most common setup.
- `REWRITE_RESPONSES` now defaults to `true`. Claude Desktop's gateway
  prefers seeing the requested alias in `response.model` so it doesn't lose
  messages when the upstream id isn't in its catalog.
- Native `claude-*` family models now total 5 (`claude-haiku-4-5`,
  `claude-sonnet-4-5`, `claude-sonnet-4-6`, `claude-opus-4-1`,
  `claude-opus-4-7`). The generic `claude-haiku` / `claude-sonnet` /
  `claude-opus` aliases were removed — they pointed at `deepseek` (which has
  no key in most installs) and were a 401 trap.
- `proxy.mjs` was reformatted from one-line dense code to multi-line with
  section dividers and inline documentation.

### Migration

Existing `.env` configs and Claude Code CLI integrations using
`claude-ollama-*` / `claude-hf-*` / `claude-nim-*` aliases keep working — they
route to the same upstream as the new brand aliases. They're just hidden from
`/v1/models` now because Claude Desktop's picker filters them out anyway.

## [0.6.0] — 2026-05-19

### Fixed (actually, this time)

- **All 116 aliases now visible in Claude Desktop's Cowork 3P picker** by
  following the [wanghao9610/claude-model-proxy](https://github.com/wanghao9610/claude-model-proxy)
  pattern: every non-Claude-family alias is advertised under its real
  upstream model name without a `claude-` prefix. v0.5.1 (display_name
  sanitization) and v0.5.2 (`anthropic/<provider>/<model>` gateway ids)
  both failed empirically — the picker filter is on the **id** (not
  display_name), and it rejects both the `claude-*` prefixed namespace
  (when the id contains a foundation-model brand keyword) AND the
  `anthropic/*` namespace entirely.

### Changed (breaking — but legacy aliases keep working)

- **`/v1/models` now advertises 116 ids in the form**
  `deepseek-v4-flash`, `kimi-k2.6`, `glm-4.6`, `gpt-5.5`,
  `gemini-2.5-pro`, `qwen-max`, `ollama-gpt-oss-20b`, `hf-llama-3.1-8b`,
  `nim-llama-3.1-8b`, etc. Only `claude-haiku-*`, `claude-sonnet-*`,
  `claude-opus-*` keep the `claude-` prefix because they really are
  Claude models.
- `DEFAULT_MODEL_MAP`, `DEFAULT_MODEL_ROUTES`, `DEFAULT_MODEL_ALIASES`,
  and `DEFAULT_CLAUDE_FAMILY_FALLBACK` are all rekeyed to the new ids.
- `display_name` is now the same as `id` (the upstream names are
  already human-readable), matching the reference project. Drops the
  cosmetic `toModelDisplayName` transform from v0.5.0–v0.5.2.

### Added

- **`LEGACY_CLAUDE_ALIASES`** export — a 111-entry map of every
  previous `claude-<provider>-<model>` alias to its v0.6.0 id.
  `resolveModelForUpstream` rewrites legacy aliases at request time, so
  existing user `.env` configs, the Claude Code CLI, and pinned MCPB
  installs keep routing to the same upstream without any user change.
- New test `legacy claude-* aliases still route to the same upstream as
  their v0.6.0 id` pins this contract.

### Removed

- All v0.5.2 gateway-id infrastructure (`COWORK_PICKER_BLOCKED_SUBSTRINGS`,
  `GATEWAY_PROVIDER_NAMES`, `GATEWAY_MODEL_REPLACEMENTS`,
  `CLAUDE_ALIAS_PROVIDER_PREFIXES`, `toGatewayId`, `buildGatewayMaps`,
  `gatewayToClaudeAlias` reverse-lookup). The `anthropic/<provider>/<model>`
  approach turned out to be filtered just as aggressively as `claude-*`.
- The v0.5.1 `PICKER_FRIENDLY_DISPLAY_REPLACEMENTS` substitution table —
  display_name was never the filter axis.

### Migration

If your `.env` or MCPB install dialog contains `CLAUDE_HAIKU_MODEL`,
`CLAUDE_SONNET_MODEL`, `CLAUDE_OPUS_MODEL`, or
`ANTHROPIC_DEFAULT_*_MODEL` values like `claude-ollama-qwen3-coder-next`,
they continue to work via the legacy alias map but the canonical form is
now the no-prefix `ollama-qwen3-coder-next`. Updating is optional.

### Tests

- 36 cases, all passing.

## [0.5.1] — 2026-05-18

### Fixed

- **All 116 aliases now visible in Claude Desktop's Cowork 3P picker.** The
  picker silently filters any `/v1/models` entry whose `display_name`
  contains a foundation-model brand keyword. After the v0.5.0 catalog grew
  to 116 entries, only 11 survived the filter: the five native Claude
  family aliases (`Haiku 4.5`, `Sonnet 4.5/4.6`, `Opus 4.1/4.7`), the two
  short DSV4 aliases (`Dsv4 Flash/Pro`), and four NIM models whose product
  names happen to not be a generic brand keyword (`Nim Codestral 22b`,
  `Nim Palmyra Creative 122b`, `Nim Qwq 32b`, `Nim Usdcode 70b`). The fix
  rewrites the affected keywords only in `display_name` via a small
  substitution table (`Llama → Lma`, `Deepseek → DSeek`, `Phi → MsP`,
  `Qwen → Qn`, `Gemma → Gma`, `Granite → Gnt`, `Mistral → Mtl`,
  `Mixtral → Mxl`, `Nemotron → Nem`, `Yi → Y1`, `Kimi → Km`, `Glm → ZAi`,
  `Gpt → Oai`, `Gemini → Ggm`, `Mimo → Mm`, `Ollama → Oc`, `Hf → Hr`).
  Model `id` is intentionally **not** changed — existing `.env`
  configurations, `ANTHROPIC_DEFAULT_*_MODEL` env vars, and the Claude
  Code CLI's `/model` picker continue to accept the original names.

### Tests

- New `/v1/models display_name omits brand keywords the Cowork picker
  filters` case asserts every default alias has a picker-safe
  `display_name` and pins the high-value replacements. Suite is **35
  cases**, all passing.

## [0.5.0] — 2026-05-17

### Renamed

- Project renamed to **`claude-universal-custom-proxy`** across
  `package.json`, `manifest.json`, the MCPB extension display name, the
  `SERVER_NAME` constant, all log prefixes, and the README. The Python
  ASGI predecessor under the same GitHub repo is preserved on the
  `python-archive` branch and the `v0.1.0-python` tag.

### Added

- **NVIDIA NIM provider** wired up at
  `https://integrate.api.nvidia.com/v1` with `NVIDIA_API_KEY` (and
  `NVAPI_KEY` / `NIM_API_KEY` aliases). Sign up free at
  [build.nvidia.com](https://build.nvidia.com/).
- **36 `claude-nim-*` aliases** spanning Meta Llama 3.1 / 3.3 / 4
  (Maverick + Scout), NVIDIA Nemotron Nano / Super / 70B / 340B,
  DeepSeek R1 / R1-distill / V3.1 / V3.2 / V4 (Flash + Pro), Qwen 2.5
  Coder / 2.5 / 3, QwQ-32B, Mixtral 8x7B / 8x22B, Codestral 22B,
  Mistral 7B / Nemo 12B, Phi-3 medium / Phi-3.5 mini / Phi-4,
  Gemma 2 9B / 27B, IBM Granite 3.1 8B, Palmyra Creative 122B,
  Yi-Large, NVIDIA USDCode Llama 3.1 70B.
- **`nvidia_base_url` and `nvidia_api_key` fields in the MCPB install
  dialog** so a single MCPB install can wire NVIDIA NIM alongside
  Ollama Cloud and Hugging Face.
- **Integration tests** for the new provider: bundled-alias routing
  end-to-end, and `NVAPI_KEY` / `NIM_API_KEY` env-alias resolution.
  Full suite is now 34/34 on Node 20.

### Restored

- **18 `claude-hf-*` aliases bundled by default** (had been
  empirically trimmed in v0.4.3). Together with the existing 30
  `claude-ollama-*` aliases and the new 36 `claude-nim-*` aliases,
  the default `/v1/models` catalog ships **116 models**.

### Changed

- `claude_haiku_model`, `claude_sonnet_model`, `claude_opus_model`
  fallback defaults are now `claude-hf-llama-3.1-8b`,
  `claude-hf-qwen-2.5-coder-32b`, `claude-hf-qwen3-coder-480b`
  respectively — a tool-trained HF lineup that handles Claude
  Desktop's elaborate system prompt cleanly.
- README catalog section rewritten to enumerate all 116 aliases
  grouped by family.

## [0.4.3] — 2026-05-16

### Reverted (empirical trim)

- **Bundled `claude-hf-*` aliases removed.** All 22 HuggingFace Router
  aliases that were shipped in `DEFAULT_MODEL_MAP` / `DEFAULT_MODEL_ALIASES`
  / `DEFAULT_MODEL_ROUTES` are gone. Default catalog drops from **84 → 62
  models** — exactly the count that worked in commit 6315023, the last
  known-good Cowork / Code picker state. Goal: empirically verify whether
  Claude Desktop's gateway picker has a catalog-count threshold that
  triggers the truncated "5 native + 2 sibling" hardcoded list.
- This is a **trial release**. If the picker now shows the full 62 in
  both Cowork and Claude Code, we'll re-add HF in batches of ~5 aliases
  to find the threshold.

### Kept

- `huggingface` provider configuration in `loadConfig` (URL + key + format
  + auth scheme). Users who want HF back can add aliases via env overrides:

  ```bash
  MODEL_MAP='{"claude-hf-deepseek-r1":"deepseek-ai/DeepSeek-R1"}'
  MODEL_ROUTES='{"claude-hf-deepseek-r1":"huggingface"}'
  ```

- `HUGGINGFACE_API_KEY` / `HF_API_KEY` / `HF_TOKEN` env-var precedence.
- `HUGGINGFACE_BASE_URL` / `HF_BASE_URL` env-var precedence.
- `huggingface_base_url` / `huggingface_api_key` fields in `manifest.json`
  install dialog.
- All other providers (Ollama Cloud, DeepSeek, Moonshot, GLM, Xiaomi MiMo,
  OpenAI, Gemini, Qwen, Anthropic) unchanged.

### Tests

- HF routing + SSE tests now build the alias via runtime `MODEL_MAP`
  overrides rather than relying on the bundled defaults; they continue to
  verify the HF code path end-to-end.
- New test `/v1/models does NOT include claude-hf-* aliases by default`
  pins the trim.
- 81 cases, all passing.

## [0.4.2] — 2026-05-15

### Reverted

- **`GET /` and `HEAD /` local probe handler** (added in 0.3.1) is removed.
  At 0.2.0 (commit 6315023) the root requests were forwarded upstream and
  returned 405; that was working for both Claude Desktop pickers. Adding a
  200 JSON response at `/` was an unnecessary change relative to the known-
  good baseline and is rolled back in case it was the source of regression.

### Goal

This release brings `proxy.mjs` **functionally character-identical** to the
last known-good commit 6315023 for every code path Claude Desktop and Claude
Code touch: model dispatch, `/v1/models`, `/v1/models/{id}`, `/v1/messages`,
`/v1/messages/count_tokens`, `/healthz`, smart model resolution, family
fallback, OpenAI-chat adapter, SSE conversion. The only deltas vs 6315023
are the additive ones we explicitly want to keep:

- **HuggingFace Inference Router** provider + 22 `claude-hf-*` aliases.
- **`REWRITE_RESPONSES` default** flipped from `true` to `false`.

### Tests

- Removed 2 root-handler tests (`GET /`, `HEAD /`).
- Removed the duplicate `?limit`-iterating test added in 0.4.1; the
  existing `serves configured model list for Claude Code and SDK discovery`
  test (carried forward from 0.2.0) now also asserts the HF aliases are
  present in `/v1/models`.
- Suite is **49 cases**, all passing.

## [0.4.1] — 2026-05-15

### Reverted

- **`/v1/models` pagination** (added in 0.3.1) is removed. The endpoint now
  always returns the entire catalog with `has_more: false`, ignoring the
  `?limit`, `?after_id`, and `?before_id` query parameters. Empirically, the
  partial responses we sent for `?limit=1` probes caused both Claude Desktop's
  Gateway picker and Claude Code's `/model` picker to display a truncated
  model list. This is the same shape that worked in 0.2.0 (commit 6315023)
  and is the only behaviour that's been verified to work end-to-end.
- **The 16 tier-prefixed aliases** (added in 0.4.0) are removed. They were
  introduced based on the wrong hypothesis that Cowork filters models by
  `claude-(haiku|sonnet|opus)-*` prefix; in practice Cowork's picker showed
  every Claude alias at 0.2.0, including `claude-ollama-*` and others. The
  picker truncation we observed turned out to be downstream of the
  pagination regression, not the alias naming. Removing these clutter
  entries also gets the default catalog back to a clean 84 models.

### Kept

- HuggingFace Inference Router provider and 22 `claude-hf-*` aliases.
- Local `POST /v1/messages/count_tokens` handler (heuristic estimate).
- `GET /` and `HEAD /` local probe handler.
- Claude family fallback for dated Claude model names.
- `/v1/v1/...` path-duplication guard.
- `REWRITE_RESPONSES` defaulting to `false`.

### Tests

- 6 tests removed (4 pagination + 3 tier-alias) and 1 added (a single
  parametrised test asserting `/v1/models` returns the full catalog for
  every `?limit` value clients are known to send). Suite is **52 cases**,
  all passing.

## [0.4.0] — 2026-05-14

### Added

- **16 tier-prefixed Claude aliases** for Claude Desktop's Cowork 3P picker.
  The Cowork model selector surfaces only models whose id matches
  `claude-(haiku|sonnet|opus)-*`. Tier aliases route to the same Ollama
  Cloud and HuggingFace Router upstreams as the longer `claude-ollama-*` /
  `claude-hf-*` aliases, so Cowork users get a tier-organised picker
  without losing the explicit-provider aliases:

  | Tier | Alias | Upstream |
  | --- | --- | --- |
  | Haiku | `claude-haiku-fast` | `qwen3-coder-next:cloud` (Ollama) |
  | Haiku | `claude-haiku-llama-8b` | `meta-llama/Llama-3.1-8B-Instruct` (HF) |
  | Haiku | `claude-haiku-gpt-oss-20b` | `gpt-oss:20b-cloud` (Ollama) |
  | Haiku | `claude-haiku-phi-4` | `microsoft/phi-4` (HF) |
  | Haiku | `claude-haiku-glm` | `glm-4.7:cloud` (Ollama) |
  | Sonnet | `claude-sonnet-coder` | `qwen3-coder:480b-cloud` (Ollama) |
  | Sonnet | `claude-sonnet-llama-70b` | `meta-llama/Llama-3.3-70B-Instruct` (HF) |
  | Sonnet | `claude-sonnet-deepseek-r1` | `deepseek-ai/DeepSeek-R1` (HF) |
  | Sonnet | `claude-sonnet-glm` | `glm-5.1:cloud` (Ollama) |
  | Sonnet | `claude-sonnet-kimi` | `kimi-k2.6:cloud` (Ollama) |
  | Sonnet | `claude-sonnet-mistral` | `mistralai/Mistral-Large-Instruct-2411` (HF) |
  | Opus | `claude-opus-gpt-oss-120b` | `gpt-oss:120b-cloud` (Ollama) |
  | Opus | `claude-opus-kimi-1t` | `kimi-k2:1t-cloud` (Ollama) |
  | Opus | `claude-opus-deepseek-pro` | `deepseek-v4-pro:cloud` (Ollama) |
  | Opus | `claude-opus-llama-405b` | `meta-llama/Llama-3.1-405B-Instruct` (HF) |
  | Opus | `claude-opus-qwen-coder-480b` | `Qwen/Qwen3-Coder-480B-A35B-Instruct` (HF) |

  `/v1/models` now lists 100 default aliases (up from 84).

### Behaviour

- The new aliases route directly to their target provider in
  `DEFAULT_MODEL_ROUTES` (`ollama` or `huggingface`, never `anthropic`).
  This means `resolveModelForUpstream` short-circuits on the exact match
  and the Claude family fallback never engages for tier-prefixed aliases —
  the user gets the actual model they picked, not the configured Haiku /
  Sonnet / Opus fallback.

### Tests

- Suite expanded from 55 to **58** cases. New coverage:
  - All 16 tier aliases exist with the documented upstream id and route.
  - `resolveModelForUpstream` returns the exact upstream for each tier
    alias even when `ANTHROPIC_API_KEY` is empty (regression guard for
    family-fallback interception).
  - Dated tier aliases (e.g. `claude-sonnet-coder-20260514`) resolve via
    the date-stripping path.
  - `/v1/models` (the Cowork picker source) exposes all 16 new aliases.

## [0.3.1] — 2026-05-14

### Fixed

- **Anthropic-spec pagination on `/v1/models`.** Earlier releases ignored the
  `limit`, `after_id`, and `before_id` query parameters and always returned
  the full 84-entry catalog with `has_more: false`. Strict clients such as
  Claude Desktop probe with `?limit=1` first to decide whether to paginate,
  and could end up displaying only a subset of the catalog. The endpoint
  now honors `limit` (1–1000, default 1000), `after_id` (forward cursor),
  `before_id` (backward cursor), and reports `has_more` accurately.
- **`GET /` and `HEAD /` are now answered locally.** Previously they were
  forwarded to the default provider's base URL, which returned a confusing
  `405 Method Not Allowed`. The proxy now returns a small JSON status
  document with the service name, version, and known endpoints. Standalone
  agent SDKs (Bun-based clients) probing the gateway root see a clean 200.
- **`/v1/models/{id}` 404 response shape** now matches Anthropic's
  `{ "type": "error", "error": { "type": "not_found_error", "message": "..." } }`
  envelope.

### Changed

- `SERVER_NAME` and `SERVER_VERSION` are exported from `proxy.mjs` and
  re-exported by `server/index.mjs`. The manifest parity test now reads them
  from the canonical location.

### Tests

- Suite expanded from 48 to **55** cases. New coverage:
  - `?limit=1` returns exactly one model with `has_more=true`.
  - `?limit=1000` returns the full catalog with `has_more=false`.
  - Default `limit` returns the full catalog.
  - Absurd `?limit=999999` is clamped to 1000 without error.
  - `?after_id` and `?before_id` cursor pagination through the catalog.
  - `/v1/models/{unknown-id}` returns the Anthropic-shaped error envelope.
  - `GET /` and `HEAD /` are answered locally and never forwarded upstream.

## [0.3.0] — 2026-05-13

### Added

- **HuggingFace Inference Router** as a first-class provider. 22 new
  `claude-hf-*` aliases covering Llama 3.1/3.3, Qwen 2.5/3, DeepSeek V3/V3.1/R1,
  Mistral Large/Mixtral/Mistral 7B, Gemma 2, Phi-4/Phi-3-medium, Command R+,
  Yi 1.5, and Nemotron 70B. One HF token gives access to Together, Fireworks,
  HF Inference, Hyperbolic, SambaNova, Novita, and Nebius via HF Router's
  auto-routing.
- MCPB install dialog gains `HuggingFace Router Base URL` and
  `HuggingFace API Token` fields.
- `HUGGINGFACE_API_KEY` env var with `HF_API_KEY` and `HF_TOKEN` accepted as
  aliases.
- LICENSE (MIT), SECURITY.md, CHANGELOG.md, CONTRIBUTING.md.
- Professional README with architecture diagram, security section, and full
  configuration reference.

### Changed

- **`REWRITE_RESPONSES` default flipped from `true` to `false`.** Upstream
  model ids now pass through unchanged in response bodies and SSE streams by
  default. Opt back into Claude-alias rewriting with `REWRITE_RESPONSES=true`.
- Manifest, `package.json`, and `server/index.mjs` `SERVER_VERSION` bumped to
  `0.3.0`.
- `/v1/models` now lists 84 default aliases (up from 62).

### Tests

- Suite expanded from 46 to **48** cases. New coverage:
  - `REWRITE_RESPONSES` default + explicit opt-in / opt-out.
  - End-to-end pass-through of upstream model ids when `rewriteResponses=false`.

## [0.2.0] — 2026-05-13

### Added

- **Smart Claude model resolution.** Date-suffixed aliases such as
  `claude-haiku-4-5-20251001` are stripped before lookup and, when
  `ANTHROPIC_API_KEY` is empty, routed through a configurable Haiku / Sonnet /
  Opus family fallback (`CLAUDE_HAIKU_MODEL`, `CLAUDE_SONNET_MODEL`,
  `CLAUDE_OPUS_MODEL`).
- **Local `POST /v1/messages/count_tokens`** answered with a deterministic
  character heuristic, so Anthropic-only endpoints don't fail against
  OpenAI-shape upstreams.
- `default_provider`, `claude_haiku_model`, `claude_sonnet_model`,
  `claude_opus_model` fields in the MCPB install dialog.
- Anthropic-compatible `/v1/models` response shape (`id`, `type`,
  `display_name`, `created_at`) so Claude Desktop's "fetch from gateway"
  populates the model dropdown automatically.

### Fixed

- **`/v1/v1/messages/count_tokens` 404.** `buildTargetUrl` now strips a
  leading `/v1` from the source path when the upstream base URL ends in
  `/v1`, preventing path duplication for Ollama Cloud, HuggingFace Router,
  Gemini, and Qwen.
- Dated Claude model names (`claude-haiku-4-5-20251001`) no longer 404 at
  Ollama Cloud — they're resolved to the family fallback before forwarding.

### Tests

- Suite expanded from 17 to 42 cases.

## [0.1.0] — 2026-05-12

### Added

- Initial public release.
- Routing for DeepSeek, Moonshot/Kimi, GLM, Xiaomi MiMo, OpenAI, Gemini,
  Qwen, Ollama Cloud (Turbo), and Anthropic.
- Anthropic Messages-compatible inbound surface.
- OpenAI Chat Completions ↔ Anthropic Messages adapter (JSON + streaming SSE).
- MCPB packaging for Claude Desktop on Windows and macOS.
- MCP `model_proxy_status` stdio tool exposed by the bundled server.
- macOS LaunchAgent installer (`npm run launch-agent:install`).
