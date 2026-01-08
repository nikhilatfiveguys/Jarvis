const { app } = require('electron');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Hide window from Alt+Tab on Windows
 * @param {BrowserWindow} window - The Electron window to hide
 */
function hideFromAltTab(window) {
    if (process.platform !== 'win32') {
        return; // Only works on Windows
    }
    
    if (!window || window.isDestroyed()) {
        return;
    }
    
    // Use PowerShell to modify window style (works without native compilation)
    try {
        const hwndBuffer = window.getNativeWindowHandle();
        if (hwndBuffer && hwndBuffer.length >= 8) {
            // Read HWND from buffer (64-bit pointer)
            const hwndValue = hwndBuffer.readBigUInt64LE(0);
            const hwnd = hwndValue.toString();
            
            // Create a temporary PowerShell script
            const scriptContent = `Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);
    [DllImport("user32.dll")]
    public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
    [DllImport("user32.dll")]
    public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
    [DllImport("user32.dll")]
    public static extern bool IsWindow(IntPtr hWnd);
}
"@
$hwnd = [IntPtr]$args[0]
if ([Win32]::IsWindow($hwnd)) {
    $GWL_EXSTYLE = -20
    $WS_EX_TOOLWINDOW = 0x00000080
    $WS_EX_APPWINDOW = 0x00040000
    $exStyle = [Win32]::GetWindowLongPtr($hwnd, $GWL_EXSTYLE)
    $exStyle = $exStyle.ToInt64() -bor $WS_EX_TOOLWINDOW
    $exStyle = $exStyle -band (-bnot $WS_EX_APPWINDOW)
    [Win32]::SetWindowLongPtr($hwnd, $GWL_EXSTYLE, [IntPtr]$exStyle) | Out-Null
    $HWND_TOP = [IntPtr]::Zero
    $SWP_NOMOVE = 0x0002
    $SWP_NOSIZE = 0x0001
    $SWP_NOZORDER = 0x0004
    $SWP_FRAMECHANGED = 0x0020
    [Win32]::SetWindowPos($hwnd, $HWND_TOP, 0, 0, 0, 0, ($SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_NOZORDER -bor $SWP_FRAMECHANGED)) | Out-Null
    Write-Output "SUCCESS"
} else {
    Write-Output "INVALID_WINDOW"
}`;
            
            const scriptPath = path.join(os.tmpdir(), `hide-alt-tab-${process.pid}.ps1`);
            fs.writeFileSync(scriptPath, scriptContent, 'utf8');
            
            try {
                const result = execSync(`powershell -ExecutionPolicy Bypass -File "${scriptPath}" ${hwnd}`, {
                    encoding: 'utf8',
                    timeout: 5000
                });
                
                if (result && result.trim() === 'SUCCESS') {
                    console.log('✅ Window hidden from Alt+Tab using PowerShell');
                } else {
                    console.warn('⚠️ PowerShell method returned unexpected result:', result);
                    window.setSkipTaskbar(true);
                }
            } catch (error) {
                console.warn('⚠️ PowerShell method failed:', error.message);
                window.setSkipTaskbar(true);
            } finally {
                // Clean up temp file
                try {
                    fs.unlinkSync(scriptPath);
                } catch (e) {
                    // Ignore cleanup errors
                }
            }
            return;
        }
    } catch (e) {
        console.warn('⚠️ Failed to hide from Alt+Tab:', e.message);
    }
    
    // Fallback: Just use setSkipTaskbar (won't hide from Alt+Tab, but better than nothing)
    try {
        window.setSkipTaskbar(true);
    } catch (e) {
        console.warn('⚠️ Failed to set skip taskbar:', e.message);
    }
}

module.exports = {
    hideFromAltTab
};

