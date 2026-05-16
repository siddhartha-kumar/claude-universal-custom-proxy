# PowerShell Examples

Windows-native PowerShell scripts that exercise the gateway without
requiring Git Bash, WSL, or curl.

## Prerequisites

```powershell
$env:OPENAI_COMPATIBLE_BASE_URL = "http://localhost:8080/v1"
$env:OPENAI_COMPATIBLE_API_KEY  = "change-this-before-use"
$env:OPENAI_COMPATIBLE_MODEL    = "ollama-local/llama3.2"
```

Optionally persist via `setx` if you do not want to set them every session.

## Scripts

- `chat.ps1` - single chat completion.
- `stream.ps1` - streaming chat completion using SSE.
- `models.ps1` - dynamic model discovery.

Run any script with `pwsh examples/powershell/<script>.ps1` (PowerShell 7+) or
`powershell -File examples/powershell/<script>.ps1` (Windows PowerShell 5.1).

If script execution is blocked, allow signed local scripts for the current
user:

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```
