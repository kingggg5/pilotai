$ErrorActionPreference = "Stop"
& node (Join-Path $PSScriptRoot "servicepilot.mjs") "check"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
