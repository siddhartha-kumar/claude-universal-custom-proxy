# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Anthropic Messages API support (Claude Code, Claude Desktop)
- New endpoint `POST /v1/messages` accepting the Anthropic Messages
  API shape, with full bidirectional translation to the existing
  OpenAI Chat Completions pipeline. Covers system-prompt extraction,
  text and image content blocks (base64 → data URL, url passthrough),
  `tool_use` and `tool_result` block translation, `tools` /
  `tool_choice` mapping, `stop_sequences` → `stop`, finish-reason
  mapping (`stop` ↔ `end_turn`, `length` ↔ `max_tokens`, `tool_calls`
  ↔ `tool_use`), and usage field rename
  (`prompt_tokens` → `input_tokens`,
  `completion_tokens` → `output_tokens`).
- Anthropic SSE event re-emission for streaming responses
  (`message_start`, `content_block_start`, `content_block_delta`,
  `content_block_stop`, `message_delta`, `message_stop`) so Claude
  Code parses the stream natively.
- `x-api-key` header support in the auth middleware. Anthropic SDKs
  authenticate this way; the existing `Authorization: Bearer` scheme
  for OpenAI-compatible clients continues to work.
- `anthropic_default_model` configuration field (also settable via the
  `GATEWAY_ANTHROPIC_DEFAULT_MODEL` env var) that maps `claude-*`
  model ids with no matching route to a fallback gateway model.
  Default in `config/default.yaml` is `ollama-cloud/gemma3:4b`.
- 21 new tests: 15 unit tests for the translator (request, response,
  stream-shape conversions, error paths) and 6 integration tests for
  `/v1/messages` (round-trip, `x-api-key` auth, streaming SSE
  emission, default-model fallback, validation error, and
  `model_not_found` when fallback is disabled).

#### Onboarding and operations docs
- `SETUP.md` — single-file, step-by-step setup walkthrough for
  Windows, macOS, Linux, and Docker. Covers prerequisites, install,
  `.env`, start, verify, Claude Code wiring, optional provider keys,
  long-term service install, monitoring, and revert. Linked
  prominently from the README hero, the quick-start callout, and the
  documentation index.
- `SETUP.md` Step 7-Pre on enabling developer mode / third-party
  inference inside Claude Code (UI toggle and
  `~/.claude/settings.json`).
- `SETUP.md` Step 10 on monitoring the running gateway with
  `/health`, `/ready`, `/metrics`, a continuous-watch loop, and a
  symptom-to-fix decision matrix.
- `SETUP.md` Step 11 on switching Claude Code between the gateway and
  its default Anthropic-backed mode, including a three-step revert,
  the `/model` slash command for mid-session switching, and curating
  the picker via `static_models` in `config/default.yaml`.

#### Cross-platform tooling
- PowerShell client examples under `examples/powershell/`
  (`chat.ps1`, `stream.ps1`, `models.ps1`) with native SSE handling.
- NSSM-based Windows service installer under
  `deployment/windows/install-service.ps1`.
- macOS `launchd` plist and per-user-agent / system-daemon install
  instructions under `deployment/launchd/`.
- `docs/platforms.md` collecting per-OS install, run, env-var, and
  service registration recipes.
- `.gitattributes` normalizing line endings (`.ps1` keeps CRLF, the
  rest stays LF).

#### Community and quality scaffolding
- `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`,
  `CHANGELOG.md`, `CODEOWNERS`, GitHub issue templates, pull request
  template, and a CodeQL configuration that runs the
  `security-extended` and `security-and-quality` query suites
  against `src/`.
- Python client examples under `examples/python/`
  (`chat_completion.py`, `stream_chat.py`, `list_models.py`) with a
  shared `_common.py` resolver.
- `examples/curl/models.sh` for OpenAI-surface model discovery.
- Compose stack `deployment/docker-compose.ollama.yml` that boots the
  gateway alongside a containerized local Ollama.
- Additional test coverage for middleware, observability, and
  provider retry behaviour (coverage rose from 87% to 89% pre-feature
  and stayed at 88.54% after the Anthropic addition).

### Changed
- Project, repository, distribution package, Docker image, systemd
  paths, and application display name renamed to
  `claude-universal-custom-proxy`. The Python module path stays
  `llm_proxy_gateway` so existing imports keep working.
- Example scripts (PowerShell, curl, Python) now auto-resolve
  `OPENAI_COMPATIBLE_API_KEY` from `.env` when the environment
  variable is unset. Precedence: env var, then `./.env`, then
  `<repo-root>/.env`. The hard env-var requirement is gone; a clear
  error fires only when neither source provides a key. Default model
  in the example scripts moved from `ollama-local/llama3.2` to
  `ollama-cloud/gemma3:4b`.
- Claude Code wiring documentation in SETUP.md (Step 7-B, Step 11)
  and in `docs/claude-code-integration.md` rewritten to use the
  Anthropic-native `ANTHROPIC_BASE_URL` + `ANTHROPIC_API_KEY` env
  vars, with an explicit heads-up that `OPENAI_COMPATIBLE_*` names
  are honored by other OpenAI-compatible clients (Continue, Cline,
  Cursor, LM Studio, OpenAI SDK) and not by Claude Code itself.
- README architecture diagram split into two client lanes
  (Anthropic-shape and OpenAI-shape), surfaces the `/v1/messages`
  endpoint, and adds a dedicated Anthropic Messages sequence
  diagram.
- README hero matrix entry rewritten to call out the dual-protocol
  surface explicitly.

### Fixed
- README and `docs/claude-code-integration.md` Mermaid blocks that
  previously failed to render on GitHub. `[/text/]` in flowchart
  node labels was parsed as a parallelogram shape (`/health
  endpoint`, `/metrics endpoint`); labels are now quoted. Angle
  brackets in sequence-diagram messages (`<gateway key>`) were
  parsed as HTML tags; replaced with `Bearer gateway-key`.

## [0.1.0] - 2026-05-17

### Added
- OpenAI-compatible `/v1/chat/completions`, `/v1/images/generations`,
  `/v1/models`, `/health`, `/ready`, and `/metrics` endpoints.
- Prefix-based routing for OpenAI, DeepSeek, Perplexity, Kimi, Z.AI,
  the Hugging Face Router, local Ollama, and Ollama cloud.
- Streaming passthrough for OpenAI-compatible providers and
  OpenAI-shaped SSE transformation for Ollama.
- Dynamic model registry with static fallback and graceful provider
  failures.
- Authentication, rate limiting, body size limits, security headers,
  and SSRF-validated provider URLs.
- Structured JSON logging with request correlation IDs and provider
  metrics.
- Docker, docker-compose, nginx, systemd, pre-commit, ruff, black,
  isort, mypy, pytest, coverage, bandit, pip-audit, dependabot, and
  release automation.

[Unreleased]: https://github.com/siddhartha-kumar/claude-universal-custom-proxy/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/siddhartha-kumar/claude-universal-custom-proxy/releases/tag/v0.1.0
