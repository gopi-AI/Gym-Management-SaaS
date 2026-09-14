#!/usr/bin/env bash
#
# Run a HOST-side database command against the DOCKER development database.
#
# WHY THIS EXISTS
# ---------------
# `npm run migration:*` (the TypeORM CLI) runs on the host and does NOT read
# .env, so it falls back to localhost:5432. On a machine that also runs a native
# PostgreSQL cluster (which owns 5432), that silently targets the WRONG server:
# at best an authentication error, at worst a schema change applied to an
# unrelated database. `npm run bootstrap:dev` does read .env, but with a stale
# DB_PORT it has the same failure mode.
#
# This wrapper loads the environment file, compares its target with the port
# Docker actually publishes for the `gym-postgres` container, refuses anything
# that does not match, and only then runs the command with those variables
# exported. It is read-only: it never starts, stops, migrates or modifies a
# database by itself.
#
# Exit codes: 0 ok | 2 configuration refused | 3 environment file missing
#             4 probe failed | 64 usage error
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="gym-postgres"
CONTAINER_PORT="5432"
LOOPBACK_HOSTS=" 127.0.0.1 localhost ::1 "

usage() {
  cat <<'EOF'
Usage: scripts/dev-db-env.sh [--show] [--probe] [--env-file PATH] [--] <command...>

  --show            print the resolved host target and stop (default when no
                    command is given)
  --probe           additionally verify that the running gym-postgres container
                    serves DB_DATABASE (read-only)
  --env-file PATH   environment file to load (default: <repo>/.env)

Examples:
  scripts/dev-db-env.sh npm run migration:run
  scripts/dev-db-env.sh npm run typeorm -- migration:show
  scripts/dev-db-env.sh npm run bootstrap:dev
  scripts/dev-db-env.sh --probe --show

Environment overrides (testing/CI only): DEV_DB_PUBLISHED_PORT asserts the
published port instead of asking Docker for it.
EOF
}

ENV_FILE="$ROOT/.env"
SHOW=0
PROBE=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --show) SHOW=1; shift ;;
    --probe) PROBE=1; shift ;;
    --env-file)
      [ "$#" -ge 2 ] || { echo '[dev-db] --env-file needs a path' >&2; exit 64; }
      ENV_FILE="$2"; shift 2 ;;
    --) shift; break ;;
    -*) echo "[dev-db] unknown option: $1" >&2; usage >&2; exit 64 ;;
    *) break ;;
  esac
done

[ -f "$ENV_FILE" ] || { echo "[dev-db] no environment file at $ENV_FILE" >&2; exit 3; }

# Minimal KEY=VALUE reader: comments and blank lines are skipped, one layer of
# surrounding quotes is stripped, and only the database keys are taken.
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%$'\r'}"
  case "$line" in ''|'#'*) continue ;; esac
  case "$line" in *=*) ;; *) continue ;; esac
  key="${line%%=*}"
  value="${line#*=}"
  key="${key//[[:space:]]/}"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  case "$key" in
    DB_HOST|DB_PORT|DB_USERNAME|DB_PASSWORD|DB_DATABASE)
      printf -v "$key" '%s' "$value"
      export "$key"
      ;;
  esac
done < "$ENV_FILE"

missing=""
for key in DB_HOST DB_PORT DB_USERNAME DB_DATABASE; do
  if [ -z "${!key:-}" ]; then missing="$missing $key"; fi
done
if [ -n "$missing" ]; then
  echo "[dev-db] $ENV_FILE does not define:$missing" >&2
  exit 2
fi

case "$DB_PORT" in
  *[!0-9]*|'') echo "[dev-db] DB_PORT must be a number, got \"$DB_PORT\"" >&2; exit 2 ;;
esac

case "$LOOPBACK_HOSTS" in
  *" $DB_HOST "*)
    ;;
  *)
    echo "[dev-db] refusing DB_HOST=\"$DB_HOST\": host-side development commands must use a loopback address (127.0.0.1) so they cannot reach a remote database." >&2
    exit 2
    ;;
esac

# The guard uses Docker's own published-port mapping as the source of truth, so
# it keeps working if the published port is ever changed.
published_port() {
  if [ -n "${DEV_DB_PUBLISHED_PORT:-}" ]; then
    printf '%s' "$DEV_DB_PUBLISHED_PORT"
    return 0
  fi
  local mapping
  mapping="$(docker port "$CONTAINER" "${CONTAINER_PORT}/tcp" 2>/dev/null | head -n1 || true)"
  [ -n "$mapping" ] || return 1
  printf '%s' "${mapping##*:}"
}

PUBLISHED="$(published_port || true)"
if [ -z "$PUBLISHED" ]; then
  {
    echo "[dev-db] cannot verify the development database endpoint: no published"
    echo "[dev-db] ${CONTAINER}:${CONTAINER_PORT} mapping was found."
    echo "[dev-db]   start it with: docker compose up -d postgres"
    echo "[dev-db]   without Docker access, assert the port explicitly with"
    echo "[dev-db]   DEV_DB_PUBLISHED_PORT=<port docker-compose.yml publishes>."
  } >&2
  exit 2
fi

if [ "$DB_PORT" != "$PUBLISHED" ]; then
  echo "[dev-db] refusing DB_PORT=$DB_PORT: docker-compose.yml publishes the development database on $PUBLISHED." >&2
  if [ "$DB_PORT" = "$CONTAINER_PORT" ]; then
    echo "[dev-db] port $CONTAINER_PORT normally belongs to the HOST PostgreSQL cluster, so DB_PORT=$DB_PORT would target an unrelated server." >&2
  fi
  echo "[dev-db] align DB_PORT in $ENV_FILE with the published port, or run: docker compose up -d postgres" >&2
  exit 2
fi

if [ "$PROBE" = "1" ]; then
  actual="$(docker exec "$CONTAINER" psql -U "$DB_USERNAME" -d "$DB_DATABASE" -tAc 'select current_database()' 2>/dev/null || true)"
  if [ "$actual" != "$DB_DATABASE" ]; then
    echo "[dev-db] probe failed: expected database \"$DB_DATABASE\" inside $CONTAINER, got \"${actual:-<no response>}\"" >&2
    exit 4
  fi
  echo "[dev-db] probe ok: $CONTAINER serves database \"$actual\" for user \"$DB_USERNAME\""
fi

echo "[dev-db] host target     : ${DB_HOST}:${DB_PORT}/${DB_DATABASE} (user ${DB_USERNAME})"
echo "[dev-db] container target: ${CONTAINER}:${CONTAINER_PORT} (published on host port ${PUBLISHED})"

if [ "$#" -eq 0 ] || [ "$SHOW" = "1" ]; then
  echo '[dev-db] nothing executed (target verified only)'
  exit 0
fi

echo "[dev-db] exec: $*"
exec "$@"
