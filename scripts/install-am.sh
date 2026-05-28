#!/usr/bin/env bash
# One-paste AM bootstrap. Sets up the myRA AM workflow on a fresh laptop.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/sriharsha1892/day-ai-am-workflow/main/scripts/install-am.sh | bash -s <am-email>
#
# Or, run after cloning:
#   bash scripts/install-am.sh <am-email>
#
# What it does:
#   1. Checks for Node >=20 and git; prints brew install commands if missing.
#   2. Clones the repo to ~/myra-am-workflow (skips if present).
#   3. Runs npm install.
#   4. Prompts for your worker bearer token (paste from 1Password Send link).
#   5. Writes .env.local with WORKER_BASE_URL, WORKER_BEARER_TOKEN, AM_EMAIL, AM_PACKAGE_DIR.
#   6. Runs npm run setup:codex so Codex MCP is wired to Day AI.
#   7. Smoke-tests the worker connection.

set -euo pipefail

AM_EMAIL="${1:-}"
REPO_DIR="${MYRA_REPO_DIR:-$HOME/myra-am-workflow}"
REPO_URL="${MYRA_REPO_URL:-https://github.com/sriharsha1892/day-ai-am-workflow.git}"
WORKER_URL="${MYRA_WORKER_URL:-https://myra-am-worker.vercel.app}"

if [ -z "$AM_EMAIL" ]; then
  echo "Usage: $0 <am-email>"
  echo "Example: $0 satya@ask-myra.ai"
  exit 1
fi

say() { printf "\n\033[1;32m==> %s\033[0m\n" "$*"; }
warn() { printf "\n\033[1;33m!!  %s\033[0m\n" "$*"; }
fail() { printf "\n\033[1;31mXX  %s\033[0m\n" "$*"; exit 1; }

say "Checking prerequisites"
command -v git >/dev/null || fail "git not found. Install: xcode-select --install"
command -v node >/dev/null || fail "node not found. Install: brew install node"
NODE_MAJOR=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 20 ]; then
  fail "Node $NODE_MAJOR detected; need >=20. Run: brew upgrade node"
fi
echo "  node $(node -v), git $(git --version | awk '{print $3}')"

say "Cloning repo to $REPO_DIR"
if [ ! -d "$REPO_DIR" ]; then
  git clone "$REPO_URL" "$REPO_DIR"
else
  echo "  already present; running git pull"
  git -C "$REPO_DIR" pull --ff-only || warn "pull failed; continuing with local state"
fi
cd "$REPO_DIR"

say "Installing Node dependencies"
npm install --no-audit --no-fund --silent

say "Setting up .env.local"
ENV_FILE="$REPO_DIR/.env.local"
if [ -f "$ENV_FILE" ] && grep -q "^WORKER_BEARER_TOKEN=" "$ENV_FILE"; then
  warn ".env.local already has WORKER_BEARER_TOKEN. Skipping token prompt."
else
  echo "  Paste your worker bearer token (will not echo). Get this from 1Password Send link."
  printf "  token: "
  read -rs TOKEN
  echo
  if [ -z "$TOKEN" ]; then fail "Empty token. Re-run when you have it."; fi
  if [[ ! "$TOKEN" =~ ^tok_ ]]; then warn "Token doesn't start with 'tok_'. Continuing anyway."; fi
  cat >> "$ENV_FILE" <<EOF
WORKER_BASE_URL=$WORKER_URL
WORKER_BEARER_TOKEN=$TOKEN
AM_EMAIL=$AM_EMAIL
AM_PACKAGE_DIR=am-package
EOF
  chmod 600 "$ENV_FILE"
fi

say "Setting up Codex MCP for Day AI"
if command -v codex >/dev/null; then
  npm run setup:codex || warn "setup:codex didn't complete cleanly; you can re-run it later"
else
  warn "Codex CLI not found. Install Codex first (https://codex.app), then run: npm run setup:codex"
fi

say "Smoke-testing the worker connection"
HTTP=$(curl -sS -o /tmp/myra-health.json -w "%{http_code}" "$WORKER_URL/health") || fail "Could not reach worker"
if [ "$HTTP" != "200" ]; then
  fail "Worker returned HTTP $HTTP. Body: $(cat /tmp/myra-health.json)"
fi
echo "  worker /health: $HTTP"

if grep -q '"freshsales":{"ok":true' /tmp/myra-health.json; then
  echo "  providers: freshsales ok"
fi

say "Verifying your bearer token resolves identity for Michelman"
RESOLVE=$(curl -sS -X POST "$WORKER_URL/v1/identity/resolve" \
  -H "Authorization: Bearer $(grep '^WORKER_BEARER_TOKEN=' "$ENV_FILE" | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"accountName":"Michelman","canonicalDomain":"michelman.com"}')
if echo "$RESOLVE" | grep -q '"action":"auto_link_existing"'; then
  echo "  worker auth + identity resolve: GREEN"
else
  warn "Unexpected response:"
  echo "$RESOLVE" | head -5
fi

say "Done"
cat <<EOF

Next steps:
  1. Open Codex.
  2. Open this folder: $REPO_DIR
  3. Say "continue" or "start my tour".

If anything went wrong:
  - Re-run this script (it's idempotent).
  - Or follow the manual steps in docs/satya-handoff.md.

EOF
