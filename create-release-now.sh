#!/bin/bash
# Create the v1.4.4 release on GitHub right now (notes only). Assets can be added by running ./publish-release.sh after building.
# Usage: GITHUB_TOKEN=your_token ./create-release-now.sh
# Or: gh auth login, then run this (uses gh).
set -e
cd "$(dirname "$0")"
VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"
NOTES=".github/release_notes/${TAG}.md"
[ -f "$NOTES" ] || { echo "## $TAG" > /tmp/notes.md; NOTES=/tmp/notes.md; }

if command -v gh &>/dev/null && gh auth status &>/dev/null; then
  echo "Creating release ${TAG} with notes (no assets)..."
  gh release create "$TAG" --notes-file "$NOTES" --title "$TAG" 2>/dev/null && echo "✅ Done." || \
  { echo "Release may already exist. Run ./publish-release.sh to build and upload assets."; exit 0; }
  exit 0
fi

if [ -z "$GITHUB_TOKEN" ]; then
  echo "Set GITHUB_TOKEN=your_github_token or run: gh auth login"
  exit 1
fi

BODY=$(jq -Rs . < "$NOTES" 2>/dev/null || echo '"Release '"$TAG"'"')
curl -sS -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/nikhilatfiveguys/Jarvis/releases" \
  -d "{\"tag_name\":\"$TAG\",\"name\":\"$TAG\",\"body\":$BODY}" > /tmp/release.json
if grep -q '"id"' /tmp/release.json; then
  echo "✅ Release ${TAG} created: https://github.com/nikhilatfiveguys/Jarvis/releases/tag/${TAG}"
else
  grep -o '"message":"[^"]*"' /tmp/release.json || cat /tmp/release.json
  echo "Run ./publish-release.sh to build and upload assets."
  exit 1
fi