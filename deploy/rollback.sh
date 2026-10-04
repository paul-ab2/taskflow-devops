#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Roll an environment back to the previously deployed release.
#   deploy/rollback.sh <staging|production>
# Used automatically by the Jenkinsfile when post-deployment smoke tests fail,
# and available to humans as a one-command emergency rollback.
# ---------------------------------------------------------------------------
set -euo pipefail

ENVIRONMENT="${1:?usage: rollback.sh <staging|production>}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_DIR="${DEPLOY_STATE_DIR:-/var/jenkins_home/deployments}"

PREV_IMAGE="$(cat "$STATE_DIR/${ENVIRONMENT}.previous.image" 2>/dev/null || true)"
PREV_VERSION="$(cat "$STATE_DIR/${ENVIRONMENT}.previous.version" 2>/dev/null || true)"
BAD_VERSION="$(cat "$STATE_DIR/${ENVIRONMENT}.current.version" 2>/dev/null || echo unknown)"

if [ -z "$PREV_IMAGE" ]; then
  echo "[rollback:${ENVIRONMENT}] no previous release recorded - cannot roll back" >&2
  exit 1
fi

echo "[rollback:${ENVIRONMENT}] ${BAD_VERSION} -> ${PREV_VERSION}"
# deploy.sh records the rollback target as the new "current" and the bad one as "previous".
bash "${SCRIPT_DIR}/deploy.sh" "$ENVIRONMENT" "$PREV_IMAGE" "$PREV_VERSION"
printf '%s\tROLLBACK\t%s -> %s\n' "$(date -u +%FT%TZ)" "$BAD_VERSION" "$PREV_VERSION" >> "$STATE_DIR/${ENVIRONMENT}.history"
