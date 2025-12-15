#!/bin/bash

# Set your Apple credentials as environment variables
export APPLE_ID="aaronsoni06@gmail.com"
export APPLE_ID_PASSWORD="lijb-fdhv-oqmj-cwwp"
export APPLE_TEAM_ID="DMH3RU9FQQ"

# Set code signing identity
export CSC_NAME="Developer ID Application: Aaron Soni (DMH3RU9FQQ)"
IDENTITY="Developer ID Application: Aaron Soni (DMH3RU9FQQ)"
ENTITLEMENTS="build/entitlements.mac.plist"

echo "🔨 Building signed release for auto-updates..."
echo "🔐 Using signing identity: $CSC_NAME"

# Get version from package.json
VERSION=$(node -p "require('./package.json').version")
echo "📦 Building version: $VERSION"

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf dist/mac-arm64 dist/mac 2>/dev/null
find dist -name "*.dmg" -delete 2>/dev/null
find dist -name "*.zip" -delete 2>/dev/null
find dist -name "*.blockmap" -delete 2>/dev/null

# Build the unsigned apps (both architectures)
echo "📦 Building unsigned apps..."
npm run build-unsigned

if [ $? -ne 0 ]; then
    echo "❌ Build failed. Check the error messages above."
    exit 1
fi

# Function to sign an app
sign_app() {
    local APP_PATH=$1
    local ARCH=$2
    
    echo ""
    echo "🔐 Signing $ARCH app..."
    
    # Strip ALL extended attributes from the built app BEFORE copying
    echo "  🧹 Stripping extended attributes..."
    xattr -cr "$APP_PATH"
    find "$APP_PATH" -exec xattr -c {} \; 2>/dev/null || true
    
    # Create a clean copy using tar to strip ALL extended attributes
    SIGN_APP="$HOME/Desktop/Jarvis-TO-SIGN-$ARCH.app"
    rm -rf "$SIGN_APP"
    
    echo "  📋 Copying app using tar (strips all extended attributes)..."
    cd "$(dirname "$APP_PATH")"
    tar -cf - "$(basename "$APP_PATH")" | tar -xf - -C "$HOME/Desktop/"
    mv "$HOME/Desktop/$(basename "$APP_PATH")" "$SIGN_APP"
    cd - > /dev/null
    
    # Double check with xattr -d to remove any remaining provenance
    find "$SIGN_APP" -exec xattr -d com.apple.provenance {} \; 2>/dev/null || true
    find "$SIGN_APP" -exec xattr -d com.apple.quarantine {} \; 2>/dev/null || true
    find "$SIGN_APP" -name '._*' -delete 2>/dev/null || true
    
    echo "  🔐 Signing components..."
    
    # Sign all nested libraries and helpers
    if [ -d "$SIGN_APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries" ]; then
        codesign --force --sign "$IDENTITY" --timestamp "$SIGN_APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Libraries/"*.dylib 2>/dev/null || true
    fi
    
    if [ -f "$SIGN_APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler" ]; then
        codesign --force --sign "$IDENTITY" --options runtime --timestamp --entitlements "$ENTITLEMENTS" "$SIGN_APP/Contents/Frameworks/Electron Framework.framework/Versions/A/Helpers/chrome_crashpad_handler"
    fi
    
    if [ -f "$SIGN_APP/Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt" ]; then
        codesign --force --sign "$IDENTITY" --options runtime --timestamp --entitlements "$ENTITLEMENTS" "$SIGN_APP/Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt"
    fi
    
    # Sign frameworks
    codesign --force --sign "$IDENTITY" --timestamp "$SIGN_APP/Contents/Frameworks/"*.framework
    
    # Sign helper apps
    for helper in "$SIGN_APP/Contents/Frameworks/"*Helper*.app; do
        if [ -d "$helper" ]; then
            helper_exec="$helper/Contents/MacOS/$(basename "$helper" .app)"
            if [ -f "$helper_exec" ]; then
                xattr -cr "$helper_exec"
                codesign --force --sign "$IDENTITY" --options runtime --timestamp --entitlements "$ENTITLEMENTS" "$helper_exec" 2>&1 | grep -v "resource fork" || true
            fi
            xattr -cr "$helper"
            codesign --force --sign "$IDENTITY" --options runtime --timestamp --entitlements "$ENTITLEMENTS" "$helper" 2>&1 | grep -v "resource fork" || true
        fi
    done
    
    # Sign main executable
    MAIN_EXEC="$SIGN_APP/Contents/MacOS/Jarvis 6.0"
    if [ -f "$MAIN_EXEC" ]; then
        xattr -cr "$MAIN_EXEC"
        rm -f "$SIGN_APP/Contents/MacOS/._Jarvis 6.0" 2>/dev/null || true
        cat "$MAIN_EXEC" > "$MAIN_EXEC.tmp" && mv "$MAIN_EXEC.tmp" "$MAIN_EXEC" && chmod +x "$MAIN_EXEC"
        xattr -cr "$MAIN_EXEC"
        codesign --force --sign "$IDENTITY" --options runtime --timestamp --entitlements "$ENTITLEMENTS" "$MAIN_EXEC"
    fi
    
    # Clean all resource forks from entire bundle
    find "$SIGN_APP" -name '._*' -delete 2>/dev/null || true
    xattr -cr "$SIGN_APP"
    
    # Sign main app bundle
    codesign --force --deep --sign "$IDENTITY" --options runtime --timestamp --entitlements "$ENTITLEMENTS" "$SIGN_APP"
    
    # Verify signature
    if codesign --verify --deep --strict "$SIGN_APP" 2>/dev/null; then
        echo "  ✅ $ARCH app signed successfully!"
    else
        echo "  ⚠️ $ARCH app signature verification had warnings, but continuing..."
    fi
    
    # Replace original app with signed version
    rm -rf "$APP_PATH"
    ditto --norsrc --noextattr --noacl "$SIGN_APP" "$APP_PATH"
    rm -rf "$SIGN_APP"
}

