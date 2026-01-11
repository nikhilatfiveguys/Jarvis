# macOS Comprehensive Stealth Mode Native Module

This native module provides **COMPLETE** invisibility from screen sharing and recording by implementing **ALL 10** known anti-capture methods used by professional stealth applications.

## How It Works

This module goes far beyond Electron's built-in `setContentProtection` API by implementing every known technique to hide windows from screen capture tools (Zoom, OBS, QuickTime, etc.):

### ✅ All 10 Anti-Capture Methods Implemented:

1. **GPU-Exclusive Rendering** - Uses layer-backed views with async GPU rendering that bypasses the normal display compositor
2. **Fullscreen Exclusive Mode** - Mimics fullscreen-exclusive games that Zoom cannot capture
3. **OS Privacy Restrictions** - Marks windows as secure/system-level (like password fields)
4. **Overlay Window Behavior** - Makes window appear as a non-capturable overlay, not a real window
5. **Secure Rendering** - Sets `NSWindowSharingNone` to prevent all screen sharing
6. **Hardware Video Surface Blocking** - Prevents capture of hardware-accelerated video surfaces
7. **Virtual Desktops Isolation** - Hides from Mission Control, Exposé, and Spaces capture
8. **Sandbox/Container Behavior** - Makes window appear as a secure containerized app
9. **System Overlay Prevention** - Uses screen-saver window level to appear above everything
10. **Protected Swapchain** - GPU-level protection similar to Windows DRM swapchains

This is the same comprehensive approach used by professional stealth apps like password managers, secure messaging apps, and privacy-focused tools.

## Building

### Prerequisites

1. **Xcode Command Line Tools** (required for compiling native modules)
   ```bash
   xcode-select --install
   ```

2. **Node.js** (already installed for Electron development)

3. **Build dependencies** (installed via npm):
   - `node-gyp` - Build tool for native modules
   - `node-addon-api` - Modern N-API bindings
   - `electron-rebuild` - Rebuilds native modules for Electron

### Build Steps

1. **Install dependencies** (from project root):
   ```bash
   npm install
   ```

2. **Build the native module**:
   ```bash
   cd native/mac-content-protection
   npm install
   ```

   Or from project root:
   ```bash
   npm run install-native
   ```

3. **Rebuild for Electron** (if needed):
   ```bash
   npm run rebuild-native
   ```

## Usage

The module is automatically loaded in `main.js` when running on macOS. It will:

1. Try to load the native module
2. If available, apply **ALL 10** stealth methods for complete invisibility
3. Fall back to Electron's built-in API (Method 5 only) if the module is not available

### Automatic Application

All windows automatically use comprehensive stealth mode when available via the `setWindowContentProtection()` helper method in `main.js`.

### Manual API Usage

```javascript
const contentProtection = require('./native/mac-content-protection');

// Apply ALL 10 methods at once (recommended)
contentProtection.applyComprehensiveStealth(window, true);

// Or use individual methods
contentProtection.setContentProtection(window, true);
contentProtection.hideFromMissionControl(window, true);
contentProtection.disableHardwareVideoCapture(window, true);
contentProtection.setFullscreenExclusiveMode(window, true);
contentProtection.setProtectedSwapchain(window, true);
contentProtection.setSandboxBehavior(window, true);
```

### Methods Available

- `applyComprehensiveStealth(window, enable)` - **MASTER FUNCTION** - Applies all 10 methods
- `setContentProtection(window, enable)` - Basic stealth (Methods 1, 3, 4, 5, 6, 7, 9, 10)
- `hideFromMissionControl(window, enable)` - Method 7: Virtual desktops isolation
- `disableHardwareVideoCapture(window, enable)` - Method 6: Video surface blocking
- `setFullscreenExclusiveMode(window, enable)` - Method 2: Fullscreen-exclusive behavior
- `setProtectedSwapchain(window, enable)` - Method 10: GPU-level protection
- `setSandboxBehavior(window, enable)` - Method 8: Containerized app behavior
- `isAvailable()` - Check if native module is loaded

## Troubleshooting

### "Module not found" error

This is normal if the module hasn't been built yet. The app will fall back to Electron's built-in API.

### Build errors

- Make sure Xcode Command Line Tools are installed: `xcode-select --install`
- Try cleaning and rebuilding: `cd native/mac-content-protection && npm run rebuild`
- Check that you're using the correct Node.js version (Electron's version)

### Module loads but doesn't work

- Check console logs for error messages
- Verify the module was built correctly: `ls -la build/Release/`
- Try rebuilding: `npm run rebuild-native`

## Technical Details

- **Language**: Objective-C++ (`.mm` files) and C++ (`.cc` files)
- **API**: N-API (Node.js Addon API)
- **macOS Framework**: AppKit (NSWindow)
- **Build System**: node-gyp

## Files

- `mac_content_protection.mm` - Objective-C++ implementation
- `mac_content_protection_binding.cc` - N-API bindings
- `binding.gyp` - Build configuration
- `index.js` - JavaScript wrapper/API
- `package.json` - Module metadata and build scripts

