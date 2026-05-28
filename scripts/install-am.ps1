# One-paste AM bootstrap for Windows (PowerShell). Mirrors scripts/install-am.sh.
#
# Usage from PowerShell (one line):
#   Set-ExecutionPolicy -Scope Process Bypass -Force; iwr -useb https://raw.githubusercontent.com/sriharsha1892/day-ai-am-workflow/main/scripts/install-am.ps1 | iex
#
# Or after cloning, with the AM email as a param:
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-am.ps1 satya@ask-myra.ai
#
# What it does (same as the bash version):
#   1. Checks Node >=20 and git; suggests `winget install` if missing.
#   2. Clones the repo to %USERPROFILE%\myra-am-workflow (skips if present).
#   3. Runs npm install.
#   4. Prompts for the AM email if not passed, then for the worker bearer token.
#   5. Writes .env.local with WORKER_BASE_URL, WORKER_BEARER_TOKEN, AM_EMAIL, AM_PACKAGE_DIR.
#   6. Runs npm run setup:codex so Codex MCP wires up Day AI.
#   7. Smoke-tests /health and identity resolve.

param(
    [string]$AmEmail = ""
)

$ErrorActionPreference = "Stop"

$RepoDir   = if ($env:MYRA_REPO_DIR)   { $env:MYRA_REPO_DIR }   else { Join-Path $env:USERPROFILE "myra-am-workflow" }
$RepoUrl   = if ($env:MYRA_REPO_URL)   { $env:MYRA_REPO_URL }   else { "https://github.com/sriharsha1892/day-ai-am-workflow.git" }
$WorkerUrl = if ($env:MYRA_WORKER_URL) { $env:MYRA_WORKER_URL } else { "https://myra-am-worker.vercel.app" }

function Say  ($m) { Write-Host ""; Write-Host "==> $m" -ForegroundColor Green }
function Warn ($m) { Write-Host ""; Write-Host "!!  $m" -ForegroundColor Yellow }
function Fail ($m) { Write-Host ""; Write-Host "XX  $m" -ForegroundColor Red; exit 1 }

if (-not $AmEmail) {
    $AmEmail = Read-Host "AM email (e.g. satya@ask-myra.ai)"
    if (-not $AmEmail) { Fail "No AM email provided." }
}

Say "Checking prerequisites"
try { $null = git --version } catch { Fail "git not found. Install: winget install --id Git.Git" }
try { $null = node --version } catch { Fail "node not found. Install: winget install OpenJS.NodeJS.LTS (need v20+)" }
$nodeMajor = (node -v).TrimStart('v').Split('.')[0] -as [int]
if ($nodeMajor -lt 20) { Fail "Node $nodeMajor detected; need >=20. Run: winget upgrade OpenJS.NodeJS.LTS" }
Write-Host ("  node {0}, git {1}" -f (node -v), ((git --version) -replace 'git version ',''))

Say "Cloning repo to $RepoDir"
if (-not (Test-Path $RepoDir)) {
    git clone $RepoUrl $RepoDir
} else {
    Write-Host "  already present; running git pull"
    git -C $RepoDir pull --ff-only
}
Set-Location $RepoDir

Say "Installing Node dependencies"
npm install --no-audit --no-fund --silent

Say "Setting up .env.local"
$EnvFile = Join-Path $RepoDir ".env.local"
$hasToken = $false
if (Test-Path $EnvFile) {
    if (Select-String -Path $EnvFile -Pattern "^WORKER_BEARER_TOKEN=" -Quiet) { $hasToken = $true }
}
if ($hasToken) {
    Warn ".env.local already has WORKER_BEARER_TOKEN. Skipping token prompt."
} else {
    Write-Host "  Paste your worker bearer token (input is masked). Get this from your 1Password Send link."
    $secureToken = Read-Host "  token" -AsSecureString
    $bstr  = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureToken)
    $token = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    if (-not $token) { Fail "Empty token. Re-run when you have it." }
    if (-not $token.StartsWith("tok_")) { Warn "Token doesn't start with 'tok_'. Continuing anyway." }

    $lines = @(
        "WORKER_BASE_URL=$WorkerUrl",
        "WORKER_BEARER_TOKEN=$token",
        "AM_EMAIL=$AmEmail",
        "AM_PACKAGE_DIR=am-package"
    )
    Add-Content -Path $EnvFile -Value ($lines -join "`n")
}

Say "Setting up Codex MCP for Day AI"
try {
    $null = Get-Command codex -ErrorAction Stop
    npm run setup:codex
} catch {
    Warn "Codex CLI not found. Install Codex first (https://codex.app), then run: npm run setup:codex"
}

Say "Smoke-testing the worker connection"
try {
    $health = Invoke-RestMethod -Uri "$WorkerUrl/health" -Method Get -TimeoutSec 20
    Write-Host "  worker /health: ok"
    if ($health.providers.freshsales.ok) { Write-Host "  providers: freshsales ok" }
    if ($health.providers.apollo.ok)     { Write-Host "  providers: apollo ok" }
    if ($health.providers.clearout.ok)   { Write-Host "  providers: clearout ok" }
} catch {
    Fail "Could not reach worker: $($_.Exception.Message)"
}

Say "Verifying your bearer token resolves identity for Michelman"
$bearerLine = (Get-Content $EnvFile | Where-Object { $_ -match '^WORKER_BEARER_TOKEN=' } | Select-Object -First 1)
$bearer = $bearerLine -replace '^WORKER_BEARER_TOKEN=', ''
$headers = @{
    "Authorization" = "Bearer $bearer"
    "Content-Type"  = "application/json"
}
$body = '{"accountName":"Michelman","canonicalDomain":"michelman.com"}'
try {
    $resolve = Invoke-RestMethod -Uri "$WorkerUrl/v1/identity/resolve" -Method Post -Headers $headers -Body $body -TimeoutSec 30
    if ($resolve.decision.action -eq "auto_link_existing") {
        Write-Host "  worker auth + identity resolve: GREEN"
    } else {
        Warn "Unexpected resolve action: $($resolve.decision.action)"
    }
} catch {
    Warn "Identity resolve failed: $($_.Exception.Message)"
}

Say "Done"
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Open Codex."
Write-Host "  2. Open this folder: $RepoDir"
Write-Host "  3. Say `"continue`" or `"start my tour`"."
Write-Host ""
Write-Host "If anything went wrong:"
Write-Host "  - Re-run this script (it's idempotent)."
Write-Host "  - Or follow the manual steps in docs/satya-handoff.md."
