#!/bin/bash

# Jarvis 5.0 - True Overlay Launcher
# This script launches the overlay in fullscreen mode

echo "🚀 Launching Jarvis 5.0 True Overlay..."

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Launch Chrome in fullscreen overlay mode
open -a "Google Chrome" --args \
  --new-window \
  --start-fullscreen \
  --app="$SCRIPT_DIR/overlay.html" \
  --disable-web-security \
  --allow-running-insecure-content \
  --disable-features=VizDisplayCompositor \
  --enable-features=VaapiVideoDecoder

echo "✅ Jarvis overlay launched! Use these shortcuts:"
echo "   • Double-click anywhere to show overlay"
echo "   • Click outside to hide overlay"
echo "   • Cmd+Shift+Space to toggle overlay"
echo "   • Cmd+Shift+A to activate and focus"
echo "   • Escape to hide overlay"
echo ""
echo "🔧 To stop: Close Chrome or press Cmd+Q"
