# 🚀 Setup Guide for Jarvis 5.0

Complete guide for setting up Jarvis 5.0 for development and distribution.

## 📋 Prerequisites

- macOS 10.15 (Catalina) or later
- Node.js 14.0.0 or later
- npm (comes with Node.js)
- Git (for version control)

## 🔧 Development Setup

### 1. Clone the Repository
```bash
git clone https://github.com/aaronsoni/jarvis-5.0.git
cd jarvis-5.0
```

### 2. Install Dependencies
```bash
npm install
```

This will install:
- Electron v28.0.0
- electron-builder
- screenshot-desktop
- run-applescript

### 3. Configure API Keys

The app requires API keys for AI functionality:

1. Copy the example environment file:
   ```bash
   cp env.example .env
   ```

2. Edit `.env` and add your API keys:
   ```bash
   # Perplexity API Key (required)
   PPLX_API_KEY=your-perplexity-api-key-here
   
   # OpenAI API Key (optional)
   OPENAI_API_KEY=your-openai-api-key-here
   ```

3. Get API keys:
   - Perplexity: https://www.perplexity.ai/settings/api
   - OpenAI: https://platform.openai.com/api-keys

### 4. Start Development
```bash
# Start the app
npm start

# Or start with dev tools
npm run dev
```

## 🏗️ Building for Distribution

### Option 1: Using Electron Builder (Recommended)

**Requirements:**
- Apple Developer account (for code signing)
- Developer ID Application certificate

```bash
npm run build
```

Output will be in `dist/` folder.

### Option 2: Manual Build (No Code Signing)

For quick distribution without code signing:

1. The app is already built in your workspace
2. Share the `dist-manual/Jarvis 5.0.dmg` file
3. Users will need to right-click and "Open" to bypass security

## 🔐 Code Signing (Optional but Recommended)

For a professional release without security warnings:

### 1. Get Certificates
1. Enroll in Apple Developer Program ($99/year)
2. Create a Developer ID Application certificate in Xcode
3. Download and install the certificate

### 2. Configure electron-builder

Add to `package.json`:
```json
{
  "build": {
    "mac": {
      "identity": "Developer ID Application: Your Name (TEAMID)",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist"
    }
  }
}
```

### 3. Create Entitlements File

Create `build/entitlements.mac.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

### 4. Notarize (macOS 10.14.5+)

Add notarization to build process:
```bash
npm install @electron/notarize --save-dev
```

## 📦 Distribution

### For GitHub Releases

1. **Create a Release:**
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

2. **Upload DMG:**
   - Go to GitHub Releases
   - Create a new release
   - Upload `Jarvis 5.0.dmg`
   - Add release notes

### For Direct Distribution

1. **Share the DMG file** from `dist-manual/`
2. **Include instructions** for users (already in README.txt)
3. **Inform users** they need to right-click to open

## 🧪 Testing

### Before Release
- [ ] Test on clean macOS installation
- [ ] Verify all features work
- [ ] Check screen recording permission prompt
- [ ] Check microphone permission prompt
- [ ] Test voice activation
- [ ] Test screen analysis
- [ ] Test app launching
- [ ] Test website opening

### Testing on Another Mac
1. Copy DMG to another Mac
2. Install the app
3. Right-click and "Open"
4. Grant permissions
5. Test all features

## 🐛 Troubleshooting

### Build Fails
```bash
# Clean and reinstall
rm -rf node_modules package-lock.json
npm install
npm run build
```

### "Damaged File" Error
This is normal for unsigned apps. Users should:
1. Right-click the app → Open
2. Or use Terminal: `sudo xattr -rd com.apple.quarantine "/Applications/Jarvis 5.0.app"`

### Missing Dependencies
Make sure `node_modules` is included in the build:
```json
{
  "build": {
    "files": [
      "**/*",
      "node_modules/**/*"
    ]
  }
}
```

## 📚 Additional Resources

- [Electron Documentation](https://www.electronjs.org/docs)
- [Electron Builder Docs](https://www.electron.build/)
- [Apple Code Signing Guide](https://developer.apple.com/support/code-signing/)
- [Perplexity API Docs](https://docs.perplexity.ai/)

## 🆘 Getting Help

- Check [GitHub Issues](https://github.com/aaronsoni/jarvis-5.0/issues)
- Read the [FAQ](README.md#faq)
- Contact the maintainer

---

Happy coding! 🎉

