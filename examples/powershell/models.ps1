#Requires -Version 5.1
$ErrorActionPreference = "Stop"

# Resolve OPENAI_COMPATIBLE_* values with the following precedence:
#   1. Existing environment variable
#   2. .env at the current working directory
#   3. .env at the repository root (two levels above this script)

$EnvFile = $null
$Candidates = @(
    (Join-Path (Get-Location).Path ".env"),
    (Join-Path $PSScriptRoot "..\..\.env")
)
foreach ($Candidate in $Candidates) {
    if (Test-Path $Candidate) { $EnvFile = (Resolve-Path $Candidate).Path; break }
}

function Read-DotenvValue([string]$Key) {
    if (-not $EnvFile) { return $null }
    $Match = Select-String -Path $EnvFile -Pattern "^$([regex]::Escape($Key))=" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($Match) { return ($Match.Line -replace "^$([regex]::Escape($Key))=", "").Trim('"').Trim("'") }
    return $null
}

$BaseUrl = if ($env:OPENAI_COMPATIBLE_BASE_URL) { $env:OPENAI_COMPATIBLE_BASE_URL } else { "http://localhost:8080/v1" }
$ApiKey = $env:OPENAI_COMPATIBLE_API_KEY
if (-not $ApiKey) { $ApiKey = Read-DotenvValue "GATEWAY_API_KEYS" }
if (-not $ApiKey) {
    throw @"
OPENAI_COMPATIBLE_API_KEY is not set and no GATEWAY_API_KEYS entry was found in .env.

Either:
  - Set the env var:  `$env:OPENAI_COMPATIBLE_API_KEY = '...'
  - Or create .env (in the repo root) with: GATEWAY_API_KEYS=your-key
"@
}

Invoke-RestMethod -Method Get `
    -Uri "$BaseUrl/models" `
    -Headers @{ Authorization = "Bearer $ApiKey" }