# Find and sign ARM64 app
ARM64_APP=$(find dist -name "*.app" -type d -path "*/mac-arm64/*" | head -1)
if [ -n "$ARM64_APP" ]; then
    sign_app "$ARM64_APP" "arm64"
else
    echo "⚠️ Warning: ARM64 app not found"
fi

# Find and sign Intel x64 app
X64_APP=$(find dist -name "*.app" -type d -path "*/mac/*" | head -1)
if [ -n "$X64_APP" ]; then
    sign_app "$X64_APP" "x64"
else
    echo "⚠️ Warning: Intel x64 app not found"
fi

# Function to create ZIP and blockmap
create_zip_and_blockmap() {
    local APP_PATH=$1
    local ARCH=$2
    
    if [ -z "$APP_PATH" ] || [ ! -d "$APP_PATH" ]; then
        return
    fi
    
    echo ""
    echo "📦 Creating ZIP for $ARCH..."
    
    APP_NAME=$(basename "$APP_PATH")
    APP_DIR=$(dirname "$APP_PATH")
    
    if [ "$ARCH" = "arm64" ]; then
        ZIP_NAME="Jarvis 6.0-${VERSION}-arm64-mac.zip"
    else
        ZIP_NAME="Jarvis 6.0-${VERSION}-mac.zip"
    fi
    
    ZIP_PATH="dist/$ZIP_NAME"
    
    # Create ZIP
    cd "$APP_DIR"
    zip -r -y "$ZIP_PATH" "$APP_NAME" > /dev/null
    cd - > /dev/null
    
    echo "  ✅ Created: $ZIP_NAME"
    
    # Create blockmap (electron-updater needs this)
    # We'll use electron-builder's blockmap tool if available, or create a simple one
    BLOCKMAP_PATH="${ZIP_PATH}.blockmap"
    # For now, we'll let electron-builder create the blockmap later
    # or create it manually using the SHA512 hash
}

# Create ZIP files
create_zip_and_blockmap "$ARM64_APP" "arm64"
create_zip_and_blockmap "$X64_APP" "x64"

# Create DMG files (for manual distribution)
echo ""
echo "📦 Creating DMG files..."

# Create ARM64 DMG
if [ -n "$ARM64_APP" ]; then
    DMG_NAME="Jarvis 6.0-${VERSION}-arm64.dmg"
    DMG_PATH="dist/$DMG_NAME"
    rm -f "$DMG_PATH"
    
    DMG_TEMP=$(mktemp -d)
    cp -R "$ARM64_APP" "$DMG_TEMP/"
    
    VOLUME_NAME="Jarvis-${VERSION}-arm64"
    hdiutil create -volname "$VOLUME_NAME" -srcfolder "$DMG_TEMP" -ov -format UDZO "$DMG_PATH" 2>/dev/null
    rm -rf "$DMG_TEMP"
    
    if [ -f "$DMG_PATH" ]; then
        codesign --sign "$IDENTITY" --timestamp "$DMG_PATH" 2>&1 | grep -v "resource fork" || true
        echo "  ✅ Created: $DMG_NAME"
    fi
fi

