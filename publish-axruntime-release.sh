#!/bin/bash
# Publish Jarvis/AXRuntime release to GitHub so users can update from previous versions.
# Uses signed DMG if available, else unsigned. Includes latest-mac.yml for electron-updater.
# Usage: gh auth login  (or GH_TOKEN=xxx) then ./publish-axruntime-release.sh
set -e
cd "$(dirname "$0")"
if [ -n "$GITHUB_TOKEN" ]; then
  export GH_TOKEN="$GITHUB_TOKEN"
fi

VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"

# Prefer signed DMG, fallback to unsigned. Support both Jarvis and AXRuntime naming.
SIGNED_DMG=""
for p in "dist/Jarvis-${VERSION}-arm64-SIGNED.dmg" \
         "dist/AXRuntime-${VERSION}-arm64-SIGNED.dmg" \
         "$HOME/Desktop/Jarvis-${VERSION}-arm64-SIGNED.dmg" \
         "$HOME/Desktop/AXRuntime-${VERSION}-arm64-SIGNED.dmg"; do
  [ -f "$p" ] && SIGNED_DMG="$p" && break
done

DMG="${SIGNED_DMG}"
if [ -z "$DMG" ]; then
  for p in "dist-unsigned/Jarvis-${VERSION}-arm64.dmg" "dist-unsigned/AXRuntime-${VERSION}-arm64.dmg"; do
    [ -f "$p" ] && DMG="$p" && break
  done
fi
if [ ! -f "$DMG" ]; then
  echo "❌ DMG not found. Run ./build-signed.sh or npm run build-unsigned first."
  exit 1
fi

echo "📂 Using DMG: $DMG"

# Zip for electron-updater (Jarvis or AXRuntime naming)
ZIP=""
for p in "dist-unsigned/Jarvis-${VERSION}-arm64-mac.zip" "dist-unsigned/AXRuntime-${VERSION}-arm64-mac.zip"; do
  if [ -f "$p" ]; then ZIP="$p"; break; fi
done
if [ -z "$ZIP" ]; then
  echo "⚠️  Zip not found - in-app updates may not work. Run npm run build-unsigned first."
fi
ZIP_BASENAME=$(basename "$ZIP" 2>/dev/null || true)

# Prepare release assets
RELEASE_DIR="release-upload"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"

# Copy DMG with consistent name for download
cp "$DMG" "$RELEASE_DIR/Jarvis-${VERSION}-arm64.dmg"

# Copy zip if available
[ -n "$ZIP" ] && [ -f "$ZIP" ] && cp "$ZIP" "$RELEASE_DIR/"

# Generate latest-mac.yml for electron-updater (app name Jarvis)
if [ -f "$ZIP" ]; then
  echo "📝 Generating latest-mac.yml..."
  SIZE=$(stat -f%z "$ZIP" 2>/dev/null || stat -c%s "$ZIP" 2>/dev/null)
  SHA512=$(shasum -a 512 "$ZIP" 2>/dev/null | cut -d' ' -f1)
  RELEASE_DATE=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
  [ -n "$ZIP_BASENAME" ] || ZIP_BASENAME="Jarvis-${VERSION}-arm64-mac.zip"
  cat > "$RELEASE_DIR/latest-mac.yml" << EOF
version: ${VERSION}
files:
  - url: ${ZIP_BASENAME}
    sha512: ${SHA512}
    size: ${SIZE}
path: ${ZIP_BASENAME}
sha512: ${SHA512}
releaseDate: '${RELEASE_DATE}'
EOF
  echo "   ✅ latest-mac.yml created"
fi

ASSET_COUNT=$(ls -1 "$RELEASE_DIR" 2>/dev/null | wc -l)
echo ""
echo "📤 Creating release ${TAG} with ${ASSET_COUNT} asset(s)..."
NOTES=".github/release_notes/${TAG}.md"
[ -f "$NOTES" ] || NOTES="/dev/null"

if gh release create "$TAG" --notes-file "$NOTES" --title "$TAG" "$RELEASE_DIR"/* 2>/dev/null; then
  echo "✅ Release created."
elif gh release view "$TAG" &>/dev/null; then
  echo "Release ${TAG} already exists, uploading assets..."
  gh release upload "$TAG" "$RELEASE_DIR"/* --clobber
else
  echo "❌ Failed. Run: gh auth login"
  exit 1
fi

rm -rf "$RELEASE_DIR"
echo ""
echo "✅ Release ${TAG} is live:"
echo "   https://github.com/nikhilatfiveguys/Jarvis/releases/tag/${TAG}"
echo ""
echo "Users on previous versions can update via Menu → Check for updates."
