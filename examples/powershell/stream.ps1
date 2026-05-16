#Requires -Version 5.1
$ErrorActionPreference = "Stop"

# Resolve OPENAI_COMPATIBLE_* values with the following precedence:
#   1. Existing environment variable (set with $env:... or [Environment]::SetEnvironmentVariable)
#   2. .env at the current working directory
#   3. .env at the repository root (two levels above this script)
#   4. Built-in default for base URL and model; API key has no default

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
$Model = if ($env:OPENAI_COMPATIBLE_MODEL) { $env:OPENAI_COMPATIBLE_MODEL } else { "ollama-cloud/gemma3:4b" }
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

$Body = @{
    model    = $Model
    stream   = $true
    messages = @(
        @{ role = "user"; content = "Write one short sentence." }
    )
} | ConvertTo-Json -Depth 5 -Compress

$Request = [System.Net.Http.HttpRequestMessage]::new("POST", "$BaseUrl/chat/completions")
$Request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $ApiKey)
$Request.Content = [System.Net.Http.StringContent]::new($Body, [System.Text.Encoding]::UTF8, "application/json")

$Client = [System.Net.Http.HttpClient]::new()
$Client.Timeout = [System.TimeSpan]::FromMinutes(10)
try {
    $Response = $Client.SendAsync($Request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    $Response.EnsureSuccessStatusCode() | Out-Null
    $Stream = $Response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
    $Reader = [System.IO.StreamReader]::new($Stream)
    try {
        while (-not $Reader.EndOfStream) {
            $Line = $Reader.ReadLine()
            if (-not $Line -or -not $Line.StartsWith("data: ")) { continue }
            $Data = $Line.Substring(6)
            if ($Data -eq "[DONE]") { Write-Host ""; break }
            try {
                $Chunk = $Data | ConvertFrom-Json
            } catch { continue }
            foreach ($Choice in @($Chunk.choices)) {
                $Content = $Choice.delta.content
                if ($Content) { Write-Host -NoNewline $Content }
            }
        }
    } finally {
        $Reader.Dispose()
        $Stream.Dispose()
    }
} finally {
    $Response.Dispose()
    $Client.Dispose()
}
