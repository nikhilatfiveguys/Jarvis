# Comprehensive Stealth Mode Implementation

This document explains how Jarvis implements **ALL 10** known methods to hide windows from screen sharing and recording software (Zoom, OBS, QuickTime, Teams, etc.).

## Overview

Jarvis uses a sophisticated multi-layered approach to remain invisible during screen recordings and screen sharing sessions. By combining all 10 techniques, the app achieves complete invisibility similar to professional security applications like password managers and secure messaging apps.

---

## The 10 Anti-Capture Methods

### ✅ 1. GPU-Exclusive or Low-Level Rendering

**What it does:** Draws directly to the GPU in a way that bypasses the normal macOS display compositor.

**How we implement it:**
- Enable layer-backed views (`wantsLayer = YES`)
- Use asynchronous GPU rendering (`drawsAsynchronously = YES`)
- Disable rasterization (`shouldRasterize = NO`)
- Force direct GPU draw instead of compositor caching

**Why it works:** Screen capture tools can only capture surfaces that go through the OS compositor. GPU-exclusive rendering bypasses this.

**Similar apps:** Fullscreen games, VR apps, some emulators

---

### ✅ 2. Fullscreen Exclusive Mode

**What it does:** Takes exclusive control of the display, making screen capture tools see only the desktop underneath.

**How we implement it:**
- Set `NSWindowCollectionBehaviorFullScreenPrimary`
- Use highest window level (above screen saver)
- Remove window chrome and shadows

**Why it works:** When an app takes exclusive fullscreen control, the OS treats it as a special case that screen capture can't access.

**Similar apps:** Games in fullscreen-exclusive mode

---

### ✅ 3. OS Privacy Restrictions

**What it does:** Marks the window as "secure" at the OS level, triggering privacy protections.

**How we implement it:**
- Mark as utility window (`NSWindowStyleMaskUtilityWindow`)
- Set secure sharing type (`NSWindowSharingNone`)
- Disable automatic window tabbing
- Use privacy-preserving window behaviors

**Why it works:** macOS blocks certain window types from capture to protect sensitive information.

**Similar apps:** Password fields, banking apps, certain enterprise software

---

### ✅ 4. Overlay Window (Not a Real Window)

**What it does:** Makes the window appear as a floating overlay rather than a traditional capturable window.

**How we implement it:**
- Set collection behavior to stationary and transient
- Use `NSWindowCollectionBehaviorIgnoresCycle`
- Position as system-level overlay
- Remove from window management

**Why it works:** Overlay-style apps float above everything but don't exist as capture-eligible windows.

**Similar apps:** Floating AI assistants, HUDs, crosshair overlays, FPS counters

---

### ✅ 5. Secure Rendering / Secure Input

**What it does:** Marks the UI surface as non-recordable for privacy (strongest macOS protection).

**How we implement it:**
- Set `NSWindowSharingNone` (prevents all screen sharing)
- Mark as secure content
- Apply privacy-level rendering flags

**Why it works:** This is macOS's official privacy protection mechanism. Apps using this are automatically blocked from capture.

**Similar apps:** Password managers, banking apps, secure messaging apps

---

### ✅ 6. Hardware-Accelerated Video Surfaces

**What it does:** Prevents capture of hardware-accelerated video surfaces that appear as black rectangles.

**How we implement it:**
- Force non-video layer type
- Use private content format (`contentsFormat = 2`)
- Remove Metal/compositor filters
- Disable video surface detection

**Why it works:** Hardware video surfaces use a different rendering path that often appears as black or frozen in captures.

**Similar apps:** VLC, media players, some browsers with hardware acceleration

---

### ✅ 7. Virtual Desktops / Spaces Isolation

**What it does:** Hides window from Mission Control, Exposé, and prevents capture across virtual desktops.

**How we implement it:**
- Set `NSWindowCollectionBehaviorCanJoinAllSpaces`
- Add `NSWindowCollectionBehaviorStationary`
- Mark as fullscreen auxiliary window
- Make transient (hidden from window menu)

**Why it works:** Windows on other Spaces or hidden from Mission Control can't be captured, even in full-screen sharing.

**Similar apps:** System utilities, background daemons

---

### ✅ 8. Sandbox / Containerized App Behavior

**What it does:** Makes the window appear as if running in an isolated secure container.

**How we implement it:**
- Mark as utility window (system-level)
- Set non-activating behavior
- Make window appear isolated
- Combine with secure sharing flags

**Why it works:** Sandboxed and containerized apps often have capture restrictions to protect sensitive data.

**Similar apps:** UWP apps, some Android emulators, corporate secure viewers

---

### ✅ 9. Overlay Prevention (Above Everything)

**What it does:** Positions window at system-level to prevent overlay capture.

**How we implement it:**
- Use `NSScreenSaverWindowLevel + 1` (highest possible)
- Position above all other windows
- Mark as system overlay

**Why it works:** Screen capture tools hide system-level overlays for privacy, even if visible to the user.

**Similar apps:** Discord overlay, Steam overlay, Xbox Game Bar

---

### ✅ 10. Protected Swapchain (GPU-Level)

**What it does:** Marks the GPU swapchain as non-capturable (like Windows protected content).

