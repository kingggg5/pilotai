param(
    [Parameter(Mandatory)][ValidatePattern('^https://')][string]$PublicOrigin,
    [string]$TenantId = "tenant-production",
    [ValidateRange(1, 65535)][int]$Port = 8080
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$secretDirectory = Join-Path $root ".secrets"
$environmentFile = Join-Path $root ".env.production"

function New-RandomSecret {
    $bytes = New-Object byte[] 48
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Save-Secret([string]$Name, [string]$Value) {
    $path = Join-Path $secretDirectory $Name
    [System.IO.File]::WriteAllText($path, $Value, [System.Text.UTF8Encoding]::new($false))
    $acl = Get-Acl -LiteralPath $path
    $acl.SetAccessRuleProtection($true, $false)
    $account = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($account, "FullControl", "Allow")
    $acl.SetAccessRule($rule)
    Set-Acl -LiteralPath $path -AclObject $acl
}

New-Item -ItemType Directory -Force -Path $secretDirectory | Out-Null
$openAiSecure = Read-Host "OpenAI API key" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($openAiSecure)
try { $openAiKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
if (-not $openAiKey) { throw "OpenAI API key is required" }

$postgresPassword = New-RandomSecret
Save-Secret "openai_api_key" $openAiKey
Save-Secret "postgres_password" $postgresPassword
Save-Secret "database_url" "postgresql://servicepilot:$postgresPassword@postgres:5432/servicepilot"
Save-Secret "jwt_secret" (New-RandomSecret)
Save-Secret "webhook_secret" (New-RandomSecret)
Save-Secret "admin_password" (New-RandomSecret)
Save-Secret "session_secret" (New-RandomSecret)

$deploymentVersion = Get-Date -Format "yyyyMMddHHmmss"
$content = @"
APP_ENV=production
NGINX_PORT=$Port
DEPLOYMENT_VERSION=$deploymentVersion
WEB_ORIGIN=$($PublicOrigin.TrimEnd('/'))
OPENAI_MODEL=gpt-5.6-luna
OPENAI_REASONING_EFFORT=low
REDIS_URL=redis://redis:6379/0
JWT_ISSUER=servicepilot
JWT_AUDIENCE=servicepilot-api
SERVICEPILOT_TENANT_ID=$TenantId
SERVICEPILOT_ADMIN_SUBJECT=support-admin
OTEL_ENABLED=false
"@
[System.IO.File]::WriteAllText($environmentFile, $content, [System.Text.UTF8Encoding]::new($false))
Write-Host "Created .env.production and restricted files under .secrets/. Store an encrypted backup before deployment."
