# Platform Guide

Claude Universal Custom Proxy targets identical behavior on Windows,
macOS, and Linux, plus container deployments. This guide collects the
per-platform setup, runtime, and service installation steps.

## Prerequisites

| Platform | Required |
| --- | --- |
| Windows 10/11 | Python 3.12+, PowerShell 5.1+ (or PowerShell 7), git |
| macOS 13+ | Python 3.12+, command line tools, git |
| Linux | Python 3.12+, git, systemd (optional) |
| Container | Docker 24+ or Docker Desktop |

Python 3.12 or newer is required everywhere because the gateway uses
`StrEnum`, `Self`, and PEP 695-friendly typing.

## Install

### Windows (PowerShell)

```powershell
git clone https://github.com/siddhartha-kumar/claude-universal-custom-proxy.git
Set-Location claude-universal-custom-proxy
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
Copy-Item .env.example .env
```

### macOS (zsh/bash)

```bash
git clone https://github.com/siddhartha-kumar/claude-universal-custom-proxy.git
cd claude-universal-custom-proxy
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -e ".[dev]"
cp .env.example .env
```

### Linux

```bash
git clone https://github.com/siddhartha-kumar/claude-universal-custom-proxy.git
cd claude-universal-custom-proxy
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install -e ".[dev]"
cp .env.example .env
```

### Docker (any host)

```bash
docker build -f docker/Dockerfile -t claude-universal-custom-proxy:latest .
docker run --rm -p 8080:8080 --env-file .env claude-universal-custom-proxy:latest
```

## Run

### Windows

```powershell
.venv\Scripts\Activate.ps1
uvicorn llm_proxy_gateway.main:app --host 127.0.0.1 --port 8080
```

### macOS and Linux

```bash
. .venv/bin/activate
uvicorn llm_proxy_gateway.main:app --host 127.0.0.1 --port 8080
```

## Set Environment Variables

### Windows PowerShell (current session)

```powershell
$env:GATEWAY_API_KEYS = "change-this-before-use"
$env:OPENAI_API_KEY   = "sk-..."
```

### Windows PowerShell (persistent for user)

```powershell
[Environment]::SetEnvironmentVariable("GATEWAY_API_KEYS", "change-this-before-use", "User")
```

### macOS and Linux (current shell)

```bash
export GATEWAY_API_KEYS="change-this-before-use"
export OPENAI_API_KEY="sk-..."
```

### macOS and Linux (persistent)

Append to `~/.zshrc` (macOS) or `~/.bashrc` (Linux), then reload the
shell with `exec $SHELL`.

## Service Install

| Platform | Mechanism | Path |
| --- | --- | --- |
| Linux | systemd | `deployment/systemd/llm-gateway.service` |
| macOS | launchd | `deployment/launchd/` |
| Windows | NSSM | `deployment/windows/install-service.ps1` |

Each directory has a dedicated README with copy-paste install commands.

## Smoke Test

The example scripts auto-load `GATEWAY_API_KEYS` from `.env`, so no
explicit env var is needed when running from the repo root.

### Windows PowerShell

```powershell
.\examples\powershell\chat.ps1
```

### macOS and Linux

```bash
./examples/curl/chat.sh
```

### Through Claude Code (Anthropic-shape end-to-end)

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:8080 \
  ANTHROPIC_API_KEY=$(grep '^GATEWAY_API_KEYS=' .env | cut -d= -f2) \
  claude --bare --model "hf/meta-llama/Llama-3.1-8B-Instruct" -p "Reply with: works" --output-format json
```

A successful run returns a JSON envelope with `"is_error": false` and
a populated `"result"` field.

## Known Platform Differences

- `make` is not standard on Windows. Use the PowerShell scripts under
  `scripts/` and `deployment/windows/` instead, or install
  [`make` via chocolatey](https://chocolatey.org/packages/make).
- The default config binds `0.0.0.0`; for local-only Windows usage we
  recommend overriding with `GATEWAY_HOST=127.0.0.1` to avoid Windows
  Firewall prompts.
- Line endings: `.editorconfig` and `.gitattributes` ensure LF endings
  across platforms; if a hook fails on Windows, run
  `git config core.autocrlf input`.
