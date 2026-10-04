#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Monitoring stage - connects the freshly released version to the monitoring stack:
#  1. reloads Prometheus so alert-rule changes in Git go live (config as code)
#  2. waits until Prometheus is scraping the new production container
#  3. verifies the alert rules are loaded and Alertmanager is reachable
#  4. sends warm-up traffic so dashboards have data immediately
#  5. annotates Grafana with the release (deploy markers on every graph)
#  6. checks no critical alert is firing for production after the release
# Env: APP_VERSION, GRAFANA_USER, GRAFANA_PASSWORD (from Jenkins credentials)
# Exit: 0 healthy, 1 broken monitoring, 2 critical alert firing (unstable)
# ---------------------------------------------------------------------------
set -euo pipefail

PROM="${PROMETHEUS_URL:-http://prometheus:9090}"
AM="${ALERTMANAGER_URL:-http://alertmanager:9093}"
GRAFANA="${GRAFANA_URL:-http://grafana:3000}"
APP="http://taskflow-production:3000"
VERSION="${APP_VERSION:-unknown}"

step() { printf '\n\033[1m[monitoring] %s\033[0m\n' "$*"; }
query() { curl -fsS --get "${PROM}/api/v1/query" --data-urlencode "query=$1"; }

step "1/6 Reloading Prometheus configuration"
curl -fsS -X POST "${PROM}/-/reload" && echo "reloaded"

step "2/6 Waiting for Prometheus to scrape production (version ${VERSION})"
ok=0
for i in $(seq 1 30); do
  seen="$(query "taskflow_app_info{job=\"taskflow-production\",version=\"${VERSION}\"}" | jq -r '.data.result | length')"
  if [ "$seen" -ge 1 ]; then ok=1; echo "production target UP and reporting version ${VERSION} (after ${i} checks)"; break; fi
  sleep 3
done
[ "$ok" -eq 1 ] || { echo "Prometheus is not scraping the new production version"; exit 1; }
query 'up' | jq -r '.data.result[] | "  target \(.metric.job) (\(.metric.instance)) -> \(if .value[1]=="1" then "UP" else "DOWN" end)"'

step "3/6 Verifying alert rules and Alertmanager"
curl -fsS "${PROM}/api/v1/rules" | jq -r '.data.groups[] | "  group \(.name): " + ([.rules[].name] | join(", "))'
RULES="$(curl -fsS "${PROM}/api/v1/rules" | jq '[.data.groups[].rules[]] | length')"
echo "  ${RULES} alert rules loaded"
[ "$RULES" -ge 5 ] || { echo "expected alert rules are missing"; exit 1; }
curl -fsS "${AM}/-/ready" > /dev/null && echo "  Alertmanager ready (routes alerts to the team inbox http://localhost:8025)"

step "4/6 Warm-up traffic (synthetic monitoring)"
for _ in $(seq 1 30); do
  curl -fsS -o /dev/null "${APP}/api/version" || true
  curl -fsS -o /dev/null "${APP}/health" || true
done
echo "  sent 60 requests"

step "5/6 Annotating Grafana dashboards with the release"
curl -fsS -u "${GRAFANA_USER:-admin}:${GRAFANA_PASSWORD:?}" -H 'Content-Type: application/json' \
  -X POST "${GRAFANA}/api/annotations" \
  -d "{\"tags\":[\"deployment\",\"production\"],\"text\":\"Release ${VERSION} deployed by Jenkins build #${BUILD_NUMBER:-?}\"}" \
  | jq -c . || echo "  (Grafana annotation failed - non-fatal)"

step "6/6 Checking for critical production alerts"
sleep 15
FIRING="$(curl -fsS "${AM}/api/v2/alerts?active=true&silenced=false&inhibited=false" \
  | jq '[.[] | select(.labels.severity=="critical" and .labels.environment=="production")]')"
COUNT="$(echo "$FIRING" | jq 'length')"
if [ "$COUNT" -gt 0 ]; then
  echo "$FIRING" | jq -r '.[] | "  FIRING: \(.labels.alertname) - \(.annotations.summary)"'
  exit 2
fi
echo "  no critical alerts firing - production is healthy"
echo
echo "Dashboards: http://localhost:3000/d/taskflow-overview   Alerts: http://localhost:9093   Inbox: http://localhost:8025"
