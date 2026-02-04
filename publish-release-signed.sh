#!/bin/bash
# Build the SIGNED DMG (with JarvisInstall window + arrow) and publish to GitHub Releases.
# Run from repo root. Requires: npm, gh (GitHub CLI) or GITHUB_TOKEN, Apple signing in build-signed.sh.
# Usage: GH_TOKEN=your_token ./publish-release-signed.sh   OR   gh auth login && ./publish-release-signed.sh
set -e
cd "$(dirname "$0")"
if [ -n "$GITHUB_TOKEN" ]; then
  export GH_TOKEN="$GITHUB_TOKEN"
fi
VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"
SIGNED_DMG="dist/Jarvis-6.0-${VERSION}-SIGNED.dmg"

echo "📦 Building signed Jarvis ${VERSION} (DMG with arrow)..."
./build-signed.sh

if [ ! -f "$SIGNED_DMG" ]; then
  echo "❌ Signed DMG not found: $SIGNED_DMG"
  exit 1
fi

echo "📂 Collecting release assets (signed DMG + zip + yml for updates)..."
mkdir -p release-upload
rm -f release-upload/*
cp "$SIGNED_DMG" release-upload/
# Zip and yml from the unsigned build (build-signed runs build-unsigned first)
for f in dist/mac-arm64/"Jarvis 6.0-${VERSION}"*.zip dist/mac-arm64/"Jarvis 6.0-${VERSION}"*.dmg dist/"Jarvis 6.0-${VERSION}"*.zip dist/latest-mac.yml; do
  [ -f "$f" ] && cp "$f" release-upload/
done
# Rename "Jarvis 6.0-" to "Jarvis-6.0-" for consistency with 1.4.1
cd release-upload
for f in "Jarvis 6.0-"*; do
  [ -e "$f" ] || continue
  new="${f//Jarvis 6.0-/Jarvis-6.0-}"
  [ "$f" != "$new" ] && mv -v "$f" "$new"
done
cd ..
# Fix yml for updater
if [ -f release-upload/latest-mac.yml ]; then
  sed 's/Jarvis 6.0-/Jarvis-6.0-/g' release-upload/latest-mac.yml > release-upload/latest-mac.yml.tmp
  mv release-upload/latest-mac.yml.tmp release-upload/latest-mac.yml
fi

ASSET_COUNT=$(ls -1 release-upload 2>/dev/null | wc -l)
echo "📤 Creating release ${TAG} with ${ASSET_COUNT} asset(s) (signed DMG with arrow)..."
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
echo "✅ Release ${TAG} is live with signed DMG (JarvisInstall + arrow):"
echo "   https://github.com/nikhilatfiveguys/Jarvis/releases/tag/${TAG}"