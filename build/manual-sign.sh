#!/bin/bash

# Manual signing script - signs the app after electron-builder packages it
# This bypasses electron-builder's automatic signing which fails due to provenance attributes

set -e

APP_PATH="$1"
IDENTITY="${CSC_NAME:-Developer ID Application: Aaron Soni (DMH3RU9FQQ)}"
ENTITLEMENTS="build/entitlements.mac.plist"

if [ -z "$APP_PATH" ]; then
    echo "Usage: manual-sign.sh <path-to-app>"
    exit 1
fi

if [ ! -d "$APP_PATH" ]; then
    echo "Error: App not found at $APP_PATH"
    exit 1
fi

echo "🔐 Manually signing app at: $APP_PATH"
echo "🔐 Using identity: $IDENTITY"

# Sign all helper executables first
echo "Signing helper executables..."
find "$APP_PATH/Contents/Frameworks" -name "*.app" -type d | while read helper_app; do
    helper_executable="$helper_app/Contents/MacOS/$(basename "$helper_app" .app)"
    if [ -f "$helper_executable" ]; then
        echo "  Signing: $(basename "$helper_executable")"
        codesign --sign "$IDENTITY" \
            --force \
            --timestamp \
            --options runtime \
            --entitlements "$ENTITLEMENTS" \
            "$helper_executable" || {
            echo "  ⚠️ Failed to sign with entitlements, trying without..."
            codesign --sign "$IDENTITY" \
                --force \
                --timestamp \
                --options runtime \
                "$helper_executable"
        }
    fi
done

# Sign the main executable
echo "Signing main executable..."
MAIN_EXECUTABLE="$APP_PATH/Contents/MacOS/$(basename "$APP_PATH" .app)"
if [ -f "$MAIN_EXECUTABLE" ]; then
    echo "  Cleaning main executable before signing..."
    # Remove any existing signature
    codesign --remove-signature "$MAIN_EXECUTABLE" 2>/dev/null || true
    # Remove extended attributes
    xattr -c "$MAIN_EXECUTABLE" 2>/dev/null || true
    # Try to remove provenance specifically
    xattr -d com.apple.provenance "$MAIN_EXECUTABLE" 2>/dev/null || true
    
    # Copy file to strip metadata - try multiple methods
    TEMP_EXEC="${MAIN_EXECUTABLE}.temp"
    
    # Method 1: Use cp -X to strip extended attributes
    cp -X "$MAIN_EXECUTABLE" "$TEMP_EXEC" 2>/dev/null || {
        # Method 2: Use ditto without resource forks
        ditto --norsrc --noextattr "$MAIN_EXECUTABLE" "$TEMP_EXEC" 2>/dev/null || {
            # Method 3: Use cat (fallback)
            cat "$MAIN_EXECUTABLE" > "$TEMP_EXEC"
        }
    }
    
    chmod +x "$TEMP_EXEC"
    
    # Clear all extended attributes from temp file
    xattr -c "$TEMP_EXEC" 2>/dev/null || true
    xattr -d com.apple.provenance "$TEMP_EXEC" 2>/dev/null || true
    
    # Replace original
    rm -f "$MAIN_EXECUTABLE"
    mv "$TEMP_EXEC" "$MAIN_EXECUTABLE"
    
    # Final cleanup
    xattr -c "$MAIN_EXECUTABLE" 2>/dev/null || true
    
    # Use SetFile to clear Finder info if available
    if command -v SetFile &> /dev/null; then
        SetFile -a c "$MAIN_EXECUTABLE" 2>/dev/null || true
    fi
    
    echo "  Attempting to sign main executable..."
    # Try signing without --options runtime first (sometimes this works)
    codesign --sign "$IDENTITY" \
        --force \
        --timestamp \
        "$MAIN_EXECUTABLE" 2>&1 && {
        echo "  ✅ Signed without runtime options, now adding runtime..."
        # Now try to add runtime options
        codesign --sign "$IDENTITY" \
            --force \
            --timestamp \
            --options runtime \
            --entitlements "$ENTITLEMENTS" \
            "$MAIN_EXECUTABLE" 2>&1 || {
            echo "  ⚠️ Couldn't add runtime options, but basic signature succeeded"
        }
    } || {
        echo "  ⚠️ Basic signing failed, trying with runtime options..."
        codesign --sign "$IDENTITY" \
            --force \
            --timestamp \
            --options runtime \
            "$MAIN_EXECUTABLE" 2>&1 || {
            echo "  ❌ All signing attempts failed - this is the provenance attribute issue"
            echo "  💡 The helpers signed successfully, but main executable has provenance attribute"
            echo "  💡 You may need to sign manually or rebuild on a different Mac"
            exit 1
        }
    }
    echo "  ✅ Main executable signed successfully!"
fi

# Sign the app bundle itself
echo "Signing app bundle..."
codesign --sign "$IDENTITY" \
    --force \
    --deep \
    --timestamp \
    --options runtime \
    --entitlements "$ENTITLEMENTS" \
    "$APP_PATH" || {
    echo "  ⚠️ Failed to sign with entitlements, trying without..."
    codesign --sign "$IDENTITY" \
        --force \
        --deep \
        --timestamp \
        --options runtime \
        "$APP_PATH"
}

# Verify the signature
echo "Verifying signature..."
codesign --verify --deep --strict --verbose=2 "$APP_PATH" && {
    echo "✅ App signed successfully!"
} || {
    echo "❌ Signature verification failed"
    exit 1
}

echo "✅ Manual signing complete!"

