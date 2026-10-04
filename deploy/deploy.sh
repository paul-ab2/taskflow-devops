#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Zero-touch deployment with health verification and automatic rollback.
#
#   deploy/deploy.sh <staging|production> <image-ref> <app-version>
#
# Required env: JWT_SECRET   Optional env: CHAOS_TOKEN, DEPLOY_STATE_DIR
#
# 1. records the currently running image (for rollback)
# 2. docker compose up --wait  -> blocks until the container HEALTHCHECK is healthy
# 3. verifies /api/version reports the version we just deployed
# 4. on any failure, redeploys the previous image and exits non-zero
# 5. on success, appends to the deployment history (audit trail)
# ---------------------------------------------------------------------------
set -euo pipefail

ENVIRONMENT="${1:?usage: deploy.sh <staging|production> <image> <version>}"
NEW_IMAGE="${2:?image reference required}"
NEW_VERSION="${3:?app version required}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${DEPLOY_STATE_DIR:-/var/jenkins_home/deployments}"
mkdir -p "$STATE_DIR"

case "$ENVIRONMENT" in
  staging)    HOST_PORT=8001 ;;
  production) HOST_PORT=8000 ;;
  *) echo "Unknown environment: $ENVIRONMENT" >&2; exit 2 ;;
esac

log() { printf '[deploy:%s] %s\n' "$ENVIRONMENT" "$*"; }

compose() {
  docker compose -p "taskflow-${ENVIRONMENT}" -f "${SCRIPT_DIR}/docker-compose.yml" "$@"
}

run_release() {
  local image="$1" version="$2"
  IMAGE="$image" APP_VERSION="$version" APP_ENV="$ENVIRONMENT" HOST_PORT="$HOST_PORT" \
    compose up -d --pull missing --remove-orphans --wait --wait-timeout 120
}

verify_version() {
  local expected="$1" actual=""
  for _ in $(seq 1 15); do
    actual="$(curl -fsS "http://taskflow-${ENVIRONMENT}:3000/api/version" 2>/dev/null | jq -r '.version' || true)"
    [ "$actual" = "$expected" ] && return 0
    sleep 2
  done
  log "version check failed: expected '$expected', got '${actual:-no response}'"
  return 1
}

PREVIOUS_IMAGE="$(cat "$STATE_DIR/${ENVIRONMENT}.current.image" 2>/dev/null || true)"
PREVIOUS_VERSION="$(cat "$STATE_DIR/${ENVIRONMENT}.current.version" 2>/dev/null || true)"
log "deploying ${NEW_IMAGE} (version ${NEW_VERSION}); currently running: ${PREVIOUS_VERSION:-nothing}"

if run_release "$NEW_IMAGE" "$NEW_VERSION" && verify_version "$NEW_VERSION"; then
  [ -n "$PREVIOUS_IMAGE" ] && echo "$PREVIOUS_IMAGE" > "$STATE_DIR/${ENVIRONMENT}.previous.image"
  [ -n "$PREVIOUS_VERSION" ] && echo "$PREVIOUS_VERSION" > "$STATE_DIR/${ENVIRONMENT}.previous.version"
  echo "$NEW_IMAGE" > "$STATE_DIR/${ENVIRONMENT}.current.image"
  echo "$NEW_VERSION" > "$STATE_DIR/${ENVIRONMENT}.current.version"
  printf '%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$NEW_VERSION" "$NEW_IMAGE" "${BUILD_URL:-manual}" \
    >> "$STATE_DIR/${ENVIRONMENT}.history"
  log "SUCCESS - ${NEW_VERSION} is live on http://localhost:${HOST_PORT}"
  docker ps --filter "name=^taskflow-${ENVIRONMENT}$" --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
  exit 0
fi

log "FAILED - container did not become healthy or reported the wrong version"
docker logs --tail 50 "taskflow-${ENVIRONMENT}" 2>&1 || true

if [ -n "$PREVIOUS_IMAGE" ]; then
  log "ROLLING BACK to ${PREVIOUS_VERSION} (${PREVIOUS_IMAGE})"
  run_release "$PREVIOUS_IMAGE" "$PREVIOUS_VERSION" && verify_version "$PREVIOUS_VERSION" \
    && log "rollback complete - ${PREVIOUS_VERSION} restored" \
    || log "ROLLBACK FAILED - manual intervention required"
else
  log "no previous release recorded - nothing to roll back to"
fi
exit 1
