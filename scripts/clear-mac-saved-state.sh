#!/bin/bash
# Clears macOS "reopen windows" state so the "Electron unexpectedly quit" dialog stops appearing.
# Run once: ./scripts/clear-mac-saved-state.sh

set -e
SAVED_STATE="$HOME/Library/Saved Application State"
if [ -d "$SAVED_STATE/com.github.electron.savedState" ]; then
  rm -rf "$SAVED_STATE/com.github.electron.savedState"
  echo "Cleared Electron saved state. You can run 'npm start' again."
else
  echo "No Electron saved state found (already clear or different app name)."
fi
# Also clear if it was saved under a different bundle id
for dir in "$SAVED_STATE"/com.*.electron*.savedState "$SAVED_STATE"/*.jarvis*.savedState 2>/dev/null; do
  [ -d "$dir" ] && rm -rf "$dir" && echo "Cleared: $dir"
done
exit 0
