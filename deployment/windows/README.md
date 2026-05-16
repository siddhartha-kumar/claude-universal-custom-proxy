# Windows Service Deployment

Run the gateway as a Windows service using
[NSSM](https://nssm.cc) (Non-Sucking Service Manager). NSSM wraps the
uvicorn ASGI server in a long-running service with log rotation and
automatic restart.

## Prerequisites

- Python 3.12+ installed and on PATH.
- A project virtualenv at `<repo>\.venv` with the gateway installed:
  ```powershell
  python -m venv .venv
  .venv\Scripts\python -m pip install -e .
  ```
- NSSM available on PATH, or downloaded and the path passed with
  `-NssmPath`.
- A populated `.env` file with `GATEWAY_API_KEYS` and provider tokens, or
  the equivalent values configured as machine-level environment
  variables.

## Install

Run from an elevated PowerShell prompt:

```powershell
cd <repo>
.\deployment\windows\install-service.ps1
```

Optional parameters:

```powershell
.\deployment\windows\install-service.ps1 `
    -ServiceName ClaudeUniversalCustomProxy `
    -Host 0.0.0.0 `
    -Port 8080 `
    -NssmPath C:\Tools\nssm\win64\nssm.exe
```

## Manage

```powershell
Start-Service  ClaudeUniversalCustomProxy
Stop-Service   ClaudeUniversalCustomProxy
Get-Service    ClaudeUniversalCustomProxy
Restart-Service ClaudeUniversalCustomProxy
```

## Logs

Logs are written to `<repo>\logs\stdout.log` and `<repo>\logs\stderr.log`
with a 10 MiB rotation threshold.

## Uninstall

```powershell
nssm stop ClaudeUniversalCustomProxy confirm
nssm remove ClaudeUniversalCustomProxy confirm
```

## Security

- Run the service under a dedicated low-privilege Windows account, not
  `LocalSystem`. Set the account in `services.msc` after install or via
  `nssm set ClaudeUniversalCustomProxy ObjectName DOMAIN\user password`.
- Restrict NTFS permissions on `.env` so only the service account can
  read it.
- Front the service with a TLS-terminating reverse proxy such as IIS,
  nginx for Windows, or Caddy.
