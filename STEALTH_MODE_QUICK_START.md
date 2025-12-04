# Stealth Mode Quick Start Guide

## What is Stealth Mode?

Jarvis implements **comprehensive stealth mode** that makes the app **completely invisible** in screen recordings, screen sharing (Zoom, Teams, Meet, etc.), and screenshots - while remaining fully visible on your screen.

This uses the same technology as password managers and secure messaging apps to protect privacy.

---

## Quick Setup

### 1. Build the Native Module (First Time Only)

```bash
npm run rebuild-native
```

### 2. Test Stealth Mode

```bash
npm run test-stealth
```

You should see:
```
🎉 ALL TESTS PASSED!

📚 Methods Implemented:
  1. ✅ GPU-Exclusive Rendering
  2. ✅ Fullscreen Exclusive Mode
  3. ✅ OS Privacy Restrictions
  4. ✅ Overlay Window Behavior
  5. ✅ Secure Rendering
  6. ✅ Hardware Video Surface Blocking
  7. ✅ Virtual Desktops/Spaces Isolation
  8. ✅ Sandbox/Containerized Behavior
  9. ✅ System-Level Overlay Prevention
  10. ✅ Protected Swapchain (GPU-level)
  11. ✅ 🔐 System-Level Secure Input (NEW!)
      → Makes window appear BLANK/TRANSPARENT
      → Same as password fields, Touch ID, Keychain
      → STRONGEST macOS privacy protection
```

### 3. Start Jarvis

```bash
npm start
```

Stealth mode is **enabled by default**.

---

## How to Test It Works

1. **Start Jarvis** (`npm start`)
2. **Start a Zoom meeting** (or use OBS, QuickTime, etc.)
3. **Share your entire screen** (not just a window)
4. **Open Jarvis** with your keyboard shortcut (Alt+Space or Cmd+Shift+Space)
5. **Result:** 
   - ✅ You see Jarvis on your screen
   - ✅ Screen share viewers see **nothing** (Jarvis is invisible)

---

## Toggle Stealth Mode

Users can toggle stealth mode in the app settings:

1. Open Jarvis
2. Click settings/gear icon
3. Toggle "Stealth Mode" on/off
4. Default: **ON**

---

## Troubleshooting

### "Native module not found"

**Fix:**
```bash
cd native/mac-content-protection
npm run rebuild
```

### Jarvis still visible in recordings

**Check:**
1. Run `npm run test-stealth` - all tests should pass
2. Verify stealth mode is enabled in settings
3. Restart Jarvis after rebuilding

### Build errors

**Requirements:**
- macOS 10.13+ 
- Xcode Command Line Tools: `xcode-select --install`

**Then rebuild:**
```bash
npm run rebuild-native
```

---

## Technical Details

### How It Works

Jarvis uses **10 different techniques** simultaneously:

1. **GPU-Exclusive Rendering** - Bypasses compositor
2. **Fullscreen Exclusive Mode** - Like fullscreen games
3. **OS Privacy Restrictions** - Secure window flags
4. **Overlay Window** - Non-capturable overlay
5. **Secure Rendering** - `NSWindowSharingNone`
6. **Video Surface Blocking** - Prevents hardware video capture
7. **Virtual Desktop Isolation** - Hides from Spaces/Mission Control
8. **Sandbox Behavior** - Containerized app appearance
9. **System Overlay** - Highest window level
10. **Protected Swapchain** - GPU-level protection

### Platform Support

- ✅ **macOS** - Full support (all 10 methods)
- ⚠️ **Windows** - Partial (Electron API only)
- ⚠️ **Linux** - Partial (Electron API only)

### Performance Impact

- **Minimal** - Uses native macOS APIs
- No noticeable system impact
- May slightly improve rendering performance

---

## What Gets Protected

Stealth mode protects:
- ✅ Main overlay window
- ✅ Paywall window
- ✅ Onboarding windows
- ✅ Account settings window
- ✅ All Jarvis UI elements

### What's NOT Protected

Stealth mode does NOT protect against:
- ❌ Physical camera recordings of your screen
- ❌ Malware/spyware with system-level access
- ❌ Root/admin users with bypass capabilities
- ❌ Direct framebuffer access (very rare)

**This is privacy protection, not security protection.**

---

## Commands Reference

```bash
# Test stealth mode
npm run test-stealth

# Rebuild native module
npm run rebuild-native

# Install native module
npm run install-native

# Start Jarvis with stealth
npm start
```

---

## Files

- `native/mac-content-protection/` - Native module source
- `STEALTH_MODE_IMPLEMENTATION.md` - Full technical documentation
- `test-stealth-mode.js` - Test script

---

## Need Help?

1. Check `STEALTH_MODE_IMPLEMENTATION.md` for full details
2. Run `npm run test-stealth` to diagnose issues
3. Verify build with: `ls -la native/mac-content-protection/build/Release/`

---

**Last Updated:** November 2025  
**Jarvis Version:** 6.0+

