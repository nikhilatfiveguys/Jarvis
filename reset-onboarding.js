const fs = require('fs');
const path = require('path');
const os = require('os');

// Get the user's home directory
const homeDir = os.homedir();

// Construct the path to the onboarding file
// On macOS, Electron apps store user data in ~/Library/Application Support/[AppName]/
const appName = 'jarvis-6.0';
const userDataPath = path.join(homeDir, 'Library', 'Application Support', appName);
const onboardingFile = path.join(userDataPath, 'onboarding_complete.json');

console.log('Looking for onboarding file at:', onboardingFile);

if (fs.existsSync(onboardingFile)) {
    try {
        fs.unlinkSync(onboardingFile);
        console.log('✅ Onboarding file deleted successfully!');
        console.log('   Restart the app to see onboarding again.');
    } catch (error) {
        console.error('❌ Error deleting onboarding file:', error.message);
    }
} else {
    console.log('⚠️  Onboarding file not found at:', onboardingFile);
    console.log('   The app may not have completed onboarding yet, or the file is in a different location.');
    
    // Try to find any onboarding files
    if (fs.existsSync(userDataPath)) {
        console.log('\n📁 Files in userData directory:');
        try {
            const files = fs.readdirSync(userDataPath);
            files.forEach(file => {
                console.log('   -', file);
            });
        } catch (err) {
            console.log('   Could not read directory:', err.message);
        }
    } else {
        console.log('   UserData directory does not exist:', userDataPath);
    }
}

