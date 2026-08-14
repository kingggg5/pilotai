param(
    [ValidateRange(1, 65535)][int]$Port = 8080
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$env:NGINX_PORT = $Port.ToString()
$env:WEB_ORIGIN = "http://localhost:$Port"
$arguments = @("compose", "--project-directory", $root)
$environmentFile = Join-Path $root ".env.local"
if (Test-Path -LiteralPath $environmentFile) { $arguments += @("--env-file", $environmentFile) }
$arguments += @("up", "--build", "--wait")

Write-Host "Starting ServicePilot through Nginx at http://localhost:$Port"
& docker @arguments
if ($LASTEXITCODE -ne 0) { throw "Development stack failed with exit code $LASTEXITCODE" }
