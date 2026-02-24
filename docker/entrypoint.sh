#!/bin/sh
set -eu

log() {
  printf '%s %s\n' "[entrypoint]" "$*"
}

run_prisma_push() {
  if [ -x "./node_modules/.bin/prisma" ]; then
    ./node_modules/.bin/prisma db push --schema packages/db/prisma/schema.prisma --skip-generate
    return
  fi

  npx prisma db push --schema packages/db/prisma/schema.prisma --skip-generate
}

normalize_positive_int() {
  value="$1"
  fallback="$2"
  name="$3"

  case "$value" in
    ''|*[!0-9]*)
      log "Invalid ${name}=${value:-<empty>}; using ${fallback}."
      printf '%s' "$fallback"
      return
      ;;
    0)
      log "Invalid ${name}=0; using 1."
      printf '1'
      return
      ;;
  esac

  printf '%s' "$value"
}

BOOTSTRAP_MODE="${DB_BOOTSTRAP_MODE:-required}"
BOOTSTRAP_RETRIES="$(normalize_positive_int "${DB_BOOTSTRAP_RETRIES:-5}" "5" "DB_BOOTSTRAP_RETRIES")"
BOOTSTRAP_RETRY_DELAY_SECONDS="$(normalize_positive_int "${DB_BOOTSTRAP_RETRY_DELAY_SECONDS:-3}" "3" "DB_BOOTSTRAP_RETRY_DELAY_SECONDS")"

case "$BOOTSTRAP_MODE" in
  required|best-effort|skip)
    ;;
  *)
    log "Invalid DB_BOOTSTRAP_MODE=${BOOTSTRAP_MODE}; using required."
    BOOTSTRAP_MODE="required"
    ;;
esac

bootstrap_database() {
  if [ "$BOOTSTRAP_MODE" = "skip" ]; then
    log "Database bootstrap skipped (DB_BOOTSTRAP_MODE=skip)."
    return 0
  fi

  if [ -z "${DATABASE_URL:-}" ]; then
    log "DATABASE_URL is not set; skipping database bootstrap."
    return 0
  fi

  attempt=1
  while [ "$attempt" -le "$BOOTSTRAP_RETRIES" ]; do
    log "Running database bootstrap (attempt ${attempt}/${BOOTSTRAP_RETRIES}, mode=${BOOTSTRAP_MODE})."
    if run_prisma_push; then
      log "Database bootstrap completed."
      return 0
    fi

    if [ "$attempt" -ge "$BOOTSTRAP_RETRIES" ]; then
      break
    fi

    log "Database bootstrap failed; retrying in ${BOOTSTRAP_RETRY_DELAY_SECONDS}s."
    sleep "$BOOTSTRAP_RETRY_DELAY_SECONDS"
    attempt=$((attempt + 1))
  done

  if [ "$BOOTSTRAP_MODE" = "required" ]; then
    log "Database bootstrap failed after ${BOOTSTRAP_RETRIES} attempts; aborting startup."
    return 1
  fi

  log "Database bootstrap failed after ${BOOTSTRAP_RETRIES} attempts; continuing because mode=${BOOTSTRAP_MODE}."
  return 0
}

log "Node runtime $(node -v)"
log "Startup bootstrap mode: ${BOOTSTRAP_MODE}."

mkdir -p /data
bootstrap_database

log "Starting bridge server."
exec node packages/bridge-server/dist/index.js
