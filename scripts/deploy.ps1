param(
    [string]$EnvironmentFile = ".env.production",
    [switch]$Observability
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $root $EnvironmentFile

if (-not (Test-Path -LiteralPath $envPath)) {
    throw "Missing $EnvironmentFile. Run scripts/init-production.ps1 first."
}
$requiredSecrets = @("openai_api_key", "database_url", "postgres_password", "jwt_secret", "webhook_secret", "admin_password", "session_secret")
foreach ($secret in $requiredSecrets) {
    $path = Join-Path (Join-Path $root ".secrets") $secret
    if (-not (Test-Path -LiteralPath $path) -or (Get-Item -LiteralPath $path).Length -eq 0) { throw "Missing .secrets/$secret. Run scripts/init-production.ps1 first." }
}

$arguments = @("compose", "--project-directory", $root, "--env-file", $envPath)
if ($Observability) { $arguments += @("--profile", "observability") }
$arguments += @("-f", (Join-Path $root "compose.yaml"), "-f", (Join-Path $root "compose.production.yaml"), "up", "--build", "--force-recreate", "--wait", "--wait-timeout", "180")

& docker @arguments
if ($LASTEXITCODE -ne 0) { throw "Production deployment failed with exit code $LASTEXITCODE" }

Write-Host "ServicePilot is healthy. Open the WEB_ORIGIN configured in $EnvironmentFile."
