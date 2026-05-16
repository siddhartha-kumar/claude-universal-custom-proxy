#Requires -Version 5.1
#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Installs the Claude Universal Custom Proxy as a Windows service via NSSM.
.DESCRIPTION
    Wraps the uvicorn ASGI server in a Windows service using NSSM
    (https://nssm.cc). NSSM must be available on PATH or supplied with
    -NssmPath.
.PARAMETER InstallRoot
    Directory containing the project virtualenv at .venv. Defaults to the
    parent of this script.
.PARAMETER ServiceName
    Service name to register. Defaults to ClaudeUniversalCustomProxy.
.PARAMETER NssmPath
    Path to nssm.exe. Defaults to looking up nssm on PATH.
.PARAMETER Host
    Bind address. Defaults to 127.0.0.1.
.PARAMETER Port
    Listen port. Defaults to 8080.
#>
[CmdletBinding()]
param(
    [string]$InstallRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
    [string]$ServiceName = "ClaudeUniversalCustomProxy",
    [string]$NssmPath,
    [string]$Host = "127.0.0.1",
    [int]$Port = 8080
)

$ErrorActionPreference = "Stop"

if (-not $NssmPath) {
    $Resolved = Get-Command nssm -ErrorAction SilentlyContinue
    if (-not $Resolved) {
        throw "NSSM not found on PATH. Download from https://nssm.cc or pass -NssmPath."
    }
    $NssmPath = $Resolved.Source
}

$Uvicorn = Join-Path $InstallRoot ".venv\Scripts\uvicorn.exe"
if (-not (Test-Path $Uvicorn)) {
    throw "uvicorn.exe not found at $Uvicorn. Create the venv first: python -m venv .venv; .venv\Scripts\python -m pip install -e ."
}

$LogDir = Join-Path $InstallRoot "logs"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

$Existing = & sc.exe query $ServiceName 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "Service $ServiceName already exists. Stopping and removing."
    & $NssmPath stop $ServiceName confirm | Out-Null
    & $NssmPath remove $ServiceName confirm | Out-Null
}

& $NssmPath install $ServiceName $Uvicorn "llm_proxy_gateway.main:app" "--host" $Host "--port" $Port
if ($LASTEXITCODE -ne 0) { throw "nssm install failed" }

& $NssmPath set $ServiceName AppDirectory $InstallRoot | Out-Null
& $NssmPath set $ServiceName AppStdout (Join-Path $LogDir "stdout.log") | Out-Null
& $NssmPath set $ServiceName AppStderr (Join-Path $LogDir "stderr.log") | Out-Null
& $NssmPath set $ServiceName AppRotateFiles 1 | Out-Null
& $NssmPath set $ServiceName AppRotateBytes 10485760 | Out-Null
& $NssmPath set $ServiceName Start SERVICE_AUTO_START | Out-Null
& $NssmPath set $ServiceName Description "Claude Universal Custom Proxy - OpenAI-compatible multi-provider LLM gateway" | Out-Null

Write-Host "Installed service: $ServiceName"
Write-Host "Start with:  Start-Service $ServiceName"
Write-Host "Stop with:   Stop-Service $ServiceName"
Write-Host "Logs in:     $LogDir"
