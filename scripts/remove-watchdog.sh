#!/bin/bash
# Run this to fully remove the AXRuntime watchdog. Safe to run anytime.

echo "Removing AXRuntime watchdog..."

# Kill AXRuntime app
pkill -9 -x AXRuntime 2>/dev/null || true
pkill -9 -f "AXRuntime Helper" 2>/dev/null || true

# Kill all watchdog processes
pkill -9 -f axruntime-watchdog 2>/dev/null || true

# Kill rescue processes (sleep 5; open -a AXRuntime)
for pid in $(pgrep -f "sleep 5" 2>/dev/null); do
  kill -9 $pid 2>/dev/null
done

# Unload and remove launch agent
PLIST="$HOME/Library/LaunchAgents/com.axruntime.watchdog.plist"
launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl remove com.axruntime.watchdog 2>/dev/null || true
rm -f "$PLIST"

# Remove script
rm -f "$HOME/Library/Application Support/AXRuntime/axruntime-watchdog.sh"

# Quit flag (stops rescue from relaunching)
touch "$HOME/Library/Application Support/AXRuntime/.axruntime-quitting"
touch "$HOME/Library/Application Support/jarvis-6.0/.axruntime-quitting" 2>/dev/null || true

echo "Done. Watchdog removed."
echo "Tip: Delete the OLD AXRuntime app to prevent reinstalling it."
