# Native macOS Content Protection Module Setup

## Overview

A native module has been created to provide enhanced screen recording protection by directly accessing NSWindow APIs (similar to how Cluely does it).

## Current Status

The native module code is complete, but there's a build issue due to spaces in the project directory name ("Jarvis 5.0"). The module will gracefully fall back to Electron's built-in API if it can't be built.

## Files Created

- `native/mac-content-protection/mac_content_protection.mm` - Objective-C++ implementation
- `native/mac-content-protection/mac_content_protection_binding.cc` - N-API bindings  
- `native/mac-content-protection/binding.gyp` - Build configuration
- `native/mac-content-protection/index.js` - JavaScript wrapper
- `native/mac-content-protection/package.json` - Module metadata

## Building the Module

### Option 1: Rename Project Directory (Recommended)

The easiest solution is to rename the project directory to remove spaces:

```bash
cd ~/Desktop
mv "Jarvis 5.0" "Jarvis-5.0"
cd Jarvis-5.0
npm install
```

### Option 2: Build Manually

If you want to keep the current directory name, you can try building manually:

```bash
cd native/mac-content-protection
npm install
npm run rebuild
```

### Option 3: Use Electron Rebuild from Project Root

```bash
cd "/Users/aaronsoni/Desktop/Jarvis 5.0"
npx electron-rebuild -f -w mac_content_protection
```

## How It Works

1. The module uses NSWindow's `sharingType` property set to `NSWindowSharingNone`
2. This prevents the window from appearing in screen recordings
3. The app automatically uses the native module if available, otherwise falls back to Electron's API

## Integration

The module is already integrated into `main.js`:
- Automatically loads on macOS
- Used via `setWindowContentProtection()` helper method
- All windows (main, paywall, onboarding, account) use it automatically

## Testing

1. Build the module (see options above)
2. Start the app: `npm start`
3. Check console for: `✅ Native content protection module loaded`
4. Test screen recording - the app windows should not appear

## Troubleshooting

### Module doesn't load
- Check console for error messages
- Verify the module was built: `ls -la native/mac-content-protection/build/Release/`
- The app will still work using Electron's built-in API

### Build errors
- Make sure Xcode Command Line Tools are installed: `xcode-select --install`
- Try renaming the project directory to remove spaces
- Check that node-addon-api is installed: `npm list node-addon-api`

## Next Steps

Once the build issue is resolved (by renaming the directory), the native module will provide enhanced screen recording protection similar to Cluely.

