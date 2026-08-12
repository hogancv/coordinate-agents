# Compatibility launcher. The Node implementation is the single protocol source
# of truth so PowerShell callers receive the same atomicity and recovery rules.
$ErrorActionPreference = 'Stop'
$Tool = Join-Path $PSScriptRoot 'agent-bus.mjs'
& node $Tool @args
exit $LASTEXITCODE
