#!/usr/bin/env bash

# Production configuration verification
# Fails fast on PostgreSQL prerequisites and Grok provider integration regressions.

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0
WARNINGS=0

ok() {
  echo -e "${GREEN}[ok]${NC} $1"
}

warn() {
  echo -e "${YELLOW}[warn]${NC} $1"
  WARNINGS=$((WARNINGS + 1))
}

fail() {
  echo -e "${RED}[error]${NC} $1"
  ERRORS=$((ERRORS + 1))
}

check_required_env() {
  local var_name=$1
  local description=$2
  if [ -z "${!var_name:-}" ]; then
    fail "$var_name is not set - $description"
  else
    ok "$var_name is set"
  fi
}

check_not_example() {
  local var_name=$1
  local example_value=$2
  if [ "${!var_name:-}" = "$example_value" ]; then
    fail "$var_name is still using an example/default value"
  fi
}

check_file_contains() {
  local file=$1
  local pattern=$2
  local description=$3
  if grep -q "$pattern" "$file"; then
    ok "$description"
  else
    fail "$description (missing pattern: $pattern in $file)"
  fi
}

echo "== Verifying production configuration =="

echo
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  ok ".env loaded"
else
  warn ".env not found, using current process environment"
fi

echo
echo "-- Required environment variables --"
check_required_env "DATABASE_URL" "PostgreSQL connection string"
check_required_env "KEY_ENCRYPTION_SECRET" "AES-256-GCM key (base64)"
check_required_env "ADMIN_API_TOKEN" "Admin API token"

check_not_example "KEY_ENCRYPTION_SECRET" "tBaUyjIKnpyPOkkPN2n/3jPypcl0HkbbDzV6IuJ7WyY="
check_not_example "ADMIN_API_TOKEN" "2f6d35ecf4d6d54cb5bb67828173813d8ef84d04fec2f5c5"

echo
echo "-- PostgreSQL checks --"
if [[ "${DATABASE_URL:-}" =~ ^postgres(ql)?:// ]]; then
  ok "DATABASE_URL uses PostgreSQL protocol"
else
  fail "DATABASE_URL must start with postgres:// or postgresql://"
fi

if node -e 'const raw=process.env.DATABASE_URL||""; try { const u=new URL(raw); if (!/^postgres(ql)?:$/.test(u.protocol)) process.exit(2); if (!u.hostname) process.exit(3); const db=(u.pathname||"/").replace(/^\//,""); if (!db) process.exit(4); process.exit(0); } catch { process.exit(1); }'; then
  ok "DATABASE_URL has valid host/database components"
else
  fail "DATABASE_URL format is invalid (expected host + database name)"
fi

echo
echo "-- Runtime listen checks --"
if [ "${HOST:-}" = "127.0.0.1" ] || [ "${HOST:-}" = "localhost" ]; then
  fail "HOST must not be localhost in cloud deployments; use 0.0.0.0"
elif [ -n "${HOST:-}" ]; then
  ok "HOST is set to ${HOST}"
else
  warn "HOST not set; runtime default should be 0.0.0.0"
fi

if [ -n "${PORT:-}" ]; then
  ok "PORT is set to ${PORT}"
else
  warn "PORT not set; runtime default is 8787"
fi

echo
echo "-- Grok provider checks --"
if [ -n "${GROK_API_URL:-}" ]; then
  if node -e 'const raw=process.env.GROK_API_URL||""; try { const u=new URL(raw); if (u.protocol!=="http:" && u.protocol!=="https:") process.exit(2); process.exit(0); } catch { process.exit(1); }'; then
    ok "GROK_API_URL is a valid HTTP(S) URL"
  else
    fail "GROK_API_URL must be a valid http:// or https:// URL"
  fi
else
  warn "GROK_API_URL not set; runtime will use default https://api.x.ai/v1 or admin DB setting"
fi

if [ "${GROK_SEARCH_ENABLED:-false}" = "true" ] && [ -z "${GROK_API_KEY:-}" ]; then
  warn "GROK_SEARCH_ENABLED=true but GROK_API_KEY is empty; ensure admin UI has stored provider key or Grok key pool entries"
fi

echo
echo "-- Build artifact checks --"
if [ -d "packages/bridge-server/dist" ]; then
  ok "bridge-server build exists"
else
  fail "bridge-server build missing. Run: npm run build"
fi

if [ -d "packages/admin-ui/dist" ]; then
  ok "admin-ui build exists"
else
  warn "admin-ui build missing. Run: npm --workspace @mcp-nexus/admin-ui run build"
fi

echo
echo "-- Dependency checks --"
if [ -d "node_modules" ]; then
  ok "node_modules exists"
else
  fail "node_modules not found. Run: npm ci --include=dev"
fi

echo
echo "-- Preflight regression guards --"
check_file_contains "packages/bridge-server/src/admin/routes.ts" "grok-provider" "Admin Grok provider route is present"
check_file_contains "packages/admin-ui/src/lib/adminApi.ts" "updateGrokProviderConfig" "Admin UI API bindings include Grok provider update"
check_file_contains "packages/admin-ui/src/pages/SettingsPage.tsx" "grok-provider-base-url" "Admin UI settings page exposes Grok provider base URL field"

echo
if [ "$ERRORS" -eq 0 ] && [ "$WARNINGS" -eq 0 ]; then
  echo -e "${GREEN}All checks passed.${NC}"
  exit 0
fi

if [ "$ERRORS" -eq 0 ]; then
  echo -e "${YELLOW}${WARNINGS} warning(s) found.${NC}"
  exit 0
fi

echo -e "${RED}${ERRORS} error(s) and ${WARNINGS} warning(s) found.${NC}"
exit 1
