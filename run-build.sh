#!/bin/bash
# Run build and capture all output to a log file.
set -e
cd "$(dirname "$0")"
LOG="$PWD/build-log.txt"
echo "Build started at $(date)" > "$LOG"
echo "Node: $(node --version)" >> "$LOG"
echo "npm: $(npm --version)" >> "$LOG"
echo "Running rebuild-native..." >> "$LOG"
node scripts/rebuild-native-if-darwin.js >> "$LOG" 2>&1
echo "Running electron-builder..." >> "$LOG"
npx electron-builder --config electron-builder-unsigned.json --mac >> "$LOG" 2>&1
VERSION=$(node -p "require('./package.json').version")
PRODUCT_NAME="Jarvis"
DMG="dist-unsigned/${PRODUCT_NAME}-${VERSION}-arm64.dmg"
if [ -f "$DMG" ]; then
  cp "$DMG" "$PWD/Accessibility-Assistant-${VERSION}-UNSIGNED.dmg"
  [ -d "$HOME/Desktop" ] && cp "$DMG" "$HOME/Desktop/Accessibility-Assistant-${VERSION}-UNSIGNED.dmg"
  echo "SUCCESS: DMG in project dir and Desktop" >> "$LOG"
else
  echo "FAIL: DMG not found at $DMG" >> "$LOG"
  ls -la dist/ >> "$LOG" 2>&1
  exit 1
fi
echo "Build finished at $(date)" >> "$LOG"
