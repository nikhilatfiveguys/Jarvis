#!/bin/bash

# Set your Apple credentials as environment variables
export APPLE_ID="aaronsoni06@gmail.com"
export APPLE_ID_PASSWORD="lijb-fdhv-oqmj-cwwp"
export APPLE_TEAM_ID="DMH3RU9FQQ"

# Set code signing identity
export CSC_NAME="Developer ID Application: Aaron Soni (DMH3RU9FQQ)"

echo "🔨 Building signed and notarized DMG..."
echo "📦 This will create a DMG with drag-to-Applications layout"
echo "🔐 Using signing identity: $CSC_NAME"

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf dist-unsigned/mac-arm64 dist/mac-arm64 dist/mac 2>/dev/null || true
find dist dist-unsigned -name "*.dmg" -delete 2>/dev/null || true

# Build the unsigned app (using unsigned config to skip electron-builder signing)
# Unset signing env so electron-builder does not try to sign pkg/dmg (we sign manually after)
unset CSC_NAME CSC_LINK CSC_KEY_PASSWORD CSC_IDENTITY_AUTO_DISCOVERY
# Give Node more heap to avoid OOM during packaging (electron-builder is memory-heavy)
export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=8192"
echo "📦 Building app (unsigned)..."
npm run build-unsigned

if [ $? -ne 0 ]; then
    echo "❌ Build failed. Check the error messages above."
    exit 1
fi

# Find the built app (electron-builder-unsigned outputs Jarvis.app to dist-unsigned)
APP_NAME="Jarvis"
APP_PATH=""
if [ -d "dist-unsigned/mac-arm64/${APP_NAME}.app" ]; then
    APP_PATH="dist-unsigned/mac-arm64/${APP_NAME}.app"
fi
if [ -z "$APP_PATH" ]; then
    APP_PATH=$(find dist-unsigned dist -name "${APP_NAME}.app" -type d 2>/dev/null | head -1)
fi
if [ -z "$APP_PATH" ]; then
    APP_PATH=$(find dist-unsigned dist -name "*.app" -type d -path "*/mac-arm64/*" 2>/dev/null | head -1)
fi

if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
    echo "❌ Error: Could not find built app in dist-unsigned/"
    exit 1
fi

# Strip ALL extended attributes from the built app BEFORE copying
echo "🧹 Stripping extended attributes from built app..."
xattr -cr "$APP_PATH"
find "$APP_PATH" -exec xattr -c {} \; 2>/dev/null || true
echo "  ✅ Extended attributes stripped"

echo "🔐 Signing app using your method..."

IDENTITY="Developer ID Application: Aaron Soni (DMH3RU9FQQ)"
ENTITLEMENTS="build/entitlements.mac.plist"

# Create a clean copy using tar to strip ALL extended attributes
SIGN_APP="$HOME/Desktop/${APP_NAME}-TO-SIGN.app"
rm -rf "$SIGN_APP"

echo "  Copying app using tar (strips all extended attributes)..."
# Use tar to copy - this strips ALL extended attributes and resource forks
cd "$(dirname "$APP_PATH")"
tar -cf - "$(basename "$APP_PATH")" | tar -xf - -C "$HOME/Desktop/"
mv "$HOME/Desktop/$(basename "$APP_PATH")" "$SIGN_APP"
cd - > /dev/null

# Double check with xattr -d to remove any remaining provenance
echo "  Forcefully removing com.apple.provenance..."
find "$SIGN_APP" -exec xattr -d com.apple.provenance {} \; 2>/dev/null || true
find "$SIGN_APP" -exec xattr -d com.apple.quarantine {} \; 2>/dev/null || true
find "$SIGN_APP" -name '._*' -delete 2>/dev/null || true
echo "  Verifying main exec has no xattrs..."
xattr -l "$SIGN_APP/Contents/MacOS/${APP_NAME}" 2>&1 || echo "  ✅ No extended attributes on main exec"

echo "  Signing components..."

# Sign all nested libraries and helpers
if [ -d "$SIGN_APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries" ]; then
    echo "    Signing Electron Framework libraries..."
    codesign --force --sign "$IDENTITY" --timestamp "$SIGN_APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/"*.dylib 2>/dev/null || true
fi

if [ -f "$SIGN_APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler" ]; then
    echo "    Signing chrome_crashpad_handler..."
    codesign --force --sign "$IDENTITY" --options runtime --timestamp --entitlements "$ENTITLEMENTS" "$SIGN_APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler"
fi

if [ -f "$SIGN_APP/Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt" ]; then
    echo "    Signing ShipIt..."
    codesign --force --sign "$IDENTITY" --options runtime --timestamp --entitlements "$ENTITLEMENTS" "$SIGN_APP/Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt"
fi

echo "    Signing frameworks..."
for framework in "$SIGN_APP/Contents/Frameworks/"*.framework; do
    if [ -d "$framework" ]; then
        codesign --force --sign "$IDENTITY" --options runtime --timestamp "$framework"
    fi
done

echo "    Signing helper apps..."
# Sign all Electron helper apps (GPU, Renderer, Plugin, and base Helper)
for helper in "$SIGN_APP/Contents/Frameworks/"*Helper*.app; do
    if [ -d "$helper" ]; then
        echo "      Signing: $(basename "$helper")"
        # Sign the helper's main executable first
        helper_exec="$helper/Contents/MacOS/$(basename "$helper" .app)"
        if [ -f "$helper_exec" ]; then
            xattr -cr "$helper_exec"
            codesign --force --sign "$IDENTITY" --options runtime --timestamp --entitlements "$ENTITLEMENTS" "$helper_exec" 2>&1 | grep -v "resource fork" || true
        fi
        # Then sign the helper app bundle
        xattr -cr "$helper"
        codesign --force --sign "$IDENTITY" --options runtime --timestamp --entitlements "$ENTITLEMENTS" "$helper" 2>&1 | grep -v "resource fork" || true
    fi
done

# Sign all .node native addons in app.asar.unpacked (required for notarization)
UNPACKED="$SIGN_APP/Contents/Resources/app.asar.unpacked"
if [ -d "$UNPACKED" ]; then
    echo "    Signing native addons (.node) in app.asar.unpacked..."
    while IFS= read -r -d '' f; do
        if [ -f "$f" ]; then
            xattr -cr "$f" 2>/dev/null || true
            codesign --force --sign "$IDENTITY" --options runtime --timestamp --entitlements "$ENTITLEMENTS" "$f" 2>&1 | grep -v "resource fork" || true
            echo "      Signed: $(basename "$f")"
        fi
    done < <(find "$UNPACKED" -name "*.node" -type f -print0 2>/dev/null)
fi

# Clean ALL extended attributes and resource forks from entire bundle BEFORE signing
echo "  Cleaning all extended attributes from app bundle..."
find "$SIGN_APP" -name '._*' -delete 2>/dev/null || true
xattr -cr "$SIGN_APP" 2>/dev/null || true

# Use ditto to create a completely clean copy (removes all resource forks)
echo "  Creating clean copy of app bundle (removing resource forks)..."
CLEAN_APP="$HOME/Desktop/${APP_NAME}-CLEAN.app"
rm -rf "$CLEAN_APP"
ditto --norsrc --noextattr --noacl "$SIGN_APP" "$CLEAN_APP"
rm -rf "$SIGN_APP"
mv "$CLEAN_APP" "$SIGN_APP"

# Sign main executable
echo "  Signing main executable..."
MAIN_EXEC="$SIGN_APP/Contents/MacOS/${APP_NAME}"
if [ -f "$MAIN_EXEC" ]; then
    echo "    Found main executable: ${APP_NAME}"
    codesign --force --sign "$IDENTITY" --options runtime --timestamp --entitlements "$ENTITLEMENTS" "$MAIN_EXEC"
    echo "    Verifying main executable signature..."
    codesign --verify --verbose "$MAIN_EXEC" && echo "    ✅ Main executable signed" || echo "    ❌ Main executable signing failed"
else
    echo "    ❌ Main executable not found at: $MAIN_EXEC"
    ls -la "$SIGN_APP/Contents/MacOS/"
fi

# Sign main app bundle
echo "  Signing main app bundle..."
codesign --force --deep --sign "$IDENTITY" --options runtime --timestamp --entitlements "$ENTITLEMENTS" "$SIGN_APP"
echo "  Verifying app bundle signature..."
codesign --verify --deep --strict "$SIGN_APP" && echo "  ✅ App bundle signed" || echo "  ⚠️ App bundle verification had issues"

# Verify signature
echo "  Verifying signature..."
codesign --verify --deep --strict --verbose=2 "$SIGN_APP" 2>&1 | head -5
if codesign --verify --deep --strict "$SIGN_APP" 2>/dev/null; then
    echo "  ✅ App signed successfully!"
else
    echo "  ⚠️ Signature verification had warnings, but continuing..."
fi

# Replace original app with signed version
echo "  Replacing original app with signed version..."
rm -rf "$APP_PATH"
ditto --norsrc --noextattr --noacl "$SIGN_APP" "$APP_PATH"
rm -rf "$SIGN_APP"

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")

# Notarize the APP first (required: Apple checks contents when notarizing DMG)
echo "🍎 Notarizing app (required before DMG so Gatekeeper accepts the app inside)..."
mkdir -p dist
APP_ZIP="dist/${APP_NAME}-${VERSION}-for-notarization.zip"
rm -f "$APP_ZIP"
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$APP_ZIP"
xattr -cr "$APP_ZIP" 2>/dev/null || true
NOTARY_APP_OUTPUT=$(mktemp)
xcrun notarytool submit "$APP_ZIP" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_ID_PASSWORD" --wait 2>&1 | tee "$NOTARY_APP_OUTPUT"
NOTARY_EXIT=${PIPESTATUS[0]}
SUBMIT_ID=$(grep -oE 'id: [a-fA-F0-9-]+' "$NOTARY_APP_OUTPUT" 2>/dev/null | head -1 | sed 's/id: *//')
if [ "$NOTARY_EXIT" -eq 0 ] && grep -q "status: Accepted" "$NOTARY_APP_OUTPUT" 2>/dev/null; then
  echo "  Stapling notarization ticket to app..."
  xcrun stapler staple "$APP_PATH"
  if xcrun stapler validate "$APP_PATH" 2>/dev/null; then
    echo "  ✅ App notarized and stapled."
  fi
  rm -f "$NOTARY_APP_OUTPUT" "$APP_ZIP"
else
  echo "  ⚠️ App notarization failed (status was not Accepted). Apple's rejection reason:"
  if [ -n "$SUBMIT_ID" ]; then
    echo "  Submission ID: $SUBMIT_ID"
    xcrun notarytool log "$SUBMIT_ID" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_ID_PASSWORD" 2>&1 || true
  fi
  rm -f "$NOTARY_APP_OUTPUT"
  echo "  ❌ Fix the issues above and re-run this script. Exiting."
  exit 1
fi

echo "📦 Creating DMG from signed and notarized app (v$VERSION)..."
DMG_NAME="${APP_NAME}-${VERSION}-arm64-SIGNED.dmg"
DMG_PATH="dist/$DMG_NAME"
rm -f "$DMG_PATH"

# Clean up any existing mounted volumes
for vol in "/Volumes/AccessibilityAssistantInstall"*; do
    hdiutil detach "$vol" -force 2>/dev/null || true
done
hdiutil detach /dev/disk4 -force 2>/dev/null || true
hdiutil detach /dev/disk5 -force 2>/dev/null || true

# Create DMG with create-dmg (app + arrow + Applications folder layout)
# Requires: brew install create-dmg
DMG_TEMP="$PWD/dmg-staging"
rm -rf "$DMG_TEMP"
mkdir -p "$DMG_TEMP"
echo "  Copying app to staging..."
ditto --norsrc --noextattr --noacl "$APP_PATH" "$DMG_TEMP/$(basename "$APP_PATH")"
xattr -cr "$DMG_TEMP" 2>/dev/null || true

# Create arrow background (dark gray bg, light gray arrow)
mkdir -p "$DMG_TEMP/.background"
python3 << 'PYTHONSCRIPT'
import struct, zlib
def png_chunk(ct, data):
    cl, cc = len(data), zlib.crc32(ct + data) & 0xffffffff
    return struct.pack('>I', cl) + ct + data + struct.pack('>I', cc)
w, h = 600, 400
sig = b'\x89PNG\r\n\x1a\n'
ihdr = png_chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
bg, arr = (60, 60, 60), (200, 200, 200)
cx, cy = w//2, h//2 + 30
raw = b''
for y in range(h):
    raw += b'\x00'
    for x in range(w):
        rx, ry = x - cx, y - cy
        ar = (-40 <= rx <= 10 and -6 <= ry <= 6) or (10 <= rx <= 35 and -20*(1-(rx-10)/25) <= ry <= 20*(1-(rx-10)/25))
        raw += bytes(arr if ar else bg)
open('dmg-staging/.background/background.png', 'wb').write(sig + ihdr + png_chunk(b'IDAT', zlib.compress(raw, 9)) + png_chunk(b'IEND', b''))
PYTHONSCRIPT

echo "  Creating styled DMG (app + arrow + Applications)..."
rm -f "$DMG_PATH" dist/rw.*.dmg 2>/dev/null || true
# Use unique volname to avoid conflicts with existing mounts
VOLNAME="JarvisInstall"
if command -v create-dmg &>/dev/null; then
    create-dmg \
        --volname "$VOLNAME" \
        --window-size 600 400 \
        --window-pos 200 200 \
        --icon-size 100 \
        --icon "${APP_NAME}.app" 120 200 \
        --app-drop-link 430 200 \
        --background "$DMG_TEMP/.background/background.png" \
        --skip-jenkins \
        "$DMG_PATH" \
        "$DMG_TEMP" || DMG_PATH=""
