#!/usr/bin/env bash
# Stops the platform and the deployed environments.
#   ./scripts/teardown.sh          keep data volumes (Jenkins history, SonarQube, metrics)
#   ./scripts/teardown.sh --purge  delete everything, including volumes and infra/.env
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

docker rm -f taskflow-staging taskflow-production 2>/dev/null || true
if [ "${1:-}" = "--purge" ]; then
  docker compose --env-file "$ROOT/infra/.env" -f "$ROOT/infra/docker-compose.yml" down -v
  rm -f "$ROOT/infra/.env"
  echo "Platform removed, volumes and secrets deleted."
else
  docker compose --env-file "$ROOT/infra/.env" -f "$ROOT/infra/docker-compose.yml" down
  echo "Platform stopped (data kept). Start again with ./scripts/bootstrap.sh"
fi
