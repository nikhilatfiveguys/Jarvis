#!/bin/bash
# Create GitHub release v1.4.4 with only the update assets (zip + yml) so 1.4.1 users can update in-app.
# No signed DMG - just the zip and latest-mac.yml that electron-updater needs.
# Usage: GH_TOKEN=your_token ./release-update-only.sh
set -e
cd "$(dirname "$0")"
if [ -n "$GITHUB_TOKEN" ]; then
  export GH_TOKEN="$GITHUB_TOKEN"
fi

VERSION=$(node -p "require('./package.json').version")
TAG="v${VERSION}"
ZIP_SRC="dist/Jarvis 6.0-${VERSION}-arm64-mac.zip"
YML="dist/latest-mac.yml"
RELEASE_DIR="release-upload"
ZIP_NAME="Jarvis-6.0-${VERSION}-arm64-mac.zip"

if [ ! -f "$ZIP_SRC" ]; then
  echo "❌ Zip not found: $ZIP_SRC"
  exit 1
fi
if [ ! -f "$YML" ]; then
  echo "❌ latest-mac.yml not found: $YML"
  exit 1
fi

# Ensure yml references the filename we'll upload (hyphenated)
if grep -q "Jarvis 6.0-" "$YML"; then
  sed 's/Jarvis 6.0-/Jarvis-6.0-/g' "$YML" > "${YML}.tmp"
  mv "${YML}.tmp" "$YML"
fi

mkdir -p "$RELEASE_DIR"
rm -f "$RELEASE_DIR"/*
cp "$ZIP_SRC" "$RELEASE_DIR/$ZIP_NAME"
cp "$YML" "$RELEASE_DIR/latest-mac.yml"

NOTES=".github/release_notes/${TAG}.md"
[ -f "$NOTES" ] || NOTES="/dev/null"

echo "📤 Creating release ${TAG} (update assets only)..."
if gh release create "$TAG" --notes-file "$NOTES" --title "$TAG" "$RELEASE_DIR/$ZIP_NAME" "$RELEASE_DIR/latest-mac.yml" 2>/dev/null; then
  echo "✅ Release created. Users on 1.4.1 can now use Check for updates."
elif gh release view "$TAG" &>/dev/null; then
  echo "Uploading assets to existing release..."
  gh release upload "$TAG" "$RELEASE_DIR/$ZIP_NAME" "$RELEASE_DIR/latest-mac.yml" --clobber
  echo "✅ Release updated."
else
  echo "❌ Failed. Set GH_TOKEN or run: gh auth login"
  exit 1
fi

rm -rf "$RELEASE_DIR"
echo "   https://github.com/nikhilatfiveguys/Jarvis/releases/tag/${TAG}"
