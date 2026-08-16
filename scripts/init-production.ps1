param(
    [Parameter(Mandatory)][ValidatePattern('^https://')][string]$PublicOrigin,
    [string]$TenantId = "tenant-production",
    [ValidateRange(1, 65535)][int]$Port = 8080
)

$ErrorActionPreference = "Stop"
$arguments = @("init-production", "--origin", $PublicOrigin, "--tenant", $TenantId, "--port", $Port)
& node (Join-Path $PSScriptRoot "servicepilot.mjs") @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
