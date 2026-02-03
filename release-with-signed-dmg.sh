#!/bin/bash
# Create GitHub release v1.4.4 (or current version) with signed DMG and update manifest.
# Run ./build-signed.sh first, then this script.
set -e
cd "$(dirname "$0")"
VERSION=$(node -p "require('./package.json').version")
SIGNED_DMG="dist/Jarvis-6.0-${VERSION}-SIGNED.dmg"
NOTES=".github/release_notes/v${VERSION}.md"
TAG="v${VERSION}"

if [ ! -f "$SIGNED_DMG" ]; then
    echo "❌ Signed DMG not found: $SIGNED_DMG"
    echo "   Run ./build-signed.sh first."
    exit 1
fi

# Zip and yml from the unsigned build (build-signed runs build-unsigned first)
ZIP_FILE=$(find dist/mac-arm64 -maxdepth 1 \( -name "Jarvis 6.0-${VERSION}-arm64-mac.zip" -o -name "Jarvis 6.0-${VERSION}-arm64.zip" \) 2>/dev/null | head -1)
if [ -z "$ZIP_FILE" ] || [ ! -f "$ZIP_FILE" ]; then
    echo "❌ Zip not found in dist/mac-arm64/ (expected Jarvis 6.0-${VERSION}-arm64-mac.zip or -arm64.zip)"
    exit 1
fi

YML="dist/latest-mac.yml"
if [ ! -f "$YML" ]; then
    echo "❌ Update manifest not found: $YML"
    exit 1
fi

# Prepare assets: updater expects "Jarvis.6.0-" in filenames
RELEASE_ZIP_NAME="Jarvis.6.0-${VERSION}-arm64-mac.zip"
RELEASE_DIR="dist/release-assets"
rm -rf "$RELEASE_DIR"
mkdir -p "$RELEASE_DIR"
cp "$SIGNED_DMG" "$RELEASE_DIR/"
cp "$ZIP_FILE" "$RELEASE_DIR/$RELEASE_ZIP_NAME"
# Fix yml paths so updater finds the zip (GitHub URLs use the asset filename)
sed 's/Jarvis 6.0-/Jarvis.6.0-/g' "$YML" > "$RELEASE_DIR/latest-mac.yml"

echo "📦 Creating release $TAG with:"
echo "   - $(basename "$SIGNED_DMG")"
echo "   - $RELEASE_ZIP_NAME"
echo "   - latest-mac.yml"
echo ""

if [ ! -f "$NOTES" ]; then
    echo "⚠️  Release notes not found: $NOTES"
    NOTES_ARGS=()
else
    NOTES_ARGS=(--notes-file "$NOTES")
fi

gh release create "$TAG" \
    "$RELEASE_DIR/$(basename "$SIGNED_DMG")" \
    "$RELEASE_DIR/$RELEASE_ZIP_NAME" \
    "$RELEASE_DIR/latest-mac.yml" \
    "${NOTES_ARGS[@]}" \
    --title "$TAG"

rm -rf "$RELEASE_DIR"
echo "✅ Release $TAG created. Installer: signed DMG; in-app updates: $RELEASE_ZIP_NAME + latest-mac.yml"