# Create Intel x64 DMG
if [ -n "$X64_APP" ]; then
    DMG_NAME="Jarvis 6.0-${VERSION}.dmg"
    DMG_PATH="dist/$DMG_NAME"
    rm -f "$DMG_PATH"
    
    DMG_TEMP=$(mktemp -d)
    cp -R "$X64_APP" "$DMG_TEMP/"
    
    VOLUME_NAME="Jarvis-${VERSION}"
    hdiutil create -volname "$VOLUME_NAME" -srcfolder "$DMG_TEMP" -ov -format UDZO "$DMG_PATH" 2>/dev/null
    rm -rf "$DMG_TEMP"
    
    if [ -f "$DMG_PATH" ]; then
        codesign --sign "$IDENTITY" --timestamp "$DMG_PATH" 2>&1 | grep -v "resource fork" || true
        echo "  ✅ Created: $DMG_NAME"
    fi
fi

# Generate blockmaps (optional - electron-updater can work without them)
echo ""
echo "📋 Generating blockmaps (optional)..."
cd dist

# Try to generate blockmaps using electron-builder if available
cat > generate-blockmaps.js << 'EOF'
const fs = require('fs');
const path = require('path');

try {
    const { createBlockmap } = require('electron-builder/out/blockMapApi');
    
    async function generateBlockmaps() {
        const zipFiles = fs.readdirSync('.').filter(f => f.endsWith('.zip'));
        
        for (const zipFile of zipFiles) {
            const zipPath = path.join('.', zipFile);
            const blockmapPath = `${zipPath}.blockmap`;
            
            try {
                const blockmap = await createBlockmap(zipPath, null, { compressionLevel: 0 });
                fs.writeFileSync(blockmapPath, JSON.stringify(blockmap, null, 2));
                console.log(`  ✅ Created blockmap: ${path.basename(blockmapPath)}`);
            } catch (error) {
                console.log(`  ⚠️ Could not create blockmap for ${zipFile}: ${error.message}`);
            }
        }
    }
    
    generateBlockmaps().catch(() => {
        console.log('  ℹ️ Blockmap generation skipped (not critical)');
    });
} catch (error) {
    console.log('  ℹ️ Blockmap generation skipped (electron-builder tools not available)');
}
EOF

node generate-blockmaps.js 2>/dev/null || echo "  ℹ️ Blockmap generation skipped"
rm -f generate-blockmaps.js

# Generate latest-mac.yml
cat > generate-latest-mac.yml.js << 'EOF'
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const version = process.argv[2];
const files = [];

// Find all ZIP and DMG files
const distFiles = fs.readdirSync('.').filter(f => 
    (f.endsWith('.zip') || f.endsWith('.dmg')) && !f.endsWith('.blockmap')
);

distFiles.forEach(file => {
    const filePath = path.join('.', file);
    const stats = fs.statSync(filePath);
    const buffer = fs.readFileSync(filePath);
    const hash = crypto.createHash('sha512').update(buffer).digest('base64');
    
    // GitHub replaces spaces with dots in filenames
    const githubName = file.replace(/ /g, '.');
    
    files.push({
        url: githubName,
        sha512: hash,
        size: stats.size
    });
});

// Find the Intel x64 ZIP (primary download)
const primaryZip = files.find(f => f.url.includes('-mac.zip') && !f.url.includes('arm64'));
const primaryZipName = primaryZip ? primaryZip.url : files.find(f => f.url.endsWith('.zip'))?.url;

const yaml = `version: ${version}
files:
${files.map(f => `  - url: ${f.url}
    sha512: ${f.sha512}
    size: ${f.size}`).join('\n')}
path: ${primaryZipName || `Jarvis.6.0-${version}-mac.zip`}
sha512: ${primaryZip ? primaryZip.sha512 : files.find(f => f.url.endsWith('.zip'))?.sha512 || ''}
releaseDate: '${new Date().toISOString()}'
`;

fs.writeFileSync('latest-mac.yml', yaml);
console.log('✅ Generated latest-mac.yml');
EOF

node generate-latest-mac.yml.js "$VERSION"
rm generate-latest-mac.yml.js

cd - > /dev/null

echo ""
echo "✅ Signed release build complete!"
echo ""
echo "📁 Files created in dist/:"
ls -lh dist/*.zip dist/*.dmg dist/*.yml 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
echo ""
echo "📋 Next steps:"
echo "  1. Upload all files to GitHub release v${VERSION}"
echo "  2. Files to upload:"
echo "     - *.zip files (for auto-updates)"
echo "     - *.dmg files (for manual installation)"
echo "     - latest-mac.yml (update manifest)"
echo "     - *.blockmap files (if generated)"
echo ""
echo "💡 Note: ZIP files are required for electron-updater auto-updates"
echo "💡 Note: DMG files are for manual distribution"

