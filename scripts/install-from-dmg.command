#!/bin/bash
# Install AXRuntime from DMG using ditto (avoids "items had to be skipped" Finder error)
# Run this from the same folder as the DMG, or pass the DMG path as argument.

set -e
cd "$(dirname "$0")"
SCRIPT_DIR="$(pwd)"

# Find DMG
DMG_PATH=""
if [ -n "$1" ] && [ -f "$1" ]; then
  DMG_PATH="$1"
elif [ -f "$SCRIPT_DIR/../dist-unsigned/AXRuntime-1.4.6-arm64.dmg" ]; then
  DMG_PATH="$SCRIPT_DIR/../dist-unsigned/AXRuntime-1.4.6-arm64.dmg"
elif [ -f "$SCRIPT_DIR/../dist/AXRuntime-1.4.6-arm64.dmg" ]; then
  DMG_PATH="$SCRIPT_DIR/../dist/AXRuntime-1.4.6-arm64.dmg"
elif [ -f "$HOME/Desktop/AXRuntime-1.4.6-arm64.dmg" ]; then
  DMG_PATH="$HOME/Desktop/AXRuntime-1.4.6-arm64.dmg"
else
  echo "No AXRuntime DMG found. Drag the DMG onto this script, or put it in Desktop."
  echo "Looking for: AXRuntime-*-arm64.dmg"
  read -p "Press Enter to exit"
  exit 1
fi

echo "Using DMG: $DMG_PATH"
echo "Mounting..."
MOUNT_OUT=$(hdiutil attach -nobrowse -quiet "$DMG_PATH" 2>&1)
VOLUME=$(echo "$MOUNT_OUT" | grep -o '/Volumes/[^[:space:]]*' | head -1)

if [ -z "$VOLUME" ]; then
  echo "Failed to mount DMG"
  echo "$MOUNT_OUT"
  exit 1
fi

APP_PATH="$VOLUME/AXRuntime.app"
if [ ! -d "$APP_PATH" ]; then
  APP_PATH="$VOLUME/"*.app
  APP_PATH=$(echo $APP_PATH | head -1)
fi

if [ ! -d "$APP_PATH" ]; then
  echo "Could not find AXRuntime.app in $VOLUME"
  hdiutil detach "$VOLUME" 2>/dev/null || true
  exit 1
fi

echo "Installing to /Applications using ditto..."
ditto "$APP_PATH" "/Applications/$(basename "$APP_PATH")"

echo "Unmounting..."
hdiutil detach "$VOLUME" -quiet 2>/dev/null || true

echo "Done! AXRuntime installed to /Applications"
open -R "/Applications/$(basename "$APP_PATH")"
read -p "Press Enter to exit"
