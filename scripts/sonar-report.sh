#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Prints the SonarQube quality-gate result and key metrics into the Jenkins
# log (with an explanation of each) and saves them to reports/sonar-metrics.json.
# Requires SONAR_HOST_URL and SONAR_AUTH_TOKEN (set by withSonarQubeEnv).
# ---------------------------------------------------------------------------
set -euo pipefail
KEY="${1:-taskflow-api}"
URL="${SONAR_HOST_URL:?}"
AUTH=(-u "${SONAR_AUTH_TOKEN:?}:")
METRICS="coverage,duplicated_lines_density,code_smells,bugs,vulnerabilities,security_hotspots,sqale_rating,reliability_rating,security_rating,sqale_index,cognitive_complexity,complexity,ncloc"

mkdir -p reports
curl -fsS "${AUTH[@]}" "${URL}/api/measures/component?component=${KEY}&metricKeys=${METRICS}" > reports/sonar-metrics.json
curl -fsS "${AUTH[@]}" "${URL}/api/qualitygates/project_status?projectKey=${KEY}" > reports/sonar-gate.json

rating() { case "${1%%.*}" in 1) echo A;; 2) echo B;; 3) echo C;; 4) echo D;; 5) echo E;; *) echo "$1";; esac; }
m() { jq -r --arg k "$1" '(.component.measures[] | select(.metric==$k) | .value) // "n/a"' reports/sonar-metrics.json; }

printf '\n%-28s %-10s %s\n' "METRIC" "VALUE" "WHAT IT TELLS US"
printf '%-28s %-10s %s\n' "Quality gate" "$(jq -r '.projectStatus.status' reports/sonar-gate.json)" "OK = all TaskFlow Gate conditions met"
printf '%-28s %-10s %s\n' "Coverage %" "$(m coverage)" "share of lines/branches executed by tests (gate: >= 80)"
printf '%-28s %-10s %s\n' "Duplicated lines %" "$(m duplicated_lines_density)" "copy-paste code that must be changed in several places (gate: <= 3)"
printf '%-28s %-10s %s\n' "Maintainability rating" "$(rating "$(m sqale_rating)")" "technical-debt ratio; A = debt < 5% of dev time (gate: A)"
printf '%-28s %-10s %s\n' "Technical debt (min)" "$(m sqale_index)" "estimated time to fix all code smells"
printf '%-28s %-10s %s\n' "Code smells" "$(m code_smells)" "maintainability issues (naming, complexity, dead code...)"
printf '%-28s %-10s %s\n' "Reliability rating" "$(rating "$(m reliability_rating)")" "A = no bugs (gate: A)"
printf '%-28s %-10s %s\n' "Bugs" "$(m bugs)" "code likely to behave incorrectly"
printf '%-28s %-10s %s\n' "Security rating" "$(rating "$(m security_rating)")" "A = no vulnerabilities (gate: A; deep scanning is in the Security stage)"
printf '%-28s %-10s %s\n' "Security hotspots" "$(m security_hotspots)" "code needing manual security review"
printf '%-28s %-10s %s\n' "Cyclomatic complexity" "$(m complexity)" "total decision points (ESLint caps each function at 10)"
printf '%-28s %-10s %s\n' "Cognitive complexity" "$(m cognitive_complexity)" "how hard the code is to understand"
printf '%-28s %-10s %s\n\n' "Lines of code" "$(m ncloc)" "size of the analysed code base"
echo "Trend: ${URL}/project/activity?id=${KEY}  (one data point per build/version)"
