const { app } = require('electron');
const path = require('path');
const os = require('os');

let nativeModule = null;

// Try to load the native module
try {
    if (process.platform === 'win32') {
        // Try to load from build directory
        const buildPath = path.join(__dirname, 'build', 'Release', 'windows_keyboard_hook.node');
        try {
            nativeModule = require(buildPath);
        } catch (e) {
            // If build doesn't exist, try to require directly (will fail gracefully)
            console.warn('⚠️ Windows keyboard hook module not built yet. Run: npm run rebuild');
        }
    }
} catch (error) {
    console.warn('⚠️ Failed to load Windows keyboard hook module:', error.message);
}

/**
 * Install global low-level keyboard hook
 * @returns {boolean} Success status
 */
function installKeyboardHook() {
    if (process.platform !== 'win32') {
        console.warn('⚠️ Keyboard hook only works on Windows');
        return false;
    }
    
    if (!nativeModule) {
        console.warn('⚠️ Native keyboard hook module not available');
        return false;
    }
    
    try {
        return nativeModule.installKeyboardHook();
    } catch (error) {
        console.error('❌ Failed to install keyboard hook:', error);
        return false;
    }
}

/**
 * Uninstall keyboard hook
 * @returns {boolean} Success status
 */
function uninstallKeyboardHook() {
    if (process.platform !== 'win32' || !nativeModule) {
        return false;
    }
    
    try {
        return nativeModule.uninstallKeyboardHook();
    } catch (error) {
        console.error('❌ Failed to uninstall keyboard hook:', error);
        return false;
    }
}

/**
 * Set whether to consume keys (prevent them from reaching other windows)
 * @param {boolean} consume - Whether to consume keys
 * @returns {boolean} Success status
 */
function setConsumeKeys(consume) {
    if (process.platform !== 'win32' || !nativeModule) {
        return false;
    }
    
    try {
        return nativeModule.setConsumeKeys(consume);
    } catch (error) {
        console.error('❌ Failed to set consume keys:', error);
        return false;
    }
}

/**
 * Set callback for key events
 * @param {Function} callback - Callback function that receives key events
 * @returns {boolean} Success status
 */
function setKeyEventCallback(callback) {
    if (process.platform !== 'win32' || !nativeModule) {
        return false;
    }
    
    if (typeof callback !== 'function') {
        console.error('❌ Callback must be a function');
        return false;
    }
    
    try {
        return nativeModule.setKeyEventCallback(callback);
    } catch (error) {
        console.error('❌ Failed to set key event callback:', error);
        return false;
    }
}

module.exports = {
    installKeyboardHook,
    uninstallKeyboardHook,
    setConsumeKeys,
    setKeyEventCallback,
    isAvailable: () => process.platform === 'win32' && nativeModule !== null
};



