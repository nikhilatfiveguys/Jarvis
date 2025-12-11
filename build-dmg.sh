#!/bin/bash

# Jarvis DMG Build Script
# Creates a distributable DMG with all stealth mode features

set -e  # Exit on error

echo "🚀 Building Jarvis 6.0 DMG with Ultimate Stealth Mode"
echo "=" | head -c 60
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Check prerequisites
echo -e "${BLUE}📋 Step 1: Checking prerequisites...${NC}"
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js first."
    exit 1
fi
echo "✅ Node.js found: $(node --version)"

if ! command -v npm &> /dev/null; then
    echo "❌ npm not found. Please install npm first."
    exit 1
fi
echo "✅ npm found: $(npm --version)"
echo ""

# Step 2: Install dependencies
echo -e "${BLUE}📦 Step 2: Installing dependencies...${NC}"
npm install
echo "✅ Dependencies installed"
echo ""

# Step 3: Rebuild native module
echo -e "${BLUE}🔧 Step 3: Building native stealth module...${NC}"
npm run rebuild-native
echo "✅ Native module built (15+ stealth methods included)"
echo ""

# Step 4: Test stealth mode
echo -e "${BLUE}🧪 Step 4: Testing stealth mode...${NC}"
npm run test-stealth
if [ $? -ne 0 ]; then
    echo "❌ Stealth mode test failed"
    exit 1
fi
echo "✅ All stealth tests passed"
echo ""

# Step 5: Build DMG
echo -e "${BLUE}🏗️  Step 5: Building DMG...${NC}"
echo "This may take a few minutes..."
npm run build-unsigned

if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi
echo ""

# Step 6: Show results
echo -e "${GREEN}🎉 BUILD COMPLETE!${NC}"
echo ""
echo "📦 DMG files created in ./dist/"
echo ""

# List DMG files
if [ -d "dist" ]; then
    echo "Available DMG files:"
    ls -lh dist/*.dmg 2>/dev/null | awk '{print "  📀", $9, "(" $5 ")"}'
    echo ""
    
    # Show installation instructions
    echo -e "${YELLOW}📖 Installation Instructions:${NC}"
    echo ""
    echo "1. Navigate to the dist folder:"
    echo "   cd dist"
    echo ""
    echo "2. Double-click the DMG file to mount it"
    echo ""
    echo "3. Drag Jarvis 6.0.app to Applications folder"
    echo ""
    echo "4. Right-click the app and select 'Open'"
    echo "   (First time only - bypasses Gatekeeper)"
    echo ""
    echo "5. Grant permissions when prompted:"
    echo "   - Screen Recording"
    echo "   - Microphone (optional)"
    echo ""
    echo -e "${GREEN}✨ Jarvis with Ultimate Stealth Mode is ready!${NC}"
    echo ""
    echo "🔒 Stealth Features:"
    echo "  ✅ 15+ anti-capture methods"
    echo "  ✅ DRM-style protection (like Netflix)"
    echo "  ✅ Secure input (like password fields)"
    echo "  ✅ Metal exclusive rendering (like games)"
    echo "  ✅ Protected overlay (invisible HUD)"
    echo "  ✅ Banking app protection"
    echo ""
    echo "🎯 Result: INVISIBLE in Zoom/screen sharing!"
else
    echo "❌ dist folder not found - build may have failed"
    exit 1
fi










