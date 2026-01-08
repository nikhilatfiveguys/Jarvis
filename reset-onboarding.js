const fs = require('fs');
const path = require('path');
const os = require('os');

// Get the user's home directory
const homeDir = os.homedir();
const platform = os.platform();

// Construct the path to the onboarding file (cross-platform)
// On macOS: ~/Library/Application Support/[AppName]/
// On Windows: %APPDATA%\[AppName]\ (which is C:\Users\Username\AppData\Roaming\[AppName]\)
// On Linux: ~/.config/[AppName]/
const appName = 'jarvis-6.0';
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

const onboardingFile = path.join(userDataPath, 'onboarding_complete.json');

console.log('');
console.log('===========================================');
console.log('       Jarvis Onboarding Reset Tool');
console.log('===========================================');
console.log('');
console.log('Platform:', platform);
console.log('Looking for onboarding file at:');
console.log('  ' + onboardingFile);
console.log('');

if (fs.existsSync(onboardingFile)) {
    try {
        fs.unlinkSync(onboardingFile);
        console.log('[SUCCESS] Onboarding file deleted successfully!');
        console.log('');
        console.log('Restart the app to see onboarding again.');
    } catch (error) {
        console.error('[ERROR] Error deleting onboarding file:', error.message);
    }
} else {
    console.log('[WARNING] Onboarding file not found at the expected location.');
    console.log('');
    console.log('This could mean:');
    console.log('  - The app may not have completed onboarding yet');
    console.log('  - The file is in a different location');
    console.log('');
    
    // Try to find any files in the userData directory
    if (fs.existsSync(userDataPath)) {
        console.log('Files found in userData directory:');
        console.log('');
        try {
            const files = fs.readdirSync(userDataPath);
            if (files.length === 0) {
                console.log('  (directory is empty)');
            } else {
                files.forEach(file => {
                    const filePath = path.join(userDataPath, file);
                    const stats = fs.statSync(filePath);
                    const type = stats.isDirectory() ? '[DIR]' : '[FILE]';
                    console.log('  ' + type + ' ' + file);
                });
            }
        } catch (err) {
            console.log('  Could not read directory:', err.message);
        }
    } else {
        console.log('UserData directory does not exist:');
        console.log('  ' + userDataPath);
        console.log('');
        console.log('The app may not have been run yet on this system.');
    }
}

console.log('');
console.log('===========================================');
