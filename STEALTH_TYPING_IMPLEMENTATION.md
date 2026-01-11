# Stealth Mode Typing Overlay - Implementation Guide

## Overview
This implementation allows typing in the overlay without stealing focus from the underlying window. The overlay remains visible and accepts keyboard input while the background app keeps focus.

## Architecture

### 1. Native Module (Windows)
- **File**: `native/windows-keyboard-hook/windows_keyboard_hook.cc`
- **Purpose**: Low-level keyboard hook (WH_KEYBOARD_LL) that captures all keyboard input globally
- **Key Functions**:
  - `installKeyboardHook()` - Install global hook
  - `uninstallKeyboardHook()` - Remove hook
  - `setConsumeKeys(consume)` - Control whether keys are consumed or passed through
  - `setKeyEventCallback(callback)` - Set callback for key events

### 2. Main Process Integration
- **File**: `main.js`
- **Changes**:
  - Load keyboard hook module on Windows
  - Install hook when stealth mode is enabled
  - Forward key events to renderer via IPC
  - Cleanup hook on app quit

### 3. Renderer Process (Virtual Text Input)
- **File**: `script.js`
- **Changes**:
  - Replace real `<input>` with virtual text rendering when stealth mode is enabled
  - Listen for `stealth-key-event` IPC messages
  - Convert virtual key codes to characters
  - Render text manually with blinking caret
  - Maintain text buffer internally

## Key Implementation Details

### Virtual Key Code to Character Conversion
Windows virtual key codes need to be converted to actual characters. This requires:
- Checking modifier keys (Shift, Ctrl, Alt)
- Using `MapVirtualKey` or JavaScript equivalent
- Handling special keys (Backspace, Enter, etc.)

### Text Rendering
- Use a `<div>` instead of `<input>` when stealth mode is active
- Render text as text content
- Add blinking caret using CSS animation
- Match styling of original input

### Key Consumption Logic
- Only consume keys when:
  - Stealth mode is enabled
  - Overlay is visible
  - User is actively typing (overlay has focus context)
- Pass through system shortcuts (Alt+Tab, Win key, etc.)

## Usage

1. Enable stealth mode via settings
2. Keyboard hook is automatically installed
3. Real input is replaced with virtual input
4. Typing appears in overlay without stealing focus
5. Keys are consumed so they don't reach background apps

## Testing

1. Enable stealth mode
2. Open a text editor in background
3. Type in overlay - text should appear in overlay
4. Background app should NOT receive keystrokes
5. Background app should maintain focus

## Notes

- Only works on Windows (uses Windows-specific APIs)
- Requires native module compilation (`npm run rebuild` in `native/windows-keyboard-hook/`)
- Hook is always active but only consumes keys when stealth mode is enabled
- System shortcuts may need special handling


