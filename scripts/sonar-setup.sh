#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# SonarQube configuration as code:
#   * replaces the default admin/admin password
#   * creates the project and the custom "TaskFlow Gate" quality gate
#   * generates the analysis token Jenkins uses (printed as SONAR_TOKEN=...)
# Each condition is applied independently and reported, so the script still
# completes if a future SonarQube version renames a metric.
# ---------------------------------------------------------------------------
set -uo pipefail

SONAR_URL="${SONAR_URL:-http://localhost:9000}"
NEW_PASSWORD="${SONAR_ADMIN_PASSWORD:?SONAR_ADMIN_PASSWORD required}"
PROJECT_KEY="taskflow-api"
GATE="TaskFlow Gate"

api() { # api METHOD PATH [curl args...]
  local method="$1" path="$2"; shift 2
  curl -sS -u "admin:${ADMIN_PW}" -X "$method" "${SONAR_URL}${path}" "$@"
}

# 1. admin password (only if still the default)
if curl -fsS -u admin:admin "${SONAR_URL}/api/authentication/validate" | grep -q '"valid":true'; then
  curl -fsS -u admin:admin -X POST "${SONAR_URL}/api/users/change_password" \
    --data-urlencode "login=admin" --data-urlencode "previousPassword=admin" \
    --data-urlencode "password=${NEW_PASSWORD}" && echo "admin password changed"
fi
ADMIN_PW="$NEW_PASSWORD"

# 2. project
api POST /api/projects/create --data-urlencode "project=${PROJECT_KEY}" --data-urlencode "name=TaskFlow API" >/dev/null \
  && echo "project ${PROJECT_KEY} ready"

# 3. quality gate
api POST /api/qualitygates/create --data-urlencode "name=${GATE}" >/dev/null
add_condition() { # metric operator threshold  (LT = fail if less than, GT = fail if greater than)
  local out
  out="$(api POST /api/qualitygates/create_condition --data-urlencode "gateName=${GATE}" \
        --data-urlencode "metric=$1" --data-urlencode "op=$2" --data-urlencode "error=$3")"
  if echo "$out" | grep -q '"errors"'; then
    echo "  condition $1 $2 $3 skipped: $out"
  else
    echo "  condition: fail if $1 $2 $3"
  fi
}
echo "quality gate '${GATE}':"
# Overall code
add_condition coverage                 LT 80   # line+branch coverage below 80%
add_condition duplicated_lines_density GT 3    # more than 3% duplicated lines
add_condition sqale_rating             GT 1    # maintainability rating worse than A
add_condition reliability_rating       GT 1    # any bug -> rating worse than A
add_condition security_rating          GT 1    # any vulnerability -> rating worse than A
# New code (since the previous version - catches regressions early)
add_condition new_coverage                 LT 80
add_condition new_duplicated_lines_density GT 3
add_condition new_maintainability_rating   GT 1
add_condition new_reliability_rating       GT 1
add_condition new_security_rating          GT 1

api POST /api/qualitygates/set_as_default --data-urlencode "name=${GATE}" >/dev/null
api POST /api/qualitygates/select --data-urlencode "gateName=${GATE}" --data-urlencode "projectKey=${PROJECT_KEY}" >/dev/null
echo "gate assigned to ${PROJECT_KEY}"

# New code = everything since the previous version (Jenkins sets a new version every build)
api POST /api/new_code_periods/set --data-urlencode "project=${PROJECT_KEY}" --data-urlencode "type=PREVIOUS_VERSION" >/dev/null

# 4. analysis token for Jenkins
TOKEN_JSON="$(api POST /api/user_tokens/generate --data-urlencode "name=jenkins-$(date +%s)" \
              --data-urlencode "type=GLOBAL_ANALYSIS_TOKEN")"
TOKEN="$(echo "$TOKEN_JSON" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
if [ -z "$TOKEN" ]; then
  # Older SonarQube versions do not support token types
  TOKEN_JSON="$(api POST /api/user_tokens/generate --data-urlencode "name=jenkins-$(date +%s)")"
  TOKEN="$(echo "$TOKEN_JSON" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"
fi
echo "SONAR_TOKEN=${TOKEN}"
