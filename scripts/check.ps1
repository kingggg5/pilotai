$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

function Invoke-Checked {
    param([scriptblock]$Command, [string]$Label)
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$Label failed with exit code $LASTEXITCODE" }
}

Push-Location (Join-Path $projectRoot "apps/api")
try {
    Invoke-Checked { npm run typecheck } "API typecheck"
    Invoke-Checked { npm test } "API tests"
    Invoke-Checked { npm run build } "API build"
    Invoke-Checked { npm run eval:classifier } "Classifier evaluation"
    Invoke-Checked { npm run eval:rag } "Retrieval evaluation"
    Invoke-Checked { npm run eval:golden } "Workflow golden evaluation"
    Invoke-Checked { npx tsx --test ../../evals/golden-contract.test.ts } "Golden contract test"
}
finally { Pop-Location }

Push-Location $projectRoot
try {
    Invoke-Checked { node scripts/quality/vibe-check.test.mjs } "Quality gate contracts"
    Invoke-Checked { node scripts/quality/vibe-check.mjs --json work/quality-gate-report.json --fail-on high } "Repository quality gate"
}
finally { Pop-Location }

Push-Location (Join-Path $projectRoot "apps/web")
try {
    Invoke-Checked { npm run lint -- --max-warnings=0 } "Frontend lint"
    Invoke-Checked { npm run typecheck } "Frontend typecheck"
    Invoke-Checked { npm test } "Frontend tests"
    Invoke-Checked { npm run build } "Frontend build"
}
finally { Pop-Location }

Push-Location $projectRoot
$createdSecretFiles = @()
$previousRedisUrl = $env:REDIS_URL
$previousWebOrigin = $env:WEB_ORIGIN
$previousTenantId = $env:SERVICEPILOT_TENANT_ID
try {
    Invoke-Checked { docker compose config --quiet } "Compose validation"
    $env:REDIS_URL = "redis://redis:6379/0"
    $env:WEB_ORIGIN = "https://servicepilot.example"
    $env:SERVICEPILOT_TENANT_ID = "tenant-validation"
    $secretDirectory = Join-Path $projectRoot ".secrets"
    New-Item -ItemType Directory -Force -Path $secretDirectory | Out-Null
    $temporarySecrets = @("openai_api_key", "database_url", "postgres_password", "jwt_secret", "webhook_secret", "admin_password", "session_secret")
    foreach ($secret in $temporarySecrets) {
        $path = Join-Path $secretDirectory $secret
        if (-not (Test-Path -LiteralPath $path)) {
            Set-Content -LiteralPath $path -Value "compose-validation" -NoNewline
            $createdSecretFiles += $path
        }
    }
    Invoke-Checked { docker compose -f compose.yaml -f compose.production.yaml config --quiet } "Production Compose validation"
    $productionConfig = docker compose -f compose.yaml -f compose.production.yaml config
    if ($productionConfig -match "change-this-before-sharing|local-session-secret-change-me") {
        throw "Production Compose leaked a development secret default"
    }
}
finally {
    foreach ($path in $createdSecretFiles) {
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
    }
    if ($null -eq $previousRedisUrl) { Remove-Item Env:REDIS_URL -ErrorAction SilentlyContinue } else { $env:REDIS_URL = $previousRedisUrl }
    if ($null -eq $previousWebOrigin) { Remove-Item Env:WEB_ORIGIN -ErrorAction SilentlyContinue } else { $env:WEB_ORIGIN = $previousWebOrigin }
    if ($null -eq $previousTenantId) { Remove-Item Env:SERVICEPILOT_TENANT_ID -ErrorAction SilentlyContinue } else { $env:SERVICEPILOT_TENANT_ID = $previousTenantId }
    Pop-Location
}
