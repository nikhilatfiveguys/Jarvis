#!/bin/bash

echo "🤖 Installing Jarvis 5.0 - AI Overlay Assistant"
echo "=============================================="

# Check if Python is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is required but not installed."
    echo "Please install Python 3 and try again."
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "index.html" ]; then
    echo "❌ Please run this script from the Jarvis 5.0 directory"
    exit 1
fi

echo "✅ Python 3 found"
echo "✅ All files are present"

# Make the script executable
chmod +x install.sh

echo ""
echo "🚀 Installation complete!"
echo ""
echo "To start Jarvis 5.0:"
echo "  ./install.sh start"
echo "  or"
echo "  python3 -m http.server 8000"
echo ""
echo "Then open your browser to: http://localhost:8000"
echo ""
echo "🎯 Features:"
echo "  • Say 'Jarvis' to activate"
echo "  • Press ⌘+⇧+Space to toggle overlay"
echo "  • Ask 'What am I looking at?' for screen analysis"
echo "  • Voice commands and text input supported"
echo ""
echo "⚠️  Note: You'll need to allow microphone and screen capture permissions"

