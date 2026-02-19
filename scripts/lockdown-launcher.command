#!/bin/bash
# Run this BEFORE opening Lockdown Browser. It watches for Jarvis and relaunches it
# when Lockdown kills it. Runs independently (not a child of Jarvis) so it survives.
# Double-click to run, or: open -a Terminal scripts/lockdown-launcher.command

cd "$(dirname "$0")/.." || exit 1
QUIT="$HOME/Library/Application Support/Jarvis/.jarvis-quitting"

echo "Jarvis Lockdown Launcher - watching for Jarvis..."
echo "Leave this window open while taking your exam. Press Ctrl+C to stop."
echo ""

while true; do
  if [ -f "$QUIT" ]; then
    echo "[$(date +%H:%M:%S)] Quit file exists, stopping."
    exit 0
  fi
  if ! pgrep -x Jarvis >/dev/null; then
    echo "[$(date +%H:%M:%S)] Jarvis not running - launching..."
    open -a "Jarvis" 2>/dev/null || open -a "Jarvis.app"
  fi
  sleep 1
done
