param(
    [string]$EnvironmentFile = ".env.production",
    [switch]$Observability
)

$ErrorActionPreference = "Stop"
$arguments = @("deploy", "--env-file", $EnvironmentFile)
if ($Observability) { $arguments += "--observability" }
& node (Join-Path $PSScriptRoot "servicepilot.mjs") @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
