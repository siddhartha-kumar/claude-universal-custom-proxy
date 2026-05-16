# PowerShell Examples

Windows-native PowerShell scripts that exercise the gateway without
requiring Git Bash, WSL, or curl.

## Configuration precedence

Each script resolves credentials in this order, stopping at the first
hit:

1. `$env:OPENAI_COMPATIBLE_API_KEY` set in the current PowerShell session.
2. A persistent user-scope variable picked up by a fresh PowerShell.
3. `GATEWAY_API_KEYS` from `.env` in the current working directory.
4. `GATEWAY_API_KEYS` from `.env` at the repository root (two levels above
   the script).

You only need step 3 or 4 for a zero-configuration first run from the
repo root.

`OPENAI_COMPATIBLE_BASE_URL` defaults to `http://localhost:8080/v1` and
`OPENAI_COMPATIBLE_MODEL` defaults to `ollama-cloud/gemma3:4b`. Override
either by setting the corresponding `$env:...` value before running the
script.

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
