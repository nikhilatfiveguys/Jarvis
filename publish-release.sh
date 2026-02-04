#!/bin/bash
# Build and publish v1.4.4 to GitHub Releases with assets (same as 1.4.1).
# Run from repo root. Requires: npm, gh (GitHub CLI) logged in.
set -e
cd "$(dirname "$0")"
VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"

echo "📦 Building Jarvis ${VERSION} (unsigned)..."
npm run build-unsigned

echo "📂 Collecting release assets..."
mkdir -p release-upload
rm -f release-upload/*
# electron-builder puts outputs in dist/ and dist/mac-arm64/
for dir in dist dist/mac-arm64 dist/mac; do
  [ -d "$dir" ] || continue
  for f in "$dir"/*.dmg "$dir"/*.zip "$dir"/latest-mac.yml; do
    [ -f "$f" ] && [[ "$f" == *"$VERSION"* || "$f" == *"latest-mac"* ]] && cp "$f" release-upload/
  done
done
# Rename "Jarvis 6.0-" to "Jarvis-6.0-" to match 1.4.1 asset names
cd release-upload
for f in "Jarvis 6.0-"*; do
  [ -e "$f" ] || continue
  new="${f//Jarvis 6.0-/Jarvis-6.0-}"
  [ "$f" != "$new" ] && mv -v "$f" "$new"
done
cd ..
# Fix yml paths for updater
if [ -f release-upload/latest-mac.yml ]; then
  (sed 's/Jarvis 6.0-/Jarvis-6.0-/g' release-upload/latest-mac.yml > release-upload/latest-mac.yml.tmp) && mv release-upload/latest-mac.yml.tmp release-upload/latest-mac.yml
fi

ASSET_COUNT=$(ls -1 release-upload 2>/dev/null | wc -l)
if [ "$ASSET_COUNT" -eq 0 ]; then
  echo "❌ No assets found in dist/ for version ${VERSION}. Check build output."
  exit 1
fi

echo "📤 Creating release ${TAG} with ${ASSET_COUNT} asset(s)..."
NOTES=".github/release_notes/${TAG}.md"
[ -f "$NOTES" ] || NOTES="/dev/null"
if gh release create "$TAG" --notes-file "$NOTES" --title "$TAG" release-upload/* 2>/dev/null; then
  echo "✅ Release created."
elif gh release view "$TAG" &>/dev/null; then
  echo "Release ${TAG} already exists, uploading assets..."
  gh release upload "$TAG" release-upload/* --clobber
else
  echo "❌ Failed to create release. Run: gh auth login"
  exit 1
fi

rm -rf release-upload
echo "✅ Release ${TAG} is live: https://github.com/nikhilatfiveguys/Jarvis/releases/tag/${TAG}"