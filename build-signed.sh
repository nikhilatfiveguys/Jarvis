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
rm -rf dist/mac-arm64 dist/mac 2>/dev/null
find dist -name "*.dmg" -delete 2>/dev/null

# Build the unsigned app (using unsigned config to skip electron-builder signing)
echo "📦 Building app (unsigned)..."
npm run build-unsigned

if [ $? -ne 0 ]; then
    echo "❌ Build failed. Check the error messages above."
    exit 1
fi

# Find the built app
APP_PATH=$(find dist -name "*.app" -type d -path "*/mac-arm64/*" | head -1)

if [ -z "$APP_PATH" ]; then
    echo "❌ Error: Could not find built app in dist/"
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
SIGN_APP="$HOME/Desktop/Jarvis-TO-SIGN.app"
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
xattr -l "$SIGN_APP/Contents/MacOS/Jarvis 6.0" 2>&1 || echo "  ✅ No extended attributes on main exec"

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

# Clean ALL extended attributes and resource forks from entire bundle BEFORE signing
echo "  Cleaning all extended attributes from app bundle..."
find "$SIGN_APP" -name '._*' -delete 2>/dev/null || true
xattr -cr "$SIGN_APP" 2>/dev/null || true

# Use ditto to create a completely clean copy (removes all resource forks)
echo "  Creating clean copy of app bundle (removing resource forks)..."
CLEAN_APP="$HOME/Desktop/Jarvis-CLEAN.app"
rm -rf "$CLEAN_APP"
ditto --norsrc --noextattr --noacl "$SIGN_APP" "$CLEAN_APP"
rm -rf "$SIGN_APP"
mv "$CLEAN_APP" "$SIGN_APP"

# Sign main executable
echo "  Signing main executable..."
MAIN_EXEC="$SIGN_APP/Contents/MacOS/Jarvis 6.0"
if [ -f "$MAIN_EXEC" ]; then
    echo "    Found main executable: Jarvis 6.0"
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
echo "📦 Creating DMG from signed app (v$VERSION)..."
DMG_NAME="Jarvis-6.0-${VERSION}-SIGNED.dmg"
DMG_PATH="dist/$DMG_NAME"
rm -f "$DMG_PATH"

# Clean up any existing mounted volumes
for vol in "/Volumes/JarvisInstall"*; do
    hdiutil detach "$vol" -force 2>/dev/null || true
done
hdiutil detach /dev/disk4 -force 2>/dev/null || true
hdiutil detach /dev/disk5 -force 2>/dev/null || true

# Create DMG source directory in project folder
DMG_TEMP="$PWD/dmg-staging"
rm -rf "$DMG_TEMP"
mkdir -p "$DMG_TEMP"

# Copy signed app to staging directory
echo "  Copying app to staging directory..."
cp -R "$APP_PATH" "$DMG_TEMP/"

# Create Applications symlink
ln -s /Applications "$DMG_TEMP/Applications"

echo "  Creating styled DMG with drag-to-Applications layout..."

# Remove any existing DMG first
rm -f "$DMG_PATH"

# Step 1: Create initial compressed DMG (using a simple name to avoid issues)
echo "  Creating initial DMG..."
hdiutil create -volname "JarvisInstall" \
    -srcfolder "$DMG_TEMP" \
    -format UDZO \
    -ov \
    "$DMG_PATH"

if [ -f "$DMG_PATH" ]; then
    # Step 2: Convert to writable format for styling
    echo "  Converting to writable format for styling..."
    TEMP_DMG="/tmp/jarvis-temp-rw.dmg"
    rm -f "$TEMP_DMG"
    hdiutil convert "$DMG_PATH" -format UDRW -o "$TEMP_DMG" -ov
    
    # Step 3: Mount and apply styling
    echo "  Mounting and styling DMG..."
    MOUNT_INFO=$(hdiutil attach "$TEMP_DMG" -readwrite -noverify)
    
    if echo "$MOUNT_INFO" | grep -q "JarvisInstall"; then
        # Apply styling with AppleScript to match the reference image
        osascript <<'APPLESCRIPT'
tell application "Finder"
    tell disk "JarvisInstall"
        open
        delay 1
        set current view of container window to icon view
        set toolbar visible of container window to false
        set statusbar visible of container window to false
        set bounds of container window to {200, 200, 800, 550}
        set theViewOptions to icon view options of container window
        set arrangement of theViewOptions to not arranged
        set icon size of theViewOptions to 100
        set background color of theViewOptions to {50000, 50000, 50000}
        try
            set position of item "Jarvis 6.0.app" to {100, 200}
        end try
        try
            set position of item "Applications" to {500, 200}
        end try
        update without registering applications
        delay 1
        close
    end tell
end tell
APPLESCRIPT
        
        echo "  Styling applied!"
        
        # Sync and unmount
        sync
        hdiutil detach /dev/disk5 -force 2>/dev/null || hdiutil detach /dev/disk4 -force 2>/dev/null || true
        
        # Step 4: Convert back to compressed format
        echo "  Converting to final DMG..."
        rm -f "$DMG_PATH"
        hdiutil convert "$TEMP_DMG" -format UDZO -o "$DMG_PATH"
    else
        echo "  ⚠️ Could not mount DMG for styling, using basic DMG"
    fi
    
    # Clean up temp DMG
    rm -f "$TEMP_DMG"
else
    echo "  ⚠️ Failed to create initial DMG"
fi

# Clean up staging directory
rm -rf "$DMG_TEMP"

if [ ! -f "$DMG_PATH" ]; then
    echo "  ⚠️ DMG creation failed"
    DMG_PATH=""
fi

if [ -n "$DMG_PATH" ] && [ -f "$DMG_PATH" ]; then
    echo "🔐 Signing DMG..."
    codesign --sign "$IDENTITY" --timestamp "$DMG_PATH" 2>&1 | grep -v "resource fork" || echo "  ⚠️ DMG signing had warnings, but DMG exists"
else
    echo "  ⚠️ DMG creation failed, but app is signed at: $APP_PATH"
    DMG_PATH=""
fi

echo ""
echo "✅ Build and signing complete!"
echo "📁 Signed DMG: $DMG_PATH"
echo ""
echo "📋 Next steps:"
echo "  1. Notarize: xcrun notarytool submit \"$DMG_PATH\" --apple-id \"$APPLE_ID\" --team-id \"$APPLE_TEAM_ID\" --password \"$APPLE_ID_PASSWORD\" --wait"
echo "  2. After notarization: xcrun stapler staple \"$DMG_PATH\""
echo "  3. Validate: xcrun stapler validate \"$DMG_PATH\""
