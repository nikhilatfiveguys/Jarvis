const fs = require('fs');
const path = require('path');
const os = require('os');

// Get the user's home directory
const homeDir = os.homedir();
const platform = os.platform();

// Get the app name from package.json or use default
let appName = 'jarvis-6.0';
try {
    const packageJson = require('./package.json');
    if (packageJson.name) {
        appName = packageJson.name;
    }
} catch (e) {
    // Use default if package.json not found
    console.log('[INFO] Could not read package.json, using default app name:', appName);
}

// Construct the path to the userData directory (cross-platform)
// On macOS: ~/Library/Application Support/[AppName]/
// On Windows: %APPDATA%\[AppName]\ (which is C:\Users\Username\AppData\Roaming\[AppName]\)
// On Linux: ~/.config/[AppName]/
let userDataPath;

if (platform === 'darwin') {
    userDataPath = path.join(homeDir, 'Library', 'Application Support', appName);
} else if (platform === 'win32') {
    // On Windows, APPDATA is typically C:\Users\<username>\AppData\Roaming
    userDataPath = path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), appName);
} else {
    // Linux and other Unix-like systems
    userDataPath = path.join(homeDir, '.config', appName);
}

console.log('');
console.log('===========================================');
console.log('    Jarvis User Reset for Onboarding');
console.log('===========================================');
console.log('');
console.log('Platform:', platform);
console.log('App Name:', appName);
console.log('User Data Path:');
console.log('  ' + userDataPath);
console.log('');

// Files to remove for a complete reset
const filesToRemove = [
    'onboarding_complete.json',
    'jarvis_user.json',
    'subscription_status.json',
    'voice-shortcut.json',
    'toggle-shortcut.json',
    'answer-screen-shortcut.json',
    'stealth_mode.json',
    'jarvis-free-access.json',
    'TEST_MODE_FREE_USER'
];

if (!fs.existsSync(userDataPath)) {
    console.log('[INFO] UserData directory does not exist:');
    console.log('  ' + userDataPath);
    console.log('');
    console.log('The app may not have been run yet on this system.');
    console.log('No files to remove.');
    console.log('');
    console.log('===========================================');
    process.exit(0);
}

let removedCount = 0;
let errorCount = 0;

filesToRemove.forEach(fileName => {
    const filePath = path.join(userDataPath, fileName);
    if (fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
            console.log('[✓] Removed: ' + fileName);
            removedCount++;
        } catch (error) {
            console.error('[✗] Error removing ' + fileName + ':', error.message);
            errorCount++;
        }
    } else {
        console.log('[ ] Not found: ' + fileName);
    }
});

console.log('');
if (removedCount > 0) {
    console.log(`[SUCCESS] Removed ${removedCount} file(s)!`);
    if (errorCount > 0) {
        console.log(`[WARNING] ${errorCount} error(s) occurred.`);
    }
    console.log('');
    console.log('Restart the app to see onboarding again.');
} else {
    console.log('[INFO] No files were removed.');
    console.log('This could mean:');
    console.log('  - The app may not have been used yet');
    console.log('  - All user data has already been cleared');
}

console.log('');
console.log('===========================================');

