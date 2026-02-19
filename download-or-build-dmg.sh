#!/bin/bash
# Download the latest release .dmg to your Desktop, or build an unsigned one if none exists.
set -e
cd "$(dirname "$0")"
REPO="nikhilatfiveguys/Jarvis"
DESKTOP="$HOME/Desktop"

echo "Checking GitHub release for a .dmg..."
TMP_RELEASE=$(mktemp)
curl -s "https://api.github.com/repos/${REPO}/releases/latest" -o "$TMP_RELEASE" 2>/dev/null || true
DMG_INFO=$(node -e "
const fs=require('fs');
const p=process.argv[1];
try {
  const j=JSON.parse(fs.readFileSync(p,'utf8'));
  const assets=(j&&j.assets)||[];
  const dmg=assets.find(a=>a.name&&a.name.endsWith('.dmg'));
  if(dmg) console.log(dmg.browser_download_url + '\n' + dmg.name);
  else console.log('NO_DMG');
} catch(e){ console.log('NO_DMG'); }
" "$TMP_RELEASE" 2>/dev/null)
rm -f "$TMP_RELEASE"

if [ -n "$DMG_INFO" ] && [ "$DMG_INFO" != "NO_DMG" ]; then
  URL=$(echo "$DMG_INFO" | head -1)
  NAME=$(echo "$DMG_INFO" | tail -1)
  if [ -n "$URL" ] && [ "$URL" != "NO_DMG" ]; then
    echo "Downloading $NAME to Desktop..."
    curl -L -o "$DESKTOP/$NAME" "$URL"
    echo "Done. DMG on Desktop: $DESKTOP/$NAME"
    exit 0
  fi
fi

echo "No .dmg in latest release. Building unsigned DMG (~5 min)..."
npm run build-unsigned
if [ -d "$HOME/Desktop" ] && ls dist/*.dmg 1>/dev/null 2>&1; then
  cp dist/*.dmg "$HOME/Desktop/"
  echo "Done. Unsigned DMG on Desktop: $HOME/Desktop/"
fi
