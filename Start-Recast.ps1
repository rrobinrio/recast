$ErrorActionPreference='Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 or later from https://nodejs.org, then run this launcher again.' }
$major=[int]((& node --version).TrimStart('v').Split('.')[0])
if ($major -lt 24) { throw 'Recast requires Node.js 24 or later.' }
if (-not (Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
if (-not (Test-Path -LiteralPath 'node_modules')) { & npm.cmd ci; if ($LASTEXITCODE) { throw 'Dependency installation failed.' } }
& npm.cmd run build
if ($LASTEXITCODE) { throw 'The app could not build.' }
Write-Host 'Your private accounts and uploads stay in this folder under data/.'
Write-Host 'Use this invitation to create an account:'
& npm.cmd run invite
Write-Host 'Open http://localhost:3000 when the server is ready. Add COMFY_API_KEY to .env for generation.'
& npm.cmd start
