#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Turns raw scanner output (npm audit + Trivy JSON) into a human-readable,
# categorised summary and applies the security gate policy:
#
#   CRITICAL (fix available) in deps or image ........ FAIL the build
#   any leaked secret ................................ FAIL the build
#   HIGH/CRITICAL Dockerfile misconfiguration ........ FAIL the build
#   HIGH (fix available) ............................. mark build UNSTABLE
#   MEDIUM / LOW ..................................... reported only
#
# Exit codes: 0 = pass, 1 = fail, 2 = unstable
# Output: reports/security-summary.md (archived by Jenkins)
# ---------------------------------------------------------------------------
set -uo pipefail

REPORTS="${1:-reports}"
OUT="$REPORTS/security-summary.md"
FS="$REPORTS/trivy-fs.json"
IMG="$REPORTS/trivy-image.json"
AUDIT="$REPORTS/npm-audit.json"

count_vulns() { # file severity [fixable-only]
  local filter='.Results[]?.Vulnerabilities[]? | select(.Severity == $sev)'
  [ "${3:-}" = "fixable" ] && filter="$filter | select((.FixedVersion // \"\") != \"\")"
  [ -f "$1" ] && jq --arg sev "$2" "[$filter] | length" "$1" || echo 0
}
count_misconf() { [ -f "$1" ] && jq --arg sev "$2" '[.Results[]?.Misconfigurations[]? | select(.Severity == $sev)] | length' "$1" || echo 0; }
count_secrets() { [ -f "$1" ] && jq '[.Results[]?.Secrets[]?] | length' "$1" || echo 0; }

vuln_table() { # file title
  [ -f "$1" ] || return 0
  local rows
  rows="$(jq -r '[.Results[]? as $r | $r.Vulnerabilities[]? |
    select(.Severity=="CRITICAL" or .Severity=="HIGH" or .Severity=="MEDIUM") | . + {Target: $r.Target}]
    | unique_by(.VulnerabilityID + .PkgName)
    | sort_by({"CRITICAL":0,"HIGH":1,"MEDIUM":2}[.Severity])[]
    | "| \(.Severity) | \(.VulnerabilityID) | \(.PkgName) | \(.InstalledVersion) | \(.FixedVersion // "no fix yet") | \(.Target) | \((.Title // "-") | gsub("\\|";"/") | .[0:70]) |"' "$1")"
  echo "### $2"
  if [ -z "$rows" ]; then echo "No CRITICAL/HIGH/MEDIUM vulnerabilities."; echo; return 0; fi
  echo "| Severity | ID | Package | Installed | Fixed in | Target | Title |"
  echo "|---|---|---|---|---|---|---|"
  echo "$rows"
  echo
}

misconf_table() {
  [ -f "$FS" ] || return 0
  local rows
  rows="$(jq -r '.Results[]? as $r | $r.Misconfigurations[]? |
    "| \(.Severity) | \(.ID) | \($r.Target) | \(.Title) | \(.Resolution // "-") |"' "$FS")"
  echo "### Infrastructure-as-code misconfigurations (Dockerfiles)"
  if [ -z "$rows" ]; then echo "No misconfigurations found."; echo; return 0; fi
  echo "| Severity | Check | File | Issue | Resolution |"
  echo "|---|---|---|---|---|"
  echo "$rows"
  echo
}

AUDIT_CRIT=0; AUDIT_HIGH=0; AUDIT_MOD=0; AUDIT_LOW=0
if [ -f "$AUDIT" ]; then
  AUDIT_CRIT="$(jq '.metadata.vulnerabilities.critical // 0' "$AUDIT")"
  AUDIT_HIGH="$(jq '.metadata.vulnerabilities.high // 0' "$AUDIT")"
  AUDIT_MOD="$(jq '.metadata.vulnerabilities.moderate // 0' "$AUDIT")"
  AUDIT_LOW="$(jq '.metadata.vulnerabilities.low // 0' "$AUDIT")"
fi

CRIT_FIXABLE=$(( $(count_vulns "$FS" CRITICAL fixable) + $(count_vulns "$IMG" CRITICAL fixable) + AUDIT_CRIT ))
HIGH_FIXABLE=$(( $(count_vulns "$FS" HIGH fixable) + $(count_vulns "$IMG" HIGH fixable) + AUDIT_HIGH ))
SECRETS=$(( $(count_secrets "$FS") + $(count_secrets "$IMG") ))
MISCONF_BAD=$(( $(count_misconf "$FS" CRITICAL) + $(count_misconf "$FS" HIGH) ))

{
  echo "# Security scan summary - build ${BUILD_NUMBER:-local} (${APP_VERSION:-dev})"
  echo
  echo "| Scanner | Scope | CRITICAL | HIGH | MEDIUM | LOW |"
  echo "|---|---|---|---|---|---|"
  echo "| npm audit | production dependencies | $AUDIT_CRIT | $AUDIT_HIGH | $AUDIT_MOD | $AUDIT_LOW |"
  for pair in "Trivy fs|source, lockfile, Dockerfiles, secrets|$FS" "Trivy image|OS packages + node_modules in image|$IMG"; do
    IFS='|' read -r name scope file <<< "$pair"
    echo "| $name | $scope | $(count_vulns "$file" CRITICAL) | $(count_vulns "$file" HIGH) | $(count_vulns "$file" MEDIUM) | $(count_vulns "$file" LOW) |"
  done
  echo
  echo "Secrets detected: **$SECRETS** - Dockerfile misconfigurations (HIGH+): **$MISCONF_BAD**"
  echo
  echo "## Gate decision"
  echo "- CRITICAL with a fix available: **$CRIT_FIXABLE** (policy: fail)"
  echo "- HIGH with a fix available: **$HIGH_FIXABLE** (policy: unstable)"
  echo "- Secrets: **$SECRETS** (policy: fail)"
  echo "- Misconfigurations HIGH+: **$MISCONF_BAD** (policy: fail)"
  echo
  echo "## Findings"
  vuln_table "$FS" "Application dependencies (package-lock.json)"
  vuln_table "$IMG" "Container image"
  misconf_table
  echo "Accepted risks are documented in .trivyignore.yaml and docs/SECURITY-REPORT.md."
} > "$OUT"

cat "$OUT"

if [ "$CRIT_FIXABLE" -gt 0 ] || [ "$SECRETS" -gt 0 ] || [ "$MISCONF_BAD" -gt 0 ]; then
  echo "SECURITY GATE: FAIL"; exit 1
elif [ "$HIGH_FIXABLE" -gt 0 ]; then
  echo "SECURITY GATE: UNSTABLE (fixable HIGH findings)"; exit 2
fi
echo "SECURITY GATE: PASS"
exit 0
