param([ValidateRange(1, 65535)][int]$Port = 8080)

$ErrorActionPreference = "Stop"
& node (Join-Path $PSScriptRoot "servicepilot.mjs") "dev" "--port" $Port
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
