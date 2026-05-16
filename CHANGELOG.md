# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
