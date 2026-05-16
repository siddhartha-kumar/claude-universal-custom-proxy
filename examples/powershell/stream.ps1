#Requires -Version 5.1
$ErrorActionPreference = "Stop"

$BaseUrl = if ($env:OPENAI_COMPATIBLE_BASE_URL) { $env:OPENAI_COMPATIBLE_BASE_URL } else { "http://localhost:8080/v1" }
$Model = if ($env:OPENAI_COMPATIBLE_MODEL) { $env:OPENAI_COMPATIBLE_MODEL } else { "ollama-local/llama3.2" }
if (-not $env:OPENAI_COMPATIBLE_API_KEY) { throw "OPENAI_COMPATIBLE_API_KEY is not set" }

$Body = @{
    model    = $Model
    stream   = $true
    messages = @(
        @{ role = "user"; content = "Write one short sentence." }
    )
} | ConvertTo-Json -Depth 5 -Compress

$Request = [System.Net.Http.HttpRequestMessage]::new("POST", "$BaseUrl/chat/completions")
$Request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new("Bearer", $env:OPENAI_COMPATIBLE_API_KEY)
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
