#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Incident simulation (game day) against PRODUCTION, end-to-end:
#   fault injected -> metrics change -> Prometheus rule fires -> Alertmanager
#   routes it -> e-mail lands in the team inbox -> fault removed -> recovery.
#
#   scripts/simulate-incident.sh <error-spike|latency|outage>
#
# Env: CHAOS_TOKEN (Jenkins credential). Runs inside the Jenkins container
# (devops-net), or from a laptop with APP_URL/PROM/AM/MAILPIT overridden.
# ---------------------------------------------------------------------------
set -euo pipefail

MODE="${1:?usage: simulate-incident.sh <error-spike|latency|outage>}"
APP="${APP_URL:-http://taskflow-production:3000}"
AM="${ALERTMANAGER_URL:-http://alertmanager:9093}"
MAILPIT="${MAILPIT_URL:-http://mailpit:8025}"
GRAFANA="${GRAFANA_URL:-http://grafana:3000}"
TIMEOUT="${ALERT_TIMEOUT_SECONDS:-240}"

case "$MODE" in
  error-spike) EXPECTED_ALERT="TaskFlowHighErrorRate" ;;
  latency)     EXPECTED_ALERT="TaskFlowHighLatencyP95" ;;
  outage)      EXPECTED_ALERT="TaskFlowProductionDown" ;;
  *) echo "unknown mode $MODE" >&2; exit 2 ;;
esac

log() { printf '[incident:%s] %s\n' "$MODE" "$*"; }

chaos() { # chaos <json-body>
  curl -fsS -X POST "${APP}/api/admin/chaos" -H "x-chaos-token: ${CHAOS_TOKEN:?CHAOS_TOKEN required}" \
       -H 'Content-Type: application/json' -d "$1"
}

annotate() {
  [ -n "${GRAFANA_PASSWORD:-}" ] || return 0
  curl -fsS -u "admin:${GRAFANA_PASSWORD}" -H 'Content-Type: application/json' -X POST "${GRAFANA}/api/annotations" \
    -d "{\"tags\":[\"incident\",\"production\"],\"text\":\"$1\"}" > /dev/null || true
}

TRAFFIC_PID=""
start_traffic() {
  ( while true; do curl -s -o /dev/null --max-time 5 "${APP}/api/version" || true; sleep 0.1; done ) &
  TRAFFIC_PID=$!
}

cleanup() {
  [ -n "$TRAFFIC_PID" ] && kill "$TRAFFIC_PID" 2>/dev/null || true
  if [ "$MODE" = "outage" ]; then
    docker start taskflow-production > /dev/null 2>&1 || true
  else
    chaos '{"mode":"off"}' > /dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

# Clear old Mailpit messages for a clean demo inbox
curl -fsS -X DELETE "${MAILPIT}/api/v1/messages" > /dev/null 2>&1 || true

log "injecting fault (expecting alert ${EXPECTED_ALERT})"
annotate "Incident simulation started: ${MODE}"
case "$MODE" in
  error-spike) chaos '{"mode":"errors","errorRate":0.6,"durationSeconds":300}'; echo ;;
  latency)     chaos '{"mode":"latency","latencyMs":1200,"durationSeconds":300}'; echo ;;
  outage)      docker stop taskflow-production ;;
esac
start_traffic

log "waiting up to ${TIMEOUT}s for Alertmanager to fire ${EXPECTED_ALERT}..."
START=$(date +%s)
FIRED=0
while [ $(( $(date +%s) - START )) -lt "$TIMEOUT" ]; do
  if curl -fsS "${AM}/api/v2/alerts?active=true" | jq -e --arg a "$EXPECTED_ALERT" 'any(.[]; .labels.alertname==$a)' > /dev/null; then
    FIRED=1; break
  fi
  sleep 5
done
DETECT=$(( $(date +%s) - START ))

if [ "$FIRED" -ne 1 ]; then
  log "FAILED - ${EXPECTED_ALERT} did not fire within ${TIMEOUT}s"
  exit 1
fi
log "ALERT FIRED after ${DETECT}s: ${EXPECTED_ALERT}"
curl -fsS "${AM}/api/v2/alerts?active=true" | jq -r '.[] | "  \(.labels.severity | ascii_upcase) \(.labels.alertname): \(.annotations.description)"'

log "checking the team was notified (Mailpit inbox)..."
NOTIFIED=0
for _ in $(seq 1 12); do
  if curl -fsS "${MAILPIT}/api/v1/messages" | jq -e --arg a "$EXPECTED_ALERT" 'any(.messages[]?; .Subject | contains($a))' > /dev/null; then
    NOTIFIED=1; break
  fi
  sleep 5
done
if [ "$NOTIFIED" -eq 1 ]; then
  curl -fsS "${MAILPIT}/api/v1/messages" | jq -r '.messages[] | "  e-mail to \([.To[].Address] | join(", ")): \(.Subject)"'
else
  log "WARNING - alert fired but no e-mail found in Mailpit"
fi

log "resolving incident (removing fault)"
cleanup
trap - EXIT
annotate "Incident simulation resolved: ${MODE} (detected in ${DETECT}s)"

if [ "$MODE" = "outage" ]; then
  for _ in $(seq 1 20); do curl -fsS -o /dev/null "${APP}/health" && break; sleep 2; done
fi
curl -fsS "${APP}/health" | jq -c .
log "DONE - time to detect: ${DETECT}s, team notified: $([ "$NOTIFIED" -eq 1 ] && echo yes || echo no)"
log "the alert will auto-resolve and a RESOLVED e-mail will follow in ~1-2 minutes"
