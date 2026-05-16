#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$BaseUrl = if ($env:OPENAI_COMPATIBLE_BASE_URL) { $env:OPENAI_COMPATIBLE_BASE_URL } else { "http://localhost:8080/v1" }
if (-not $env:OPENAI_COMPATIBLE_API_KEY) { throw "OPENAI_COMPATIBLE_API_KEY is not set" }

Invoke-RestMethod -Method Get `
    -Uri "$BaseUrl/models" `
    -Headers @{ Authorization = "Bearer $env:OPENAI_COMPATIBLE_API_KEY" }
