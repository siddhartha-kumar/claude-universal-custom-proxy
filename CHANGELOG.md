# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Anthropic Messages API endpoint at `POST /v1/messages`**, giving
  the gateway full protocol-level compatibility with Claude Code,
  Claude Desktop, and any client built on the Anthropic SDK. Includes
  bidirectional translation between Anthropic and OpenAI shapes for
  requests, responses, and streaming SSE; system-prompt extraction;
  content-block (text, image, tool_use, tool_result) conversion;
  finish-reason mapping (`stop` ↔ `end_turn`, `length` ↔ `max_tokens`,
  `tool_calls` ↔ `tool_use`); and Anthropic SSE event re-emission
  (`message_start`, `content_block_start`, `content_block_delta`,
  `content_block_stop`, `message_delta`, `message_stop`).
- `x-api-key` header support in the auth middleware. Anthropic SDKs
  authenticate this way; the existing `Authorization: Bearer` scheme
  for OpenAI-compatible clients continues to work.
- `anthropic_default_model` configuration field (also settable via the
  `GATEWAY_ANTHROPIC_DEFAULT_MODEL` env var) that maps `claude-*`
  model ids with no matching route to a fallback gateway model.
  Default in `config/default.yaml` is `ollama-cloud/gemma3:4b`.
- 15 unit tests for the translator (request/response/stream shape
  conversions, error paths) and 6 integration tests for `/v1/messages`
  (round-trip, x-api-key auth, streaming, default-model fallback,
  validation error, model_not_found when fallback disabled).

### Changed
- SETUP.md Step 7-B and Step 11 rewritten to use the now-supported
  `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` env vars for Claude Code,
  with a heads-up clarifying that the `OPENAI_COMPATIBLE_*` convention
  is for *other* OpenAI-compatible clients (Continue, Cline, Cursor,
  LM Studio, OpenAI SDK) — not Claude Code itself.
- README hero matrix now lists both protocol surfaces explicitly.

### Added
- Community files: `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`,
  issue templates, pull request template.
- Python client example under `examples/python/`.
- CodeQL configuration and `CODEOWNERS`.
- Additional coverage tests for middleware, provider retries, and the model
  registry merge behavior.
- Cross-platform tooling: PowerShell example clients, NSSM-based Windows
  service installer, macOS launchd plist, `.gitattributes` for consistent
  line endings.
- `docs/platforms.md` with per-OS install, run, env-var, and service
  registration recipes.
- **`SETUP.md`** — a beginner-friendly, step-by-step setup guide covering
  prerequisites, install, configuration, verification, Claude Code wiring,
  and troubleshooting for Windows, macOS, Linux, and Docker.
- `SETUP.md` Step 10: dedicated section on monitoring the running
  gateway, with copy-paste `/health`, `/ready`, `/metrics`, and watch-loop
  commands per OS, plus a symptom-to-fix decision matrix.
- `SETUP.md` Step 11: switching Claude Code between the gateway and its
  default Anthropic-backed mode, listing available models, and switching
  models mid-session via the `/model` slash command.
- `SETUP.md` Troubleshooting expanded with the most common 401 cause
  (placeholder gateway key versus real `.env` value), PowerShell
  execution-policy at script invocation time, and the desktop-app
  env-var caching pitfall.
- `SETUP.md` Step 11-B restructured into three explicit, numbered
  steps for reverting Claude Code to its default Anthropic-backed
  mode, including a `/status` verification step.
- `SETUP.md` Step 11-C rewritten to document dynamic model discovery
  via `/v1/models`, confirming that the gateway exposes the full
  ~180-entry catalog (Ollama Cloud + Hugging Face + OpenAI-shaped
  providers) so any OpenAI-compatible client picker sees them
  automatically.
- `SETUP.md` Step 11-F added: curating which models appear in
  Claude Code's picker via `enabled`, `supports_models`, and
  `static_models` in `config/default.yaml`, while preserving routing
  for any valid model id.
- `SETUP.md` Step 7-Pre added: enabling third-party inference /
  developer mode inside Claude Code, both via the Settings UI and
  via `~/.claude/settings.json`. Without this toggle, Claude Code
  silently ignores the `OPENAI_COMPATIBLE_*` env vars. Cross-linked
  from Step 7-C and from two new Troubleshooting and decision-tree
  entries so the symptom-first reader also finds the fix.

### Changed
- Example scripts (`chat`, `stream`, `models` in PowerShell, curl, and
  Python) now auto-resolve `OPENAI_COMPATIBLE_API_KEY` from `.env`
  when the environment variable is unset. Precedence: env var first,
  then `./.env`, then `<repo-root>/.env`. The hard requirement on the
  env var is removed; a clear error message fires only when neither
  the env var nor `.env` provides a key.
- Updated example READMEs and SETUP.md Step 7-E / Troubleshooting
  callouts to reflect the new precedence.
- Default model in the example scripts changed from
  `ollama-local/llama3.2` (requires a local Ollama install) to
  `ollama-cloud/gemma3:4b` (works as long as `OLLAMA_CLOUD_API_KEY`
  is configured).

### Changed
- Renamed the project, repository, distribution package, and Docker image to
  `claude-universal-custom-proxy` to reflect the Claude Code compatibility
  focus. The Python module path remains `llm_proxy_gateway` for import
  stability.

## [0.1.0] - 2026-05-17

### Added
- OpenAI-compatible `/v1/chat/completions`, `/v1/images/generations`,
  `/v1/models`, `/health`, `/ready`, and `/metrics` endpoints.
- Prefix-based routing for OpenAI, DeepSeek, Perplexity, Kimi, Z.AI, the
  Hugging Face Router, local Ollama, and Ollama cloud.
- Streaming passthrough for OpenAI-compatible providers and OpenAI-shaped SSE
  transformation for Ollama.
- Dynamic model registry with static fallback and graceful provider failures.
- Authentication, rate limiting, body size limits, security headers, and
  SSRF-validated provider URLs.
- Structured JSON logging with request correlation IDs and provider metrics.
- Docker, docker-compose, nginx, systemd, pre-commit, ruff, black, isort,
  mypy, pytest, coverage, bandit, pip-audit, dependabot, and release
  automation.

[Unreleased]: https://github.com/siddhartha-kumar/claude-universal-custom-proxy/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/siddhartha-kumar/claude-universal-custom-proxy/releases/tag/v0.1.0
