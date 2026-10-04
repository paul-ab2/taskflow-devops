#!/usr/bin/env bash
# Generates RELEASE_NOTES.md from the commits since the previous release tag.
#   scripts/release-notes.sh <release-version> <image-ref>
set -euo pipefail
VERSION="${1:?version}"
IMAGE="${2:?image}"
PREV_TAG="$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)"
RANGE="${PREV_TAG:+${PREV_TAG}..}HEAD"

mkdir -p reports
{
  echo "# TaskFlow API v${VERSION}"
  echo
  echo "- Released: $(date -u '+%Y-%m-%d %H:%M UTC') by Jenkins build #${BUILD_NUMBER:-local}"
  echo "- Image: \`${IMAGE}\`"
  echo "- Commit: \`$(git rev-parse --short HEAD)\`"
  echo "- Previous release: ${PREV_TAG:-none (first release)}"
  echo
  echo "## Changes"
  git log --no-merges --pretty='- %s (%h, %an)' "$RANGE" | head -50
} > reports/RELEASE_NOTES.md
cat reports/RELEASE_NOTES.md