**How we implement it:**
- Use private content format to mark GPU buffer as protected
- Disable compositor caching
- Force direct GPU rendering
- Apply secure content flags at layer level

**Why it works:** Modern GPUs support marking their output buffers as non-capturable, similar to DRM content protection.

**Similar apps:** Video streaming apps with DRM, protected content players

---

## Implementation Details

### File Structure

```
native/mac-content-protection/
├── mac_content_protection.mm      # Objective-C++ implementation (all 10 methods)
├── mac_content_protection_binding.cc  # N-API bindings to JavaScript
├── index.js                       # JavaScript API wrapper
├── binding.gyp                    # Build configuration
└── README.md                      # Module documentation
```

### Key Functions

#### Master Function: `ApplyComprehensiveStealth`

```objective-c
void ApplyComprehensiveStealth(unsigned long windowId, bool enable)
```

This single function applies **ALL 10** methods at once for maximum protection.

#### Individual Method Functions

Each method can also be applied individually:
- `SetWindowContentProtection()` - Methods 1, 3, 4, 5, 6, 7, 9, 10
- `SetFullscreenExclusiveMode()` - Method 2
- `SetWindowHiddenFromMissionControl()` - Method 7
- `DisableHardwareVideoCapture()` - Method 6
- `SetProtectedSwapchain()` - Method 10
- `SetSandboxBehavior()` - Method 8

### Usage in Main Process

In `main.js`, stealth mode is automatically applied to all windows:

```javascript
setWindowContentProtection(window, enable) {
    if (this.nativeContentProtection && this.nativeContentProtection.isAvailable()) {
        // Apply ALL 10 methods
        this.nativeContentProtection.applyComprehensiveStealth(window, enable);
    } else {
        // Fallback to Electron built-in API (Method 5 only)
        window.setContentProtection(enable);
    }
}
```

### When Stealth Mode Activates

Stealth mode is applied when:
1. ✅ Main overlay window is created
2. ✅ Paywall window is shown
3. ✅ Onboarding windows are displayed
4. ✅ Account management window is opened
5. ✅ User toggles stealth mode in settings (IPC handler)

### Stealth Mode Preference

Users can toggle stealth mode on/off via the settings. The preference is stored in:
```
~/Library/Application Support/Jarvis/stealth_mode.json
```

Default: **ENABLED** (stealth mode ON by default)

---

## Testing Stealth Mode

### How to Test

1. **Enable stealth mode** in Jarvis settings (default: ON)
2. **Start a Zoom meeting** (or use OBS, QuickTime, etc.)
3. **Share your entire screen** (not just a window)
4. **Open Jarvis** with the keyboard shortcut
5. **Result:** Jarvis should be **completely invisible** to the screen share

### What Should Happen

- ✅ Jarvis visible on your screen
- ✅ Jarvis **invisible** in screen share/recording
- ✅ Everything else visible normally
- ✅ No black rectangles or artifacts

### Troubleshooting

**If Jarvis is still visible in recordings:**

1. Check if native module is loaded:
   ```bash
   # Look for this in console logs
   ✅ Native content protection module loaded
   ```

2. Rebuild the native module:
   ```bash
   cd native/mac-content-protection
   npm run rebuild
   ```

3. Check stealth mode is enabled:
   - Open Jarvis settings
   - Verify "Stealth Mode" is ON

4. Restart Jarvis after rebuilding

**If native module won't load:**

1. Install Xcode Command Line Tools:
   ```bash
   xcode-select --install
   ```

2. Rebuild:
   ```bash
   npm run rebuild-native
   ```

3. Check build output for errors

---

## Technical Notes

### macOS Version Requirements

- **Minimum:** macOS 10.13+ (for `NSWindowSharingNone`)
- **Recommended:** macOS 10.15+ (for best GPU rendering support)

### Performance Impact

- **Minimal** - All methods use native macOS APIs
- GPU-exclusive rendering may actually **improve** performance
- No noticeable impact on system resources

### Compatibility

The native module is **macOS only**. On other platforms:
- Module gracefully falls back to Electron's built-in API
- Only Method 5 (Secure Rendering) is available
- Reduced effectiveness on Windows/Linux

### Security Considerations

This is **privacy protection**, not security protection:
- ✅ Prevents accidental exposure in screen shares
- ✅ Protects against screen recording software
- ❌ Does NOT protect against malware or system-level capture
- ❌ Does NOT protect against physical camera recordings
- ❌ Root/admin users can bypass these protections

---

## Credits

This implementation combines techniques from:
- Professional password managers (1Password, Bitwarden)
- Secure messaging apps (Signal, Telegram secret chats)
- Gaming industry (fullscreen-exclusive mode)
- GPU vendors (protected content paths)
- macOS security frameworks (secure input/rendering)

---

## Future Enhancements

Potential additions:
- [ ] Detect active screen recording and auto-hide
- [ ] Blur content when screen share is detected
- [ ] Add Windows-specific protected swapchain support
- [ ] Implement Linux-specific X11/Wayland protections
- [ ] Add user notification when screen recording is detected

---

## License

MIT License - See LICENSE file for details

---

**Last Updated:** November 2025  
**Jarvis Version:** 6.0+  
**Native Module Version:** 1.0.0