else
    echo "  ⚠️ create-dmg not found (brew install create-dmg). Using basic hdiutil..."
    ln -s /Applications "$DMG_TEMP/Applications"
    hdiutil create -volname "Jarvis" -srcfolder "$DMG_TEMP" -format UDZO -ov "$DMG_PATH" 2>/dev/null || DMG_PATH=""
fi
rm -rf "$DMG_TEMP"

if [ ! -f "$DMG_PATH" ]; then
    echo "  ⚠️ DMG creation failed"
    DMG_PATH=""
fi

if [ -n "$DMG_PATH" ] && [ -f "$DMG_PATH" ]; then
    # Strip extended attributes from DMG file so signing/notarization see a clean file
    xattr -c "$DMG_PATH" 2>/dev/null || true
    echo "🔐 Signing DMG..."
    codesign --sign "$IDENTITY" --timestamp "$DMG_PATH" 2>&1 | grep -v "resource fork" || echo "  ⚠️ DMG signing had warnings, but DMG exists"
else
    echo "  ⚠️ DMG creation failed, but app is signed at: $APP_PATH"
    DMG_PATH=""
fi

echo ""
if [ -n "$DMG_PATH" ] && [ -f "$DMG_PATH" ]; then
  echo "🍎 Notarizing DMG (required for Gatekeeper; prevents 'disk is damaged')..."
  NOTARY_OUTPUT=$(mktemp)
  if xcrun notarytool submit "$DMG_PATH" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_ID_PASSWORD" --wait 2>&1 | tee "$NOTARY_OUTPUT"; then
    echo "  Stapling notarization ticket to DMG..."
    xcrun stapler staple "$DMG_PATH"
    if xcrun stapler validate "$DMG_PATH" 2>/dev/null; then
      echo "  ✅ DMG notarized and stapled. Users can open it without 'disk is damaged'."
    fi
    rm -f "$NOTARY_OUTPUT"
  else
    echo "  ⚠️ Notarization failed. Fetching Apple's rejection reason..."
    SUBMIT_ID=$(grep -oE 'id: [a-fA-F0-9-]+' "$NOTARY_OUTPUT" | head -1 | sed 's/id: *//')
    if [ -n "$SUBMIT_ID" ]; then
      echo "  Notary submission ID: $SUBMIT_ID"
      xcrun notarytool log "$SUBMIT_ID" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_ID_PASSWORD" 2>&1 || true
    fi
    rm -f "$NOTARY_OUTPUT"
    echo "  DMG is signed but NOT notarized; users will see 'disk is damaged'. Fix the issues above and rebuild."
  fi
fi

# Create signed PKG installer (double-click to install to /Applications, no drag-and-drop)
PKG_NAME="${APP_NAME}-${VERSION}-SIGNED.pkg"
PKG_PATH="dist/$PKG_NAME"
rm -f "$PKG_PATH"
if [ -n "$APP_PATH" ] && [ -d "$APP_PATH" ]; then
  echo ""
  echo "📦 Creating installer package (v$VERSION)..."
  # pkgbuild --component installs the .app to /Applications
  if pkgbuild --component "$APP_PATH" \
    --identifier "com.assistive.runtime" \
    --version "$VERSION" \
    --install-location "/Applications" \
    "$PKG_PATH" 2>/dev/null; then
    echo "  ✅ PKG created."
    echo "🔐 Signing PKG..."
    if codesign --sign "$IDENTITY" --timestamp "$PKG_PATH" 2>/dev/null; then
      echo "🍎 Notarizing PKG..."
      NOTARY_OUTPUT_PKG=$(mktemp)
      if xcrun notarytool submit "$PKG_PATH" --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_ID_PASSWORD" --wait 2>&1 | tee "$NOTARY_OUTPUT_PKG"; then
        xcrun stapler staple "$PKG_PATH"
        echo "  ✅ PKG notarized and stapled."
        if [ -d "$HOME/Desktop" ]; then
          cp "$PKG_PATH" "$HOME/Desktop/"
          echo "📥 Installer copied to Desktop: $HOME/Desktop/$PKG_NAME"
        fi
      else
        echo "  ⚠️ PKG notarization failed (PKG is signed but not notarized)."
      fi
      rm -f "$NOTARY_OUTPUT_PKG"
    else
      echo "  ⚠️ PKG signing failed."
    fi
  else
    echo "  ⚠️ PKG creation failed."
  fi
fi

echo "✅ Build and signing complete!"
echo "📁 Signed DMG: $DMG_PATH"
if [ -n "$DMG_PATH" ] && [ -f "$DMG_PATH" ] && [ -d "$HOME/Desktop" ]; then
  cp "$DMG_PATH" "$HOME/Desktop/"
  echo "📥 Copied to Desktop: $HOME/Desktop/$(basename "$DMG_PATH")"
fi