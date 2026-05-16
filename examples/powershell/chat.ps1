#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$BaseUrl = if ($env:OPENAI_COMPATIBLE_BASE_URL) { $env:OPENAI_COMPATIBLE_BASE_URL } else { "http://localhost:8080/v1" }
$Model = if ($env:OPENAI_COMPATIBLE_MODEL) { $env:OPENAI_COMPATIBLE_MODEL } else { "ollama-local/llama3.2" }
if (-not $env:OPENAI_COMPATIBLE_API_KEY) { throw "OPENAI_COMPATIBLE_API_KEY is not set" }

$Body = @{
    model    = $Model
    messages = @(
        @{ role = "user"; content = "Say hello in one short sentence." }
    )
} | ConvertTo-Json -Depth 5 -Compress

Invoke-RestMethod -Method Post `
    -Uri "$BaseUrl/chat/completions" `
    -Headers @{
        Authorization  = "Bearer $env:OPENAI_COMPATIBLE_API_KEY"
        "Content-Type" = "application/json"
    } `
    -Body $Body
