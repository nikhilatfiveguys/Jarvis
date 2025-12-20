const { app, BrowserWindow, ipcMain, screen, desktopCapturer, shell, globalShortcut, systemPreferences, clipboard } = require('electron');
const path = require('path');
const { exec } = require('child_process');

// Handle Squirrel events for auto-updates (macOS and Windows)
// This MUST be at the very top before anything else
const handleSquirrelEvent = () => {
    if (process.argv.length === 1) {
        return false;
    }

    const squirrelEvent = process.argv[1];
    switch (squirrelEvent) {
        case '--squirrel-install':
        case '--squirrel-updated':
            // App was installed or updated, quit immediately
            app.quit();
            return true;
        case '--squirrel-uninstall':
            // App is being uninstalled
            app.quit();
            return true;
        case '--squirrel-obsolete':
            // App is being replaced by a newer version
            app.quit();
            return true;
        case '--squirrel-firstrun':
            // First run after install - just continue normally
            return false;
    }
    return false;
};

if (handleSquirrelEvent()) {
    // Squirrel event handled, app will quit
    process.exit(0);
}

// Delay loading electron-updater until app is ready
let autoUpdater = null;
function getAutoUpdater() {
    if (!autoUpdater) {
        autoUpdater = require('electron-updater').autoUpdater;
    }
    return autoUpdater;
}
const { POLAR_CONFIG, PolarClient, LicenseManager } = require('./polar-config');
const VoiceRecorder = require('./voice-recorder');
const SupabaseIntegration = require('./supabase-integration');
// Legacy Polar support (deprecated - kept for backward compatibility)
const PolarIntegration = require('./polar-integration');
const PolarSuccessHandler = require('./polar-success-handler');
const PolarWebhookHandler = require('./polar-webhook-handler');
const GoogleDocsIntegration = require('./google-docs-integration');
const GoogleCalendarIntegration = require('./google-calendar-integration');
const GmailIntegration = require('./gmail-integration');
const https = require('https');

// Load native macOS content protection module (if available)
let nativeContentProtection = null;
if (process.platform === 'darwin') {
    try {
        nativeContentProtection = require('./native/mac-content-protection');
        console.log('✅ Native content protection module loaded');
    } catch (error) {
        console.warn('⚠️ Native content protection module not available:', error.message);
        console.warn('   Screen recording protection will use Electron\'s built-in API only');
    }
}

class JarvisApp {
    constructor() {
        this.mainWindow = null;
        this.paywallWindow = null;
        this.onboardingWindow = null;
        this.accountWindow = null;
        this.passwordResetWindow = null;
        this.hotkeysWindow = null;
        this.isOverlayVisible = true;
        this.fullscreenMaintenanceInterval = null;
        this.fullscreenEnforcementInterval = null;
        this.isTransitioningOnboarding = false; // Track onboarding window transitions
        this.screenRecordingCheckInterval = null; // Track screen recording detection
        this.currentUserEmail = null; // Track current user for token usage
        this.wasVisibleBeforeRecording = false; // Track if window was visible before recording
        this.screenshotDetectionSetup = false; // Track screenshot detection setup
        this.nativeContentProtection = nativeContentProtection; // Store reference to native module
        this.licenseManager = new LicenseManager(new PolarClient(POLAR_CONFIG));
        // Load secure configuration first
        const SecureConfig = require('./config/secure-config');
        this.secureConfig = new SecureConfig();
        
        // Now create Polar integration with proper config
        // Use Supabase for subscription management
        this.supabaseIntegration = new SupabaseIntegration(this.secureConfig);
        this.supabaseIntegration.setMainAppInstance(this); // Allow webhooks to notify main app
        
        // Legacy Polar support (deprecated - kept for backward compatibility)
        this.polarIntegration = new PolarIntegration(this.secureConfig);
        this.polarIntegration.setMainAppInstance(this);
        this.polarSuccessHandler = new PolarSuccessHandler(this.polarIntegration, this);
        this.polarWebhookHandler = new PolarWebhookHandler(this.secureConfig, this.polarIntegration, this);
        
        // Google Docs integration (pass secureConfig so it can read from .env)
        this.googleDocsIntegration = new GoogleDocsIntegration(this.secureConfig);
        
        // Google Calendar integration (pass secureConfig so it can read from .env)
        this.googleCalendarIntegration = new GoogleCalendarIntegration(this.secureConfig);
        
        // Gmail integration (pass secureConfig so it can read from .env)
        this.gmailIntegration = new GmailIntegration(this.secureConfig);
        
        // Get API keys from secure configuration
        const exaConfig = this.secureConfig.getExaConfig();
        const openaiConfig = this.secureConfig.getOpenAIConfig();
        
        this.exaApiKey = exaConfig.apiKey;
        this.currentDocument = null;
        this.openaiApiKey = openaiConfig.apiKey;
        
        // Initialize voice recorder only if API key is available
        if (this.openaiApiKey && this.openaiApiKey.trim() !== '') {
            // Log partial key for debugging (first 7 chars + ...)
            const keyPreview = this.openaiApiKey.length > 7 
                ? `${this.openaiApiKey.substring(0, 7)}...` 
                : '***';
            console.log(`✅ Initializing voice recorder with OpenAI API key: ${keyPreview}`);
            this.voiceRecorder = new VoiceRecorder(this.openaiApiKey);
        } else {
            console.warn('⚠️ OpenAI API key not configured. Voice recording will be disabled.');
            console.warn('   Please set OPENAI_API_KEY in your .env file or environment variables.');
            this.voiceRecorder = null;
        }
        this.isVoiceRecording = false;
        const gotLock = app.requestSingleInstanceLock();
        if (!gotLock) {
            app.quit();
            return;
        }

        // Focus existing window if a second instance is launched
        app.on('second-instance', () => {
            if (this.mainWindow) {
                if (this.mainWindow.isMinimized()) this.mainWindow.restore();
                this.mainWindow.show();
                this.mainWindow.focus();
            }
        });

        this.setupApp();
        // Auto-updater will be set up after app is ready
    }

    setupAutoUpdater() {
        // Configure auto-updater (only call after app is ready)
        const updater = getAutoUpdater();
        updater.autoDownload = false; // Don't auto-download, let user choose
        updater.autoInstallOnAppQuit = true; // Auto-install on quit after download
        
        // Enable app to restart after install
        updater.autoRunAppAfterInstall = true;
        
        // Create a custom logger that suppresses notifications
        updater.logger = {
            info: (msg) => console.log('[updater]', msg),
            warn: (msg) => console.warn('[updater]', msg),
            error: (msg) => console.error('[updater]', msg),
            debug: (msg) => {} // Suppress debug
        };
        
        // Set update check interval (check every 4 hours)
        setInterval(() => {
            getAutoUpdater().checkForUpdates().catch(() => {
                // Silently fail - don't log or show errors
            });
        }, 4 * 60 * 60 * 1000); // 4 hours
        
        // Check for updates on startup (after a LONG delay to not slow down startup)
        setTimeout(() => {
            getAutoUpdater().checkForUpdates().catch(() => {
                // Silently fail - don't log or show errors
            });
        }, 30000); // Check 30 seconds after app ready - completely non-blocking
        
        // Handle update events
        updater.on('checking-for-update', () => {
            console.log('Checking for updates...');
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('update-checking');
            }
        });
        
        updater.on('update-available', (info) => {
            console.log('Update available:', info.version);
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('update-available', {
                    version: info.version,
                    releaseDate: info.releaseDate,
                    releaseNotes: info.releaseNotes || 'Bug fixes and improvements'
                });
            }
        });
        
        updater.on('update-not-available', (info) => {
            console.log('Update not available. Current version is latest.');
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('update-not-available');
            }
        });
        
        updater.on('error', (err) => {
            // Silently ignore update errors - don't show to user or log
            // Only log critical errors (not network timeouts)
            if (err && err.message && !err.message.includes('504') && !err.message.includes('timeout') && !err.message.includes('time-out')) {
                console.error('Error in auto-updater:', err);
            }
            // Don't send error to renderer - user doesn't need to see update check failures
        });
        
        updater.on('download-progress', (progressObj) => {
            const message = `Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`;
            console.log(message);
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('update-download-progress', {
                    percent: progressObj.percent,
                    transferred: progressObj.transferred,
                    total: progressObj.total,
                    bytesPerSecond: progressObj.bytesPerSecond
                });
            }
        });
        
        updater.on('update-downloaded', (info) => {
            console.log('Update downloaded:', info.version);
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('update-downloaded', {
                    version: info.version,
                    releaseDate: info.releaseDate,
                    releaseNotes: info.releaseNotes || 'Bug fixes and improvements'
                });
            }
        });
    }

    async setupApp() {
        // Handle app ready
        app.whenReady().then(async () => {
            this.setupAuthHandlers();
            this.loadVoiceShortcut(); // Load custom voice shortcut before setting up defaults
            this.setupVoiceRecording();
            this.setupAutoUpdater(); // Setup auto-updater after app is ready
            this.loadCurrentUserEmail(); // Load user email for token tracking
            
            // Trigger screen recording permission request early
            // This makes macOS add the app to Screen Recording permissions list
            this.requestScreenRecordingPermission();
            
            // Setup IPC handlers (needed for all flows)
            this.setupIpcHandlers();
            
            // PAYWALL DISABLED - Go directly to main window
            // Always create window - interactive tutorial happens in overlay now
                    this.createWindow();
                    if (process.platform === 'darwin' && app.dock) {
                        app.dock.hide();
                    }
            
            // If onboarding not complete, show the overlay with tutorial
            if (!this.isOnboardingComplete()) {
                this.needsInteractiveTutorial = true;
                // Show overlay immediately for new users
                setTimeout(() => {
                    this.showOverlay();
                }, 500);
            }
            
            // Start Polar success handler
            this.polarSuccessHandler.start();
            
            // Start Polar webhook handler
            this.polarWebhookHandler.start();
            
            // Start periodic subscription validation
            this.startSubscriptionValidation();
            
            // Don't validate on startup - rely on webhooks for cancellation updates
        });

        // Handle window closed
        app.on('window-all-closed', () => {
            // Don't quit if we're transitioning between onboarding windows or if main window exists
            if (this.isTransitioningOnboarding || this.mainWindow) {
                return;
            }
            if (process.platform !== 'darwin') {
                app.quit();
            }
        });

        app.on('before-quit', () => {
            globalShortcut.unregisterAll();
            // Cleanup screen recording detection
            if (this.screenRecordingCheckInterval) {
                clearInterval(this.screenRecordingCheckInterval);
                this.screenRecordingCheckInterval = null;
            }
        });

        // Handle app activation (macOS)
        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                this.createWindow();
            }
        });

        // Global shortcuts
        app.whenReady().then(() => {
            const { globalShortcut } = require('electron');
            const fs = require('fs');
            const path = require('path');
            
            // Always register default shortcuts for toggle overlay
            try { globalShortcut.register('Alt+Space', () => { this.toggleOverlay(); }); } catch (_) {}
            try { globalShortcut.register('CommandOrControl+Shift+Space', () => { this.toggleOverlay(); }); } catch (_) {}
            
            // Load and register additional custom shortcut if set
            let savedShortcut = null;
            try {
                const userDataPath = app.getPath('userData');
                const shortcutFile = path.join(userDataPath, 'toggle-shortcut.json');
                if (fs.existsSync(shortcutFile)) {
                    const data = JSON.parse(fs.readFileSync(shortcutFile, 'utf8'));
                    if (data.shortcut) savedShortcut = data.shortcut;
                }
            } catch (e) {}
            
            // Register custom shortcut in addition to defaults (if different)
            if (savedShortcut && savedShortcut !== 'Alt+Space' && savedShortcut !== 'CommandOrControl+Shift+Space') {
                try { globalShortcut.register(savedShortcut, () => { this.toggleOverlay(); }); } catch (_) {}
            }

            // Load and register voice shortcut
            this.loadVoiceShortcut();
            
            // Load and register answer screen shortcut
            this.loadAnswerScreenShortcut();
            
            // Setup cleanup handlers
            this.setupAppCleanup();
        });
    }
    
    loadAnswerScreenShortcut() {
        const fs = require('fs');
        const path = require('path');
        const userDataPath = app.getPath('userData');
        const shortcutFile = path.join(userDataPath, 'answer-screen-shortcut.json');
        try {
            if (fs.existsSync(shortcutFile)) {
                const data = JSON.parse(fs.readFileSync(shortcutFile, 'utf8'));
                if (data.shortcut) {
                    this.registerAnswerScreenShortcut(data.shortcut);
                }
            }
        } catch (e) {
            console.error('Failed to load answer screen shortcut:', e);
        }
    }
    
    registerAnswerScreenShortcut(shortcut) {
        if (!shortcut) return;
        
        const { globalShortcut } = require('electron');
        
        // Unregister previous answer screen shortcut if any
        if (this.currentAnswerScreenShortcut) {
            try {
                globalShortcut.unregister(this.currentAnswerScreenShortcut);
            } catch (e) {}
        }
        
        // Register the new shortcut
        try {
            globalShortcut.register(shortcut, () => {
                console.log('🖥️ Answer Screen shortcut triggered');
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.webContents.send('trigger-answer-screen');
                }
            });
            this.currentAnswerScreenShortcut = shortcut;
            console.log('✅ Answer screen shortcut registered:', shortcut);
        } catch (e) {
            console.error('Failed to register answer screen shortcut:', e);
        }
    }

    loadVoiceShortcut() {
        const fs = require('fs');
        const path = require('path');
        const userDataPath = app.getPath('userData');
        const shortcutFile = path.join(userDataPath, 'voice-shortcut.json');
        try {
            if (fs.existsSync(shortcutFile)) {
                const data = JSON.parse(fs.readFileSync(shortcutFile, 'utf8'));
                if (data.shortcut) {
                    this.registerVoiceShortcut(data.shortcut);
                }
            }
        } catch (e) {
            console.error('Failed to load voice shortcut:', e);
        }
    }
    
    registerVoiceShortcut(shortcut) {
        if (!shortcut) return;
        
        const { globalShortcut } = require('electron');
        
        // Unregister previous voice shortcut if any
        if (this.currentVoiceShortcut) {
            try {
                globalShortcut.unregister(this.currentVoiceShortcut);
            } catch (e) {}
        }
        
        // Register the new shortcut
        try {
            globalShortcut.register(shortcut, () => {
                console.log('🎤 Voice shortcut triggered');
                this.toggleVoiceRecording();
            });
            this.currentVoiceShortcut = shortcut;
            console.log('✅ Voice shortcut registered:', shortcut);
        } catch (e) {
            console.error('Failed to register voice shortcut:', e);
        }
    }

    setupAppCleanup() {
        // Cleanup shortcuts on quit
        app.on('will-quit', () => {
            const { globalShortcut } = require('electron');
            globalShortcut.unregisterAll();
        });
    }


    createPaywallWindow() {
        const paywallOptions = {
            width: 480,
            height: 600,
            center: true,
            resizable: false,
            frame: false,
            transparent: true,
            backgroundColor: '#00000000',
            hasShadow: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        };
        
        // macOS-only: Prevent screen recording
        if (process.platform === 'darwin') {
            paywallOptions.titleBarStyle = 'hidden';
            paywallOptions.contentProtection = true;
        }
        
        this.paywallWindow = new BrowserWindow(paywallOptions);

        // macOS-only: Enable content protection (check stealth mode preference)
        const stealthEnabled = this.getStealthModePreference();
        this.setWindowContentProtection(this.paywallWindow, stealthEnabled);

        this.paywallWindow.loadFile('paywall.html');
        
        // Setup IPC handlers for paywall
        this.setupIpcHandlers();

        this.paywallWindow.on('closed', () => {
            this.paywallWindow = null;
            // If user closes paywall without completing, quit app
            // But don't quit if we're transitioning to onboarding or main window
            if (!this.mainWindow && !this.onboardingWindow) {
                app.quit();
            }
        });
    }

    isOnboardingComplete() {
        const fs = require('fs');
        const userDataPath = app.getPath('userData');
        const onboardingFile = path.join(userDataPath, 'onboarding_complete.json');
        
        console.log('Checking onboarding status at:', onboardingFile);
        console.log('File exists?', fs.existsSync(onboardingFile));
        
        if (fs.existsSync(onboardingFile)) {
            try {
                const fileContent = fs.readFileSync(onboardingFile, 'utf8');
                console.log('File content:', fileContent);
                const data = JSON.parse(fileContent);
                console.log('Onboarding file exists, completed:', data.completed);
                const result = data.completed === true;
                console.log('Returning:', result);
                return result;
            } catch (error) {
                console.log('Error reading onboarding file:', error);
                return false;
            }
        }
        console.log('Onboarding file does not exist, showing onboarding');
        // FORCE SHOW ONBOARDING - return false to always show onboarding
        return false;
    }

    markOnboardingComplete() {
        const fs = require('fs');
        const userDataPath = app.getPath('userData');
        
        if (!fs.existsSync(userDataPath)) {
            fs.mkdirSync(userDataPath, { recursive: true });
        }
        
        const onboardingFile = path.join(userDataPath, 'onboarding_complete.json');
        fs.writeFileSync(onboardingFile, JSON.stringify({ completed: true, timestamp: new Date().toISOString() }, null, 2));
    }

    createOnboardingWindow(step = 'permissions') {
        if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
            this.onboardingWindow.focus();
            return;
        }

        console.log('Creating onboarding window, step:', step);

        const windowOptions = {
            width: 520,
            height: 750,
            center: true,
            resizable: false,
            frame: false,
            transparent: true,
            backgroundColor: '#00000000',
            hasShadow: true,
            alwaysOnTop: true,
            show: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        };
        
        // macOS-only: Prevent screen recording
        if (process.platform === 'darwin') {
            windowOptions.titleBarStyle = 'hidden';
            windowOptions.contentProtection = true;
        }
        
        this.onboardingWindow = new BrowserWindow(windowOptions);

        // macOS-only: Enable content protection (check stealth mode preference)
        const stealthEnabled = this.getStealthModePreference();
        this.setWindowContentProtection(this.onboardingWindow, stealthEnabled);

        // Load the appropriate onboarding screen
        if (step === 'features') {
            this.onboardingWindow.loadFile('onboarding-features.html');
            console.log('Loading features onboarding');
        } else {
            this.onboardingWindow.loadFile('onboarding.html');
            console.log('Loading permissions onboarding');
                }
        
        this.onboardingWindow.on('closed', () => {
            console.log('Onboarding window closed');
            // Only clear reference if we're not transitioning (transition handler will manage it)
            if (!this.isTransitioningOnboarding) {
            this.onboardingWindow = null;
            }
            // Don't quit if we have a main window or if we're transitioning
            // The onboarding completion handler will manage window transitions
        });

        this.onboardingWindow.once('ready-to-show', () => {
            console.log('Onboarding window ready to show');
            if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
                this.onboardingWindow.show();
                this.onboardingWindow.focus();
                this.onboardingWindow.setAlwaysOnTop(true);
                console.log('Onboarding window should now be visible');
            }
        });

        // Also show it when the page finishes loading
        this.onboardingWindow.webContents.once('did-finish-load', () => {
            console.log('Onboarding page finished loading');
            if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
                this.onboardingWindow.show();
                this.onboardingWindow.focus();
            }
        });
    }

    showFeaturesOnboarding() {
        // Set flag to prevent app quit during transition
        this.isTransitioningOnboarding = true;
        
        // Close current onboarding and show features screen
        if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
            const oldWindow = this.onboardingWindow;
            this.onboardingWindow = null;
            oldWindow.close();
        }
        
        // Small delay to ensure old window is closed
        setTimeout(() => {
            this.createOnboardingWindow('features');
            // Clear transition flag after new window is created
            setTimeout(() => {
                this.isTransitioningOnboarding = false;
            }, 200);
        }, 100);
    }

    openScreenRecordingSettings() {
        if (process.platform === 'darwin') {
            // Open macOS System Settings to Screen Recording
            // This works on macOS Ventura+ (System Settings)
            shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture').catch(() => {
                // Fallback: Try older macOS (System Preferences) or just open System Settings
                exec('open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"', (error) => {
                    if (error) {
                        // Last resort: Open System Settings app directly
                        shell.openExternal('x-apple.systempreferences:com.apple.preference.security').catch((err) => {
                            console.error('Failed to open Screen Recording settings:', err);
                        });
                    }
                });
            });
        } else if (process.platform === 'win32') {
            // Open Windows Settings to Privacy > Microphone/Camera
            shell.openExternal('ms-settings:privacy-microphone').catch((err) => {
                console.error('Failed to open Windows privacy settings:', err);
            });
        }
    }

    // Request screen recording permission early to add app to macOS permissions list
    async requestScreenRecordingPermission() {
        if (process.platform !== 'darwin') return;
        
        try {
            // Check current permission status
            const screenStatus = systemPreferences.getMediaAccessStatus('screen');
            console.log('🔐 Current screen recording permission status:', screenStatus);
            
            if (screenStatus === 'granted') {
                console.log('✅ Screen recording permission already granted');
                this.screenRecordingPermissionGranted = true;
                return;
            }
            
            this.screenRecordingPermissionGranted = false;
            
            // Permission not granted - show banner and trigger the macOS dialog
            console.log('🔐 Screen recording permission not granted, triggering permission dialog...');
            
            // Notify the overlay to show permission banner FIRST (before dialog appears)
            setTimeout(() => {
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.webContents.send('show-permission-restart-prompt');
                }
            }, 500);
            
            // Trigger the permission request to add app to the list and show macOS dialog
            // The macOS dialog has its own "Open System Settings" button
            try {
                await desktopCapturer.getSources({
                    types: ['screen'],
                    thumbnailSize: { width: 100, height: 100 }
                });
            } catch (e) {
                console.log('🔐 Permission request triggered');
            }
            
        } catch (error) {
            console.log('🔐 Screen recording permission error:', error.message);
        }
    }

    createAccountWindow() {
        // Reuse existing window if it exists
        if (this.accountWindow && !this.accountWindow.isDestroyed()) {
            this.accountWindow.show();
            this.accountWindow.focus();
            // Bring app to front on macOS
            if (process.platform === 'darwin') {
                app.focus({ steal: true });
            }
            return this.accountWindow;
        }
        
        // Create a proper window with native controls, positioned at screen edge
        const { screen } = require('electron');
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
        
        const accountOptions = {
            width: 480,
            height: 650,
            x: screenWidth - 500, // Position at right edge with some margin
            y: 50, // Slight offset from top
            resizable: true,
            frame: true,
            title: 'Jarvis - Account',
            alwaysOnTop: false,
            modal: false,
            show: false, // Don't show until ready
            skipTaskbar: false, // Show in dock/taskbar for Cmd+Tab
            focusable: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        };
        
        // macOS-only: Prevent screen recording
        if (process.platform === 'darwin') {
            accountOptions.contentProtection = true;
        }
        
        const accountWindow = new BrowserWindow(accountOptions);

        // macOS-only: Enable content protection (check stealth mode preference)
        const stealthEnabled = this.getStealthModePreference();
        this.setWindowContentProtection(accountWindow, stealthEnabled);

        accountWindow.loadFile('account-window.html');
        
        // Show and focus when ready - ensures proper focus
        accountWindow.once('ready-to-show', () => {
            // Temporarily lower main window level so account window can be focused
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.setAlwaysOnTop(true, 'floating', 0);
            }
            accountWindow.show();
            accountWindow.focus();
            // Bring app to front on macOS
            if (process.platform === 'darwin') {
                app.focus({ steal: true });
            }
        });
        
        // When account window gains focus, lower main window level
        accountWindow.on('focus', () => {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.setAlwaysOnTop(true, 'floating', 0);
            }
        });
        
        // When account window loses focus, restore main window level (unless account window is still open)
        accountWindow.on('blur', () => {
            // Small delay to check if we're switching to another Jarvis window
            setTimeout(() => {
                if (this.accountWindow && !this.accountWindow.isDestroyed() && this.accountWindow.isFocused()) {
                    return; // Still focused on account window
                }
                if (this.passwordResetWindow && !this.passwordResetWindow.isDestroyed() && this.passwordResetWindow.isFocused()) {
                    return; // Focused on password reset window
                }
                // Restore main window level
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    try {
                        this.mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
                    } catch (_) {
                        this.mainWindow.setAlwaysOnTop(true, 'floating', 1);
                    }
                }
            }, 100);
        });
        
        accountWindow.on('closed', () => {
            this.accountWindow = null;
            // Restore main window level when account window closes
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                try {
                    this.mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
                } catch (_) {
                    this.mainWindow.setAlwaysOnTop(true, 'floating', 1);
                }
            }
        });

        this.accountWindow = accountWindow;
        return accountWindow;
    }

    createPasswordResetWindow(email = '') {
        // Reuse existing window if it exists
        if (this.passwordResetWindow && !this.passwordResetWindow.isDestroyed()) {
            this.passwordResetWindow.show();
            this.passwordResetWindow.focus();
            if (process.platform === 'darwin') {
                app.focus({ steal: true });
            }
            return this.passwordResetWindow;
        }
        
        const { screen } = require('electron');
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
        
        const windowWidth = 480;
        const windowHeight = 580;
        
        const resetOptions = {
            width: windowWidth,
            height: windowHeight,
            x: Math.floor((screenWidth - windowWidth) / 2),
            y: Math.floor((screenHeight - windowHeight) / 2),
            resizable: false,
            frame: true,
            title: 'Jarvis - Reset Password',
            alwaysOnTop: false,
            modal: false,
            show: false, // Don't show until ready
            skipTaskbar: false, // Show in dock/taskbar for Cmd+Tab
            focusable: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        };
        
        // macOS-only: Prevent screen recording
        if (process.platform === 'darwin') {
            resetOptions.contentProtection = true;
        }
        
        const resetWindow = new BrowserWindow(resetOptions);

        // macOS-only: Enable content protection
        const stealthEnabled = this.getStealthModePreference();
        this.setWindowContentProtection(resetWindow, stealthEnabled);

        // Load the page with email parameter
        resetWindow.loadFile('password-reset.html', { 
            query: email ? { email: email } : {} 
        });
        
        // Show and focus when ready
        resetWindow.once('ready-to-show', () => {
            // Temporarily lower main window level so reset window can be focused
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.setAlwaysOnTop(true, 'floating', 0);
            }
            resetWindow.show();
            resetWindow.focus();
            if (process.platform === 'darwin') {
                app.focus({ steal: true });
            }
        });
        
        // When reset window gains focus, lower main window level
        resetWindow.on('focus', () => {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.setAlwaysOnTop(true, 'floating', 0);
            }
        });
        
        // When reset window loses focus, check if we should restore main window level
        resetWindow.on('blur', () => {
            setTimeout(() => {
                if (this.passwordResetWindow && !this.passwordResetWindow.isDestroyed() && this.passwordResetWindow.isFocused()) {
                    return;
                }
                if (this.accountWindow && !this.accountWindow.isDestroyed() && this.accountWindow.isFocused()) {
                    return;
                }
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    try {
                        this.mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
                    } catch (_) {
                        this.mainWindow.setAlwaysOnTop(true, 'floating', 1);
                    }
                }
            }, 100);
        });
        
        resetWindow.on('closed', () => {
            this.passwordResetWindow = null;
            // Restore main window level when reset window closes
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                try {
                    this.mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
                } catch (_) {
                    this.mainWindow.setAlwaysOnTop(true, 'floating', 1);
                }
            }
        });

        this.passwordResetWindow = resetWindow;
        return resetWindow;
    }

    createHotkeysWindow() {
        // Create a proper window with native controls, positioned at screen edge
        const { screen } = require('electron');
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
        
        const hotkeysOptions = {
            width: 500,
            height: 600,
            x: screenWidth - 500, // Position at right edge
            y: 0, // Top of screen
            resizable: true,
            frame: true,
            title: 'Hotkeys',
            alwaysOnTop: false,
            modal: false,
            parent: this.mainWindow,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        };
        
        // macOS-only: Prevent screen recording
        if (process.platform === 'darwin') {
            hotkeysOptions.contentProtection = true;
        }
        
        const hotkeysWindow = new BrowserWindow(hotkeysOptions);

        // macOS-only: Enable content protection (check stealth mode preference)
        const stealthEnabled = this.getStealthModePreference();
        this.setWindowContentProtection(hotkeysWindow, stealthEnabled);

        hotkeysWindow.loadFile('hotkeys-window.html');
        
        hotkeysWindow.on('closed', () => {
            this.hotkeysWindow = null;
        });

        this.hotkeysWindow = hotkeysWindow;
        return hotkeysWindow;
    }

    setupVoiceRecording() {
        // Only set up shortcuts if voice recorder is available
        if (!this.voiceRecorder) {
            console.warn('⚠️ Voice recording not available - OpenAI API key not configured');
            return;
        }

        // Only set up default shortcuts if no custom voice shortcut is set
        if (!this.currentVoiceShortcut) {
            const shortcuts = [
                'Command+S',        // Command+S for toggle recording
                'Option+V'          // Option+V for toggle recording
            ];

            shortcuts.forEach(shortcut => {
                try {
                    globalShortcut.register(shortcut, () => {
                        this.toggleVoiceRecording();
                    });
                } catch (error) {
                    // Shortcut registration failed, continue with others
                }
            });
        }
    }


    // Toggle voice recording on/off
    async toggleVoiceRecording() {
        if (this.isVoiceRecording) {
            await this.stopVoiceRecording();
        } else {
            await this.startVoiceRecording();
        }
    }

    async startVoiceRecording() {
        if (this.isVoiceRecording) return;
        
        if (!this.voiceRecorder) {
            const errorMsg = 'Voice recording not available - OpenAI API key not configured';
            console.error(errorMsg);
            if (this.mainWindow) {
                this.mainWindow.webContents.send('voice-recording-error', errorMsg);
            }
            return;
        }
        
        this.isVoiceRecording = true;
        this.recordingStartTime = Date.now();
        
        try {
            // Show recording indicator
            if (this.mainWindow) {
                this.mainWindow.webContents.send('voice-recording-started');
            }

            const audioFile = await this.voiceRecorder.startRecording();
            
        } catch (error) {
            console.error('Failed to start recording:', error);
            this.isVoiceRecording = false;
            if (this.mainWindow) {
                const errorMsg = error.message || 'Failed to start voice recording';
                this.mainWindow.webContents.send('voice-recording-error', errorMsg);
            }
        }
    }


    async stopVoiceRecording() {
        if (!this.isVoiceRecording || !this.voiceRecorder) return;

        this.isVoiceRecording = false;

        // Immediately hide recording indicator and show processing state
        if (this.mainWindow) {
            this.mainWindow.webContents.send('voice-recording-processing');
        }

        try {
            const audioFile = await this.voiceRecorder.stopRecording();
            if (audioFile) {
                const transcribedText = await this.voiceRecorder.transcribeAudio(audioFile);

                    if (transcribedText && this.mainWindow) {
                        // Send transcribed text to the overlay for editing
                        this.mainWindow.webContents.send('voice-transcription', transcribedText);
                    }
            }
        } catch (error) {
            console.error('Voice recording error:', error);
            if (this.mainWindow) {
                let errorMsg = error.message || 'Voice recording failed';
                // Provide more helpful error messages
                if (error.response?.status === 401) {
                    errorMsg = 'OpenAI API key is invalid or expired. Please check your OPENAI_API_KEY configuration.';
                } else if (error.response?.status === 429) {
                    errorMsg = 'OpenAI API rate limit exceeded. Please try again later.';
                } else if (error.message?.includes('API key')) {
                    errorMsg = 'OpenAI API key is not configured. Please set OPENAI_API_KEY in your environment variables or .env file.';
                }
                this.mainWindow.webContents.send('voice-recording-error', errorMsg);
            }
        } finally {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('voice-recording-stopped');
            }
        }
    }


    setupAuthHandlers() {

        // Handle paywall events
        ipcMain.on('paywall-complete', async () => {
            console.log('Paywall complete event received');
            if (this.paywallWindow) {
                this.paywallWindow.close();
                this.paywallWindow = null;
            }
            
            // Only create window if it doesn't exist
            if (!this.mainWindow || this.mainWindow.isDestroyed()) {
                        this.createWindow();
                        this.setupIpcHandlers();
                        if (process.platform === 'darwin' && app.dock) {
                            app.dock.hide();
                        }
                
                // If onboarding not complete, show overlay with interactive tutorial
                if (!this.isOnboardingComplete()) {
                    this.needsInteractiveTutorial = true;
                    setTimeout(() => {
                        this.showOverlay();
                    }, 500);
                }
            }
        });

        ipcMain.on('trial-started', async () => {
            // Trial is now active, proceed to main app
            if (this.paywallWindow) {
                this.paywallWindow.close();
                this.paywallWindow = null;
            }
            
            // Only create window if it doesn't exist
            if (!this.mainWindow || this.mainWindow.isDestroyed()) {
                this.createWindow();
                this.setupIpcHandlers();
                if (process.platform === 'darwin' && app.dock) {
                    app.dock.hide();
                }
                
                // If onboarding not complete, show overlay with interactive tutorial
                if (!this.isOnboardingComplete()) {
                    this.needsInteractiveTutorial = true;
                    setTimeout(() => {
                        this.showOverlay();
                    }, 500);
                }
            }
        });

        ipcMain.on('paywall-skipped', async () => {
            // User chose to skip, proceed with limited features
            if (this.paywallWindow) {
                this.paywallWindow.close();
                this.paywallWindow = null;
            }
            
            // Only create window if it doesn't exist
            if (!this.mainWindow || this.mainWindow.isDestroyed()) {
                this.createWindow();
                this.setupIpcHandlers();
                if (process.platform === 'darwin' && app.dock) {
                    app.dock.hide();
                }
                
                // If onboarding not complete, show overlay with interactive tutorial
                if (!this.isOnboardingComplete()) {
                    this.needsInteractiveTutorial = true;
                    setTimeout(() => {
                        this.showOverlay();
                    }, 500);
                }
            }
        });

        ipcMain.on('paywall-closed', () => {
            // User closed paywall, quit app
            app.quit();
        });

        // Handle password set notification
        ipcMain.on('password-set', (event, email) => {
            console.log('🔐 Password set for:', email);
            // Notify main window to hide password notification
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('password-set', email);
            }
        });

        // Handle open paywall request from main app
        ipcMain.on('open-paywall', () => {
            this.createPaywallWindow();
        });

        // Handle onboarding events
        ipcMain.on('open-screen-recording-settings', () => {
            this.openScreenRecordingSettings();
        });

        ipcMain.on('onboarding-complete', async () => {
            // Permissions screen completed - now show features screen
            // Don't mark onboarding as complete yet, wait for features screen
            this.showFeaturesOnboarding();
        });

        ipcMain.on('onboarding-features-complete', async () => {
            // Mark onboarding as complete (both screens done)
            this.markOnboardingComplete();
            
            // Create main window if it doesn't exist - DO NOT close onboarding yet
            if (!this.mainWindow || this.mainWindow.isDestroyed()) {
                // Create window
                this.createWindow();
                
                if (process.platform === 'darwin' && app.dock) {
                    app.dock.hide();
                }
                
                // Wait for window to be fully loaded and visible
                if (this.mainWindow) {
                    // Use did-finish-load to ensure window is fully ready
                    this.mainWindow.webContents.once('did-finish-load', () => {
                        // Additional safety check - wait for ready-to-show
                        this.mainWindow.once('ready-to-show', () => {
                            // Force show the overlay
                            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                this.showOverlay();
                            }
                            
                            // Wait for window to be definitely visible before closing onboarding
                            const checkAndClose = () => {
                                if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isVisible()) {
                                    // Main window is visible, safe to close onboarding
                                    if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
                                        this.onboardingWindow.close();
                                        this.onboardingWindow = null;
                                    }
                                } else {
                                    // Not visible yet, check again
                                    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                        this.showOverlay();
                                    }
                                    setTimeout(checkAndClose, 200);
                                }
                            };
                            
                            // Start checking after a delay
                            setTimeout(checkAndClose, 500);
                        });
                    });
                }
            } else {
                // Main window already exists, ensure it's shown
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.showOverlay();
                    // Wait a moment then close onboarding
                    setTimeout(() => {
                        if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isVisible()) {
                            if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
                                this.onboardingWindow.close();
                                this.onboardingWindow = null;
                            }
                        }
                    }, 1000);
                }
            }
        });

        // Exa API handlers
        ipcMain.handle('extract-website-content', async (_event, url) => {
            try {
                const document = await this.extractWebsiteContent(url);
                return document;
            } catch (error) {
                console.error('Failed to extract website content:', error);
                throw error;
            }
        });

        ipcMain.handle('get-current-document', () => {
            return this.getCurrentDocument();
        });

        ipcMain.handle('clear-current-document', () => {
            this.clearCurrentDocument();
        });
    }


    createWindow() {
        // Ensure app is ready before using screen module
        if (!app.isReady()) {
            console.error('Cannot create window: app is not ready');
            return;
        }
        
        // Get primary display info
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width, height } = primaryDisplay.bounds;

        // Create a true overlay window
        // IMPORTANT: This window is designed to NOT trigger browser blur events
        // which proctoring software (Canvas, etc.) uses to detect "tab switching"
        const mainWindowOptions = {
            width: width,
            height: height,
            x: 0,
            y: 0,
            frame: false,
            alwaysOnTop: true,
            transparent: true,
            backgroundColor: '#00000000',
            resizable: false,
            movable: false,
            minimizable: false,
            maximizable: false,
            skipTaskbar: true,
            focusable: true, // Allow focus for input interactions
            fullscreenable: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                enableRemoteModule: true
            },
            show: false, // Don't show until ready
            hasShadow: false,
            thickFrame: false
        };
        
        // macOS-only: Configure as a utility/panel window that doesn't steal focus
        if (process.platform === 'darwin') {
            mainWindowOptions.contentProtection = true;
            // These help prevent the window from activating the app
            mainWindowOptions.type = 'panel'; // Makes it a floating panel on macOS
            mainWindowOptions.acceptFirstMouse = true; // Accept clicks without activating
        }
        
        this.mainWindow = new BrowserWindow(mainWindowOptions);

        // macOS-only: Enable content protection to hide from screen recording (like Cluely)
        // Check if stealth mode is enabled (default: true)
        const stealthModeEnabled = this.getStealthModePreference();
        this.setWindowContentProtection(this.mainWindow, stealthModeEnabled);
        
        // CRITICAL: Also ensure screenshot detection is set up when window is created
        // This ensures shortcuts are registered even if stealth mode was enabled before window creation
        if (stealthModeEnabled) {
            // Wait a moment for window to be fully ready, then setup screenshot detection
            setTimeout(() => {
                this.setupScreenshotDetection();
            }, 500);
        }

        // Immediately assert fullscreen visibility properties after creation
        try {
            this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        } catch (_) {
            try { this.mainWindow.setVisibleOnAllWorkspaces(true); } catch (__) {}
        }
        try {
            this.mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
        } catch (_) {
            try { this.mainWindow.setAlwaysOnTop(true, 'pop-up-menu', 1); } catch (__) {
                try { this.mainWindow.setAlwaysOnTop(true, 'floating', 1); } catch (___) {
                    this.mainWindow.setAlwaysOnTop(true);
                }
            }
        }

        // Request microphone permission
        this.mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
            if (permission === 'microphone') {
                callback(true); // Grant microphone permission
            } else {
                callback(false);
            }
        });

        // Make the window click-through by default
        this.mainWindow.setIgnoreMouseEvents(true);
        

        // Hide Dock for overlay utility feel (macOS)
        if (process.platform === 'darwin' && app.dock) { try { app.dock.hide(); } catch (_) {} }

        // Load the HTML file
        this.mainWindow.loadFile('index.html').catch(err => {
            console.error('Failed to load index.html:', err);
        });


        // Window is ready; show overlay immediately
        this.mainWindow.once('ready-to-show', () => {
            // Ensure window is fully initialized before showing
            // Set up fullscreen visibility BEFORE showing
            try {
                this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
            } catch (_) {
                try {
                    this.mainWindow.setVisibleOnAllWorkspaces(true);
                } catch (__) {}
            }
            
            // Use screen-saver level (highest = 1000) for maximum fullscreen visibility
            try {
                this.mainWindow.setAlwaysOnTop(true, 'screen-saver');
            } catch (_) {
                try {
                    this.mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
                } catch (__) {
                    try {
                        this.mainWindow.setAlwaysOnTop(true, 'floating');
                    } catch (___) {
                        this.mainWindow.setAlwaysOnTop(true);
                    }
                }
            }
            
            // Enable mouse events BEFORE showing to prevent glitching
            try { 
                this.mainWindow.setIgnoreMouseEvents(false); 
            } catch (_) {}
            
            // Small delay to ensure all properties are set before showing
            setTimeout(() => {
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    // Now show the overlay (this will also call forceFullscreenVisibility)
                    this.showOverlay();
                    
                    // Reinforce fullscreen visibility multiple times to ensure it sticks
                    const reinforce = () => {
                        if (this.mainWindow && !this.mainWindow.isDestroyed() && this.isOverlayVisible) {
                            this.forceFullscreenVisibility();
                        }
                    };
                    
                    setTimeout(reinforce, 100);
                    setTimeout(reinforce, 300);
                    setTimeout(reinforce, 600);
                }
            }, 50); // Small delay to ensure window is ready
        });

        // Minimal: no repeated reassertions; rely on initial setup and showOverlay()
        

        this.mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
            console.error('Page failed to load:', errorCode, errorDescription);
        });

        // Handle window closed
        this.mainWindow.on('closed', () => {
            this.mainWindow = null;
        });

        // Windows-specific focus handling: ensure window can receive focus when clicked
        if (process.platform === 'win32') {
            // Force focus when window is clicked
            this.mainWindow.on('focus', () => {
                // Ensure window stays focusable when it receives focus
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    try {
                        this.mainWindow.setFocusable(true);
                    } catch (_) {}
                }
            });

            // Handle window blur - on Windows, we need to ensure it can regain focus
            this.mainWindow.on('blur', () => {
                // Don't make it unfocusable on blur - allow it to regain focus
                // The window should remain focusable so user can click to focus it
            });

            // Ensure window can receive focus when clicked (Windows-specific)
            // The window will automatically receive focus when clicked if it's focusable
            // We handle this through the focus event handler above
        }

        // Prevent navigation away from the app
        this.mainWindow.webContents.on('will-navigate', (event) => {
            event.preventDefault();
        });

        // Enable dev tools in development or with Cmd+Option+I
        if (process.argv.includes('--dev')) {
            this.mainWindow.webContents.openDevTools();
        }
        
        // Add keyboard shortcut to toggle DevTools (Cmd+Option+I)
        this.mainWindow.webContents.on('before-input-event', (event, input) => {
            if (input.key === 'i' && input.meta && input.alt) {
                if (this.mainWindow.webContents.isDevToolsOpened()) {
                    this.mainWindow.webContents.closeDevTools();
                } else {
                    this.mainWindow.webContents.openDevTools();
                }
            }
        });
    }

    setupIpcHandlers() {
        // Prevent duplicate handler registration
        if (this.ipcHandlersSetup) {
            return;
        }
        this.ipcHandlersSetup = true;

        // Handle getting all display bounds for multi-monitor support
        ipcMain.handle('get-all-displays', () => {
            const { screen } = require('electron');
            const displays = screen.getAllDisplays();
            return displays.map(d => ({
                id: d.id,
                bounds: d.bounds,
                workArea: d.workArea
            }));
        });

        // Interactive tutorial IPC handlers
        ipcMain.handle('needs-interactive-tutorial', () => {
            return !this.isOnboardingComplete();
        });
        
        ipcMain.handle('check-screen-permission', () => {
            if (process.platform !== 'darwin') return true;
            const screenStatus = systemPreferences.getMediaAccessStatus('screen');
            return screenStatus === 'granted';
        });
        
        ipcMain.handle('complete-interactive-tutorial', () => {
            this.markOnboardingComplete();
            this.needsInteractiveTutorial = false;
            return true;
        });

        // Handle overlay toggle
        ipcMain.handle('toggle-overlay', () => {
            this.toggleOverlay();
        });

        // Handle making overlay interactive
        // IMPORTANT: This version does NOT steal focus from other windows
        // to avoid triggering proctoring software (Canvas, etc.) that monitors window blur events
        ipcMain.handle('make-interactive', () => {
            // Don't interfere if account or password reset window is focused
            if (this.accountWindow && !this.accountWindow.isDestroyed() && this.accountWindow.isFocused()) {
                return { success: true, skipped: 'account window focused' };
            }
            if (this.passwordResetWindow && !this.passwordResetWindow.isDestroyed() && this.passwordResetWindow.isFocused()) {
                return { success: true, skipped: 'password reset window focused' };
            }
            
            if (this.mainWindow) {
                try {
                    console.log('🔵 [MAIN] make-interactive called (focus-safe mode)');
                    
                    // CRITICAL: Only enable mouse events - DO NOT call focus()
                    // This allows interaction without triggering browser blur events
                    this.mainWindow.setIgnoreMouseEvents(false);
                    console.log('🔵 [MAIN] setIgnoreMouseEvents(false) called');
                    
                    // Make window focusable but don't actually focus it
                    // The user clicking on the input will naturally give it focus
                    // without the OS registering it as an app switch
                    this.mainWindow.setFocusable(true);
                    
                    // Ensure window is visible and on top without stealing focus
                    if (process.platform === 'darwin') {
                        this.mainWindow.showInactive(); // Show without activating
                        // Re-assert always on top without focus
                        setTimeout(() => {
                            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                this.mainWindow.setIgnoreMouseEvents(false);
                                this.mainWindow.setFocusable(true);
                                // Use setAlwaysOnTop to keep visible without focus
                                this.mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
                            }
                        }, 50);
                    } else if (process.platform === 'win32') {
                        // On Windows, show without focus
                        this.mainWindow.showInactive();
                        setTimeout(() => {
                            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                this.mainWindow.setFocusable(true);
                                this.mainWindow.setIgnoreMouseEvents(false);
                            }
                        }, 100);
                    }
                    
                    console.log('✅ [MAIN] make-interactive completed (no focus steal)');
                    return { success: true };
                } catch (error) {
                    console.error('❌ [MAIN] Error making window interactive:', error);
                    return { success: false, error: error.message };
                }
            } else {
                console.error('❌ [MAIN] mainWindow is null');
                return { success: false, error: 'Main window not available' };
            }
        });

        // Handle focus request from renderer
        // NOTE: We intentionally do NOT call focus() to avoid triggering browser blur events
        // which proctoring software (Canvas, etc.) uses to detect tab switching
        ipcMain.handle('request-focus', () => {
            // Don't interfere if account or password reset window is focused
            if (this.accountWindow && !this.accountWindow.isDestroyed() && this.accountWindow.isFocused()) {
                return true;
            }
            if (this.passwordResetWindow && !this.passwordResetWindow.isDestroyed() && this.passwordResetWindow.isFocused()) {
                return true;
            }
            
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                try {
                    this.mainWindow.setFocusable(true);
                    // DO NOT call focus() - this triggers browser blur events
                    // Instead, just ensure the window is visible and can receive input
                    this.mainWindow.setIgnoreMouseEvents(false);
                    this.mainWindow.moveTop();
                    return true;
                } catch (_) {
                    return false;
                }
            }
            return false;
        });

        // Handle making overlay click-through
        ipcMain.handle('make-click-through', () => {
            if (this.mainWindow) {
                this.mainWindow.setIgnoreMouseEvents(true, { forward: true });
                try { 
                    // On Windows, keep window focusable but blurred so it can regain focus when clicked
                    // This prevents the "background process" issue
                    if (process.platform === 'win32') {
                        // Don't set focusable to false - keep it focusable so it can regain focus
                        this.mainWindow.blur();
                    } else {
                        // On macOS/Linux, we can safely make it unfocusable
                        this.mainWindow.setFocusable(false);
                    }
                } catch (_) {}
            }
        });
        
        // Handle enabling drag-through mode (click-through with event forwarding for drag operations)
        ipcMain.handle('enable-drag-through', () => {
            if (this.mainWindow) {
                // Set to ignore mouse events but forward them, allowing drag to pass through
                this.mainWindow.setIgnoreMouseEvents(true, { forward: true });
            }
        });

        // Handle overlay hide
        ipcMain.handle('hide-overlay', () => {
            this.hideOverlay();
        });

        // Handle screenshot capture
        ipcMain.handle('take-screenshot', async () => {
            try {
                // Check if user has free access or valid license
                const hasFreeAccess = await this.checkFreeAccess();
                if (!hasFreeAccess) {
                    // For now, skip license check in main process to avoid localStorage errors
                    // License will be checked in renderer process
                }

                // Ensure content protection is enabled so overlay is hidden from screenshots
                // This makes the overlay invisible to screenshots without actually hiding it visually
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    // Temporarily ensure content protection is enabled for screenshot
                    // The overlay will stay visible but won't appear in the screenshot
                    console.log('📸 Ensuring content protection is enabled for screenshot');
                    this.mainWindow.setContentProtection(true);
                }
                
                // Check screen recording permission status first
                const screenStatus = systemPreferences.getMediaAccessStatus('screen');
                console.log('📸 Screen recording permission status:', screenStatus);
                
                // Use Electron's built-in desktopCapturer with proper error handling
                let sources;
                try {
                    sources = await desktopCapturer.getSources({
                        types: ['screen'],
                        thumbnailSize: { width: 1920, height: 1080 }
                    });
                } catch (capturerError) {
                    console.error('DesktopCapturer error:', capturerError);
                    if (screenStatus === 'granted') {
                        // Permission granted but capture failed - needs restart
                        throw new Error('Screen recording permission granted! Please restart Jarvis for it to take effect.');
                    } else {
                        // Permission not granted - open settings
                        this.openScreenRecordingSettings();
                        throw new Error('Please enable Screen Recording for Jarvis in System Preferences, then restart the app.');
                    }
                }
                
                if (!sources || sources.length === 0) {
                    if (screenStatus === 'granted') {
                        throw new Error('Screen recording permission granted! Please restart Jarvis for it to take effect.');
                    } else {
                        this.openScreenRecordingSettings();
                        throw new Error('Please enable Screen Recording for Jarvis in System Preferences, then restart the app.');
                    }
                }
                
                // Get the first screen source
                const source = sources[0];
                const dataUrl = source.thumbnail.toDataURL();
                
                // Restore content protection state if we changed it
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    const stealthEnabled = this.getStealthModePreference();
                    // Only restore if stealth mode is disabled (otherwise keep it protected)
                    if (!stealthEnabled) {
                        this.mainWindow.setContentProtection(false);
                    }
                }
                
                return dataUrl;
                
            } catch (error) {
                console.error('Screenshot failed:', error);
                throw error;
            }
        });

        // Toggle click-through from renderer
        ipcMain.handle('set-ignore-mouse-events', (_event, shouldIgnore) => {
            if (!this.mainWindow) return;
            // When ignoring, forward events so underlying apps receive them
            if (shouldIgnore) {
                this.mainWindow.setIgnoreMouseEvents(true, { forward: true });
            } else {
                this.mainWindow.setIgnoreMouseEvents(false);
            }
        });

        // Removed: open-application and app-action handlers

        // Handle license check
        ipcMain.handle('check-license', async (event, userEmail = null) => {
            try {
                const licenseStatus = await this.licenseManager.checkLicense(userEmail);
                const features = this.licenseManager.getFeatureAccess();
                return {
                    valid: licenseStatus.valid,
                    type: licenseStatus.type,
                    features: features
                };
            } catch (error) {
                console.error('License check failed:', error);
                return {
                    valid: false,
                    type: 'error',
                    features: {}
                };
            }
        });

        // Handle free access grant
        ipcMain.on('grant-free-access', () => {
            this.grantFreeAccess();
        });

        // Handle opening external URLs
        ipcMain.on('open-external-url', (event, url) => {
            shell.openExternal(url);
        });



        // Handle adding content to Notes app (macOS only)
        ipcMain.handle('add-to-notes', async (event, content) => {
            if (process.platform !== 'darwin') {
                return Promise.reject(new Error('Notes app integration is only available on macOS'));
            }
            
            try {
                const timestamp = new Date().toLocaleString();
                const noteContent = `Jarvis AI Response - ${timestamp}\n\n${content}`;
                
                const script = `
                    tell application "Notes"
                        activate
                        tell account "iCloud"
                            make new note with properties {body:"${noteContent.replace(/"/g, '\\"')}"}
                        end tell
                    end tell
                `;
                
                return new Promise((resolve, reject) => {
                    exec(`osascript -e '${script}'`, (error, stdout, stderr) => {
                        if (error) {
                            console.error('Error opening Notes:', error);
                            reject(error);
                        } else {
                            resolve('Added to Notes app successfully!');
                        }
                    });
                });
            } catch (error) {
                console.error('Error adding to Notes:', error);
                throw error;
            }
        });

        // Handle website summarization
        ipcMain.handle('summarize-website', async (event, url, fullMessage) => {
            try {
                const { summarizeWebsite } = require('./summarizeWebsite');
                // Get proxy URL and anon key for secure API calls
                const supabaseConfig = this.secureConfig.getSupabaseConfig();
                const apiProxyUrl = this.secureConfig.getSupabaseApiProxyUrl() || supabaseConfig?.apiProxyUrl || '';
                const supabaseAnonKey = supabaseConfig?.anonKey || '';
                const summary = await summarizeWebsite(url, fullMessage, apiProxyUrl, supabaseAnonKey);
                return summary;
            } catch (error) {
                console.error('Error summarizing website:', error);
                return `Error: ${error.message}`;
            }
        });

        // Handle opening account window
        ipcMain.handle('open-account-window', () => {
            // Reuse existing window if it exists
            if (this.accountWindow && !this.accountWindow.isDestroyed()) {
                this.accountWindow.show();
                this.accountWindow.focus();
                return;
            }
            this.createAccountWindow();
        });
        
        // Handle opening account in browser
        ipcMain.handle('open-account-in-browser', async () => {
            const { shell } = require('electron');
            
            // Get user email if available
            let email = '';
            try {
                const fs = require('fs');
                const path = require('path');
                const userDataPath = app.getPath('userData');
                const userFile = path.join(userDataPath, 'jarvis_user.json');
                if (fs.existsSync(userFile)) {
                    const userData = JSON.parse(fs.readFileSync(userFile, 'utf8'));
                    email = userData.email || '';
                }
            } catch (e) {}
            
            // Open account page in browser
            let url = 'https://yesjarvis.com/account/';
            if (email) {
                url += `?email=${encodeURIComponent(email)}`;
            }
            
            await shell.openExternal(url);
        });
        
        // Handle opening hotkeys window
        ipcMain.handle('open-hotkeys-window', () => {
            this.createHotkeysWindow();
        });
        
        // Handle getting/setting toggle shortcut
        ipcMain.handle('get-toggle-shortcut', () => {
            const fs = require('fs');
            const path = require('path');
            const userDataPath = app.getPath('userData');
            const shortcutFile = path.join(userDataPath, 'toggle-shortcut.json');
            try {
                if (fs.existsSync(shortcutFile)) {
                    const data = JSON.parse(fs.readFileSync(shortcutFile, 'utf8'));
                    return data.shortcut || null;
                }
            } catch (e) {}
            return null;
        });
        
        ipcMain.handle('set-toggle-shortcut', async (event, shortcut) => {
            const fs = require('fs');
            const path = require('path');
            const userDataPath = app.getPath('userData');
            const shortcutFile = path.join(userDataPath, 'toggle-shortcut.json');
            try {
                // Get old custom shortcut to unregister it
                let oldShortcut = null;
                if (fs.existsSync(shortcutFile)) {
                    const data = JSON.parse(fs.readFileSync(shortcutFile, 'utf8'));
                    oldShortcut = data.shortcut;
                }
                
                // Save new shortcut
                fs.writeFileSync(shortcutFile, JSON.stringify({ shortcut }, null, 2));
                
                // Unregister old custom shortcut (if it's not a default)
                if (oldShortcut && oldShortcut !== 'Alt+Space' && oldShortcut !== 'CommandOrControl+Shift+Space') {
                    try { globalShortcut.unregister(oldShortcut); } catch (_) {}
                }
                
                // Register new shortcut (if it's not already a default)
                if (shortcut !== 'Alt+Space' && shortcut !== 'CommandOrControl+Shift+Space') {
                    try {
                        globalShortcut.register(shortcut, () => { this.toggleOverlay(); });
                    } catch (e) {
                        console.error('Failed to register shortcut:', e);
                    }
                }
            } catch (e) {
                console.error('Failed to save shortcut:', e);
            }
        });
        
        // Handle getting/setting answer screen shortcut
        ipcMain.handle('get-answer-screen-shortcut', () => {
            const fs = require('fs');
            const path = require('path');
            const userDataPath = app.getPath('userData');
            const shortcutFile = path.join(userDataPath, 'answer-screen-shortcut.json');
            try {
                if (fs.existsSync(shortcutFile)) {
                    const data = JSON.parse(fs.readFileSync(shortcutFile, 'utf8'));
                    return data.shortcut || null;
                }
            } catch (e) {}
            return null;
        });
        
        ipcMain.handle('set-answer-screen-shortcut', async (event, shortcut) => {
            const fs = require('fs');
            const path = require('path');
            const userDataPath = app.getPath('userData');
            const shortcutFile = path.join(userDataPath, 'answer-screen-shortcut.json');
            try {
                fs.writeFileSync(shortcutFile, JSON.stringify({ shortcut }, null, 2));
                // Register the shortcut
                this.registerAnswerScreenShortcut(shortcut);
            } catch (e) {
                console.error('Failed to save answer screen shortcut:', e);
            }
        });

        // Handle unbinding toggle shortcut
        ipcMain.handle('unbind-toggle-shortcut', async () => {
            const fs = require('fs');
            const path = require('path');
            const userDataPath = app.getPath('userData');
            const shortcutFile = path.join(userDataPath, 'toggle-shortcut.json');
            try {
                // Get the current shortcut before removing
                let currentShortcut = null;
                if (fs.existsSync(shortcutFile)) {
                    const data = JSON.parse(fs.readFileSync(shortcutFile, 'utf8'));
                    currentShortcut = data.shortcut;
                    fs.unlinkSync(shortcutFile);
                }
                // Unregister the custom shortcut only if it's not a default
                // (defaults always stay registered)
                if (currentShortcut && currentShortcut !== 'Alt+Space' && currentShortcut !== 'CommandOrControl+Shift+Space') {
                    try {
                        globalShortcut.unregister(currentShortcut);
                    } catch (_) {}
                }
                console.log('Custom toggle shortcut unbound (defaults still active)');
            } catch (e) {
                console.error('Failed to unbind toggle shortcut:', e);
            }
        });

        // Handle unbinding answer screen shortcut
        ipcMain.handle('unbind-answer-screen-shortcut', async () => {
            const fs = require('fs');
            const path = require('path');
            const userDataPath = app.getPath('userData');
            const shortcutFile = path.join(userDataPath, 'answer-screen-shortcut.json');
            try {
                // Remove the shortcut file
                if (fs.existsSync(shortcutFile)) {
                    fs.unlinkSync(shortcutFile);
                }
                // Unregister answer screen shortcut if it exists
                if (this.currentAnswerScreenShortcut) {
                    globalShortcut.unregister(this.currentAnswerScreenShortcut);
                    this.currentAnswerScreenShortcut = null;
                }
                console.log('Answer screen shortcut unbound');
            } catch (e) {
                console.error('Failed to unbind answer screen shortcut:', e);
            }
        });

        // Handle getting/setting voice shortcut
        ipcMain.handle('get-voice-shortcut', () => {
            const fs = require('fs');
            const path = require('path');
            const userDataPath = app.getPath('userData');
            const shortcutFile = path.join(userDataPath, 'voice-shortcut.json');
            try {
                if (fs.existsSync(shortcutFile)) {
                    const data = JSON.parse(fs.readFileSync(shortcutFile, 'utf8'));
                    return data.shortcut || null;
                }
            } catch (e) {}
            return null;
        });

        ipcMain.handle('set-voice-shortcut', async (event, shortcut) => {
            const fs = require('fs');
            const path = require('path');
            const userDataPath = app.getPath('userData');
            const shortcutFile = path.join(userDataPath, 'voice-shortcut.json');
            try {
                fs.writeFileSync(shortcutFile, JSON.stringify({ shortcut }, null, 2));
                // Unregister default shortcuts before registering custom one
                try { globalShortcut.unregister('Command+S'); } catch (_) {}
                try { globalShortcut.unregister('Option+V'); } catch (_) {}
                // Register the shortcut
                this.registerVoiceShortcut(shortcut);
            } catch (e) {
                console.error('Failed to save voice shortcut:', e);
            }
        });

        // Handle unbinding voice shortcut
        ipcMain.handle('unbind-voice-shortcut', async () => {
            const fs = require('fs');
            const path = require('path');
            const userDataPath = app.getPath('userData');
            const shortcutFile = path.join(userDataPath, 'voice-shortcut.json');
            try {
                // Remove the shortcut file
                if (fs.existsSync(shortcutFile)) {
                    fs.unlinkSync(shortcutFile);
                }
                // Unregister voice shortcut if it exists
                if (this.currentVoiceShortcut) {
                    globalShortcut.unregister(this.currentVoiceShortcut);
                    this.currentVoiceShortcut = null;
                }
                // Re-register default shortcuts
                try {
                    globalShortcut.register('Command+S', () => { this.toggleVoiceRecording(); });
                } catch (_) {}
                try {
                    globalShortcut.register('Option+V', () => { this.toggleVoiceRecording(); });
                } catch (_) {}
                console.log('Voice shortcut unbound, defaults restored');
            } catch (e) {
                console.error('Failed to unbind voice shortcut:', e);
            }
        });
        
        // Handle shortcut listening
        let shortcutListener = null;
        let currentListeningAction = null;
        let pressedModifiers = new Set();
        let pressedKey = null;
        
        ipcMain.on('start-shortcut-listening', (event, action) => {
            currentListeningAction = action || 'toggle';
            if (shortcutListener) {
                // Reset if already listening
                pressedModifiers.clear();
                pressedKey = null;
                return;
            }
            
            shortcutListener = (event, input) => {
                event.preventDefault(); // Prevent default behavior
                
                if (input.type === 'keyDown') {
                    // Track modifiers
                    if (input.control) pressedModifiers.add('CommandOrControl');
                    if (input.alt) pressedModifiers.add('Alt');
                    if (input.shift) pressedModifiers.add('Shift');
                    if (input.meta && !input.control) pressedModifiers.add('Command');
                    
                    // Track the main key (not a modifier)
                    const isModifier = ['Control', 'Alt', 'Shift', 'Meta', 'Command', 'CommandOrControl'].includes(input.key);
                    if (!isModifier && input.key) {
                        if (input.key === ' ') {
                            pressedKey = 'Space';
                        } else if (input.key.length === 1) {
                            pressedKey = input.key.toUpperCase();
                        } else {
                            pressedKey = input.key;
                        }
                        
                        // Allow 1 or 2 key combinations:
                        // - Single key (like F1, F2, etc.) 
                        // - Or modifier + key (like Shift+A, Alt+Space)
                        if (pressedKey) {
                            let shortcut;
                            if (pressedModifiers.size > 0) {
                                // Modifier + key (limit to 1 modifier for simpler shortcuts)
                                const parts = Array.from(pressedModifiers).sort().slice(0, 1);
                                parts.push(pressedKey);
                                shortcut = parts.join('+');
                            } else {
                                // Single key only
                                shortcut = pressedKey;
                            }
                            
                            if (this.hotkeysWindow && !this.hotkeysWindow.isDestroyed()) {
                                this.hotkeysWindow.webContents.send('shortcut-captured', shortcut, currentListeningAction);
                            }
                            
                            // Clean up
                            const listenerToRemove = shortcutListener;
                            pressedModifiers.clear();
                            pressedKey = null;
                            shortcutListener = null;
                            if (this.hotkeysWindow && !this.hotkeysWindow.isDestroyed() && listenerToRemove) {
                                this.hotkeysWindow.webContents.removeListener('before-input-event', listenerToRemove);
                            }
                        }
                    }
                } else if (input.type === 'keyUp') {
                    // Clear modifiers on key up
                    if (!input.control) pressedModifiers.delete('CommandOrControl');
                    if (!input.alt) pressedModifiers.delete('Alt');
                    if (!input.shift) pressedModifiers.delete('Shift');
                    if (!input.meta) pressedModifiers.delete('Command');
                }
            };
            
            if (this.hotkeysWindow && !this.hotkeysWindow.isDestroyed()) {
                pressedModifiers.clear();
                pressedKey = null;
                this.hotkeysWindow.webContents.on('before-input-event', shortcutListener);
            }
        });
        
        ipcMain.on('cancel-shortcut-listening', () => {
            if (shortcutListener && this.hotkeysWindow && !this.hotkeysWindow.isDestroyed()) {
                const listenerToRemove = shortcutListener;
                shortcutListener = null;
                this.hotkeysWindow.webContents.removeListener('before-input-event', listenerToRemove);
                pressedModifiers.clear();
                pressedKey = null;
            }
        });

        // Handle getting account info
        ipcMain.handle('get-account-info', async () => {
            try {
                const userEmail = this.getUserEmail();
                const isFreeAccess = await this.checkFreeAccess();
                const licenseStatus = await this.licenseManager.checkLicense(userEmail);
                
                const hasAccess = isFreeAccess || licenseStatus.valid;
                
                return {
                    email: userEmail || 'Not signed in',
                    premiumStatus: isFreeAccess ? 'Free Access (aaron2)' : 
                                  licenseStatus.valid ? 'Premium' : 'Free',
                    features: {
                        voiceRecording: true,
                        screenshotAnalysis: true,
                        webSearch: true,
                        documentProcessing: hasAccess,
                        advancedAI: hasAccess,
                        prioritySupport: hasAccess
                    }
                };
            } catch (error) {
                console.error('Error getting account info:', error);
                return {
                    email: 'Not signed in',
                    premiumStatus: 'Free',
                    features: {
                        voiceRecording: true,
                        screenshotAnalysis: true,
                        webSearch: true,
                        documentProcessing: false,
                        advancedAI: false,
                        prioritySupport: false
                    }
                };
            }
        });

        // Handle copying text to clipboard
        ipcMain.handle('copy-to-clipboard', (event, text) => {
            try {
                clipboard.writeText(text);
                return true;
            } catch (error) {
                console.error('Failed to copy to clipboard:', error);
                return false;
            }
        });

        // Handle stealth mode toggle
        ipcMain.handle('toggle-stealth-mode', async (_event, enabled) => {
            try {
                console.log(`🔄 Toggling stealth mode to: ${enabled}`);
                
                // Apply to all windows (including future ones)
                const windows = BrowserWindow.getAllWindows();
                let protectedCount = 0;
                windows.forEach(window => {
                    if (window && !window.isDestroyed()) {
                        this.setWindowContentProtection(window, enabled);
                        protectedCount++;
                    }
                });
                
                // Store preference in file (for persistence across restarts)
                const fs = require('fs');
                const path = require('path');
                const userDataPath = app.getPath('userData');
                const stealthFile = path.join(userDataPath, 'stealth_mode.json');
                fs.writeFileSync(stealthFile, JSON.stringify({ enabled: enabled }, null, 2));
                
                console.log(`✅ Stealth mode ${enabled ? 'ENABLED' : 'DISABLED'} - Protected ${protectedCount} windows`);
                console.log(`   Windows will be ${enabled ? 'HIDDEN' : 'VISIBLE'} in screen sharing`);
                
                return true;
            } catch (error) {
                console.error('❌ Error toggling stealth mode:', error);
                return false;
            }
        });

        // Handle disabling system sounds (for stealth mode)
        ipcMain.handle('disable-system-sounds', async (_event, disabled) => {
            try {
                // On macOS, we can't directly disable system sounds, but we can prevent
                // our app from triggering them. The CSS in renderer process handles visual feedback.
                // This handler exists for future cross-platform support.
                console.log(`🔇 System sounds ${disabled ? 'DISABLED' : 'ENABLED'} for stealth mode`);
                return true;
            } catch (error) {
                console.error('❌ Error disabling system sounds:', error);
                return false;
            }
        });

        // Handle writing content to Google Docs using API
        ipcMain.handle('write-to-docs', async (_event, text, options = {}) => {
            try {
                if (!text || text.trim().length === 0) {
                    return { success: false, error: 'No text provided' };
                }

                // Use Google Docs API
                const result = await this.googleDocsIntegration.writeText(text, options);
                return result;
            } catch (error) {
                console.error('❌ Error writing to Docs:', error);
                return { success: false, error: error.message };
            }
        });

        // Handle writing content to Google Docs with realistic typing simulation
        ipcMain.handle('write-to-docs-realistic', async (_event, text, options = {}) => {
            try {
                if (!text || text.trim().length === 0) {
                    return { success: false, error: 'No text provided' };
                }

                // Use Google Docs API with realistic typing
                const result = await this.googleDocsIntegration.writeTextRealistic(text, options);
                return result;
            } catch (error) {
                console.error('❌ Error typing to Docs:', error);
                return { success: false, error: error.message };
            }
        });

        // Handle Google Docs authentication
        ipcMain.handle('google-docs-authenticate', async (_event) => {
            try {
                const tokens = await this.googleDocsIntegration.authenticate();
                return { success: true, authenticated: true, message: 'Successfully authenticated with Google Docs!' };
            } catch (error) {
                console.error('❌ Google Docs authentication error:', error);
                return { success: false, authenticated: false, error: error.message };
            }
        });

        // List Google Docs documents
        ipcMain.handle('list-google-docs', async (_event) => {
            try {
                const result = await this.googleDocsIntegration.listDocuments(50);
                return result;
            } catch (error) {
                console.error('❌ Error listing Google Docs:', error);
                return { success: false, error: error.message, documents: [] };
            }
        });

        // Check Google Docs authentication status
        ipcMain.handle('google-docs-auth-status', async (_event) => {
            try {
                const isAuthenticated = this.googleDocsIntegration.isAuthenticated();
                let email = null;
                if (isAuthenticated) {
                    email = await this.googleDocsIntegration.getUserEmail();
                }
                return { authenticated: isAuthenticated, email: email };
            } catch (error) {
                return { authenticated: false, error: error.message };
            }
        });

        // Get Google account email
        ipcMain.handle('google-account-email', async (_event) => {
            try {
                const email = await this.googleDocsIntegration.getUserEmail();
                return { email: email };
            } catch (error) {
                return { email: null, error: error.message };
            }
        });

        // Sign out from Google Docs
        ipcMain.handle('google-docs-sign-out', async (_event) => {
            try {
                const success = await this.googleDocsIntegration.signOut();
                return { success, message: success ? 'Signed out from Google Docs' : 'Failed to sign out' };
            } catch (error) {
                console.error('❌ Google Docs sign out error:', error);
                return { success: false, error: error.message };
            }
        });

        // Quit app handler
        ipcMain.handle('quit-app', () => {
            app.quit();
        });

        // Push-to-talk IPC handlers
        ipcMain.handle('start-push-to-talk', async () => {
            // Only start if not already recording
            if (!this.isVoiceRecording) {
                await this.startVoiceRecording();
            }
        });

        ipcMain.handle('stop-push-to-talk', async () => {
            // Only stop if currently recording
            if (this.isVoiceRecording) {
                await this.stopVoiceRecording();
            }
        });

        // Token usage tracking IPC handlers
        ipcMain.handle('get-user-usage', async (_event, email) => {
            if (!this.supabaseIntegration) {
                return { success: false, error: 'Supabase not initialized' };
            }
            const userEmail = email || this.currentUserEmail;
            if (!userEmail) {
                return { success: false, error: 'No user email provided' };
            }
            const usage = await this.supabaseIntegration.getMonthlyUsage(userEmail);
            const limits = await this.supabaseIntegration.checkUserLimits(userEmail);
            return { success: true, usage, limits };
        });

        ipcMain.handle('get-all-users-usage', async () => {
            if (!this.supabaseIntegration) {
                return { success: false, error: 'Supabase not initialized' };
            }
            return await this.supabaseIntegration.getAllUsersUsage();
        });

        ipcMain.handle('set-user-token-limit', async (_event, email, tokenLimit) => {
            if (!this.supabaseIntegration) {
                return { success: false, error: 'Supabase not initialized' };
            }
            return await this.supabaseIntegration.setUserTokenLimit(email, tokenLimit);
        });

        ipcMain.handle('set-user-blocked', async (_event, email, isBlocked, reason) => {
            if (!this.supabaseIntegration) {
                return { success: false, error: 'Supabase not initialized' };
            }
            return await this.supabaseIntegration.setUserBlocked(email, isBlocked, reason);
        });

        ipcMain.handle('get-usage-history', async (_event, email, days) => {
            if (!this.supabaseIntegration) {
                return { success: false, error: 'Supabase not initialized' };
            }
            return await this.supabaseIntegration.getUsageHistory(email, days || 30);
        });

        ipcMain.handle('set-default-token-limit', async (_event, tokenLimit) => {
            if (!this.supabaseIntegration) {
                return { success: false, error: 'Supabase not initialized' };
            }
            return await this.supabaseIntegration.setDefaultTokenLimit(tokenLimit);
        });

        // Auto-update IPC handlers
        ipcMain.handle('check-for-updates', async () => {
            try {
                const result = await getAutoUpdater().checkForUpdates();
                // If no update info or version matches current, no update available
                if (!result || !result.updateInfo) {
                    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                        this.mainWindow.webContents.send('update-not-available');
                    }
                    return { success: true, updateAvailable: false };
                }
                // Check if the available version is newer
                const currentVersion = app.getVersion();
                const availableVersion = result.updateInfo.version;
                if (availableVersion === currentVersion) {
                    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                        this.mainWindow.webContents.send('update-not-available');
                    }
                    return { success: true, updateAvailable: false };
                }
                return { success: true, updateAvailable: true, version: availableVersion };
            } catch (error) {
                console.error('Error checking for updates:', error);
                // If error contains "no published versions", treat as up to date
                if (error.message && error.message.includes('no published versions')) {
                    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                        this.mainWindow.webContents.send('update-not-available');
                    }
                    return { success: true, updateAvailable: false };
                }
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('download-update', async () => {
            try {
                const updater = getAutoUpdater();
                console.log('📥 [IPC] download-update handler called');
                console.log('📥 [IPC] autoUpdater state:', {
                    autoDownload: updater.autoDownload,
                    autoInstallOnAppQuit: updater.autoInstallOnAppQuit
                });
                
                // First check if update is available
                console.log('📥 [IPC] Checking for updates first...');
                const checkResult = await updater.checkForUpdates();
                console.log('📥 [IPC] Check result:', checkResult);
                
                if (!checkResult || !checkResult.updateInfo) {
                    console.error('❌ [IPC] No update available');
                    return { success: false, error: 'No update available. Please check for updates first.' };
                }
                
                console.log('📥 [IPC] Update found:', checkResult.updateInfo.version);
                console.log('📥 [IPC] Starting download...');
                
                // Try to download directly - electron-updater should handle the state
                await updater.downloadUpdate();
                console.log('✅ [IPC] Download initiated successfully');
                return { success: true };
            } catch (error) {
                console.error('❌ [IPC] Error downloading update:', error);
                console.error('❌ [IPC] Error stack:', error.stack);
                return { success: false, error: error.message || 'Unknown error' };
            }
        });

        ipcMain.handle('install-update', () => {
            try {
                console.log('📦 Installing update...');
                // Set a flag so we know we're updating
                app.isQuitting = true;
                
                // Use setTimeout to ensure IPC response is sent before quitting
                setTimeout(() => {
                    try {
                        // quitAndInstall params:
                        // isSilent: false = show any needed prompts
                        // isForceRunAfter: true = definitely restart the app
                        getAutoUpdater().quitAndInstall(false, true);
                    } catch (e) {
                        console.error('quitAndInstall failed:', e);
                        // Fallback: manually quit and let Squirrel handle restart
                        app.quit();
                    }
                }, 100);
                
                return { success: true };
            } catch (error) {
                console.error('Error installing update:', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('get-app-version', () => {
            return app.getVersion();
        });

        // Restart the app (used after granting permissions)
        ipcMain.handle('restart-app', () => {
            console.log('🔄 Restarting app...');
            app.relaunch();
            app.exit(0);
        });

        // Google Calendar IPC handlers
        // Authenticate with Google Calendar
        ipcMain.handle('google-calendar-authenticate', async (_event) => {
            try {
                const tokens = await this.googleCalendarIntegration.authenticate();
                return { success: true, authenticated: true };
            } catch (error) {
                console.error('❌ Google Calendar authentication error:', error);
                return { success: false, authenticated: false, error: error.message };
            }
        });

        // Create calendar event
        ipcMain.handle('create-calendar-event', async (_event, eventData) => {
            try {
                const result = await this.googleCalendarIntegration.createEvent(eventData);
                return result;
            } catch (error) {
                console.error('❌ Error creating calendar event:', error);
                return { success: false, error: error.message };
            }
        });

        // Check Google Calendar authentication status
        ipcMain.handle('google-calendar-auth-status', async (_event) => {
            try {
                const isAuthenticated = this.googleCalendarIntegration.isAuthenticated();
                return { authenticated: isAuthenticated };
            } catch (error) {
                return { authenticated: false, error: error.message };
            }
        });

        // Sign out from Google Calendar
        ipcMain.handle('google-calendar-sign-out', async (_event) => {
            try {
                const success = await this.googleCalendarIntegration.signOut();
                return { success, message: success ? 'Signed out from Google Calendar' : 'Failed to sign out' };
            } catch (error) {
                console.error('❌ Google Calendar sign out error:', error);
                return { success: false, error: error.message };
            }
        });

        // List upcoming calendar events
        ipcMain.handle('list-calendar-events', async (_event, maxResults = 10) => {
            try {
                const result = await this.googleCalendarIntegration.listUpcomingEvents(maxResults);
                return result;
            } catch (error) {
                console.error('❌ Error listing calendar events:', error);
                return { success: false, error: error.message };
            }
        });

        // Gmail IPC handlers
        // Authenticate with Gmail
        ipcMain.handle('gmail-authenticate', async (_event) => {
            try {
                const tokens = await this.gmailIntegration.authenticate();
                return { success: true, authenticated: true };
            } catch (error) {
                console.error('❌ Gmail authentication error:', error);
                return { success: false, authenticated: false, error: error.message };
            }
        });

        // Check Gmail authentication status
        ipcMain.handle('gmail-auth-status', async (_event) => {
            try {
                const isAuthenticated = this.gmailIntegration.isAuthenticated();
                return { authenticated: isAuthenticated };
            } catch (error) {
                return { authenticated: false, error: error.message };
            }
        });

        // Search emails
        ipcMain.handle('gmail-search', async (_event, query, maxResults = 10) => {
            try {
                const result = await this.gmailIntegration.searchEmails(query, maxResults);
                return result;
            } catch (error) {
                console.error('❌ Error searching emails:', error);
                return { success: false, error: error.message };
            }
        });

        // Get today's emails
        ipcMain.handle('gmail-todays-emails', async (_event, maxResults = 20) => {
            try {
                const result = await this.gmailIntegration.getTodaysEmails(maxResults);
                return result;
            } catch (error) {
                console.error('❌ Error getting today\'s emails:', error);
                return { success: false, error: error.message };
            }
        });

        // Get important emails
        ipcMain.handle('gmail-important-emails', async (_event, maxResults = 10) => {
            try {
                const result = await this.gmailIntegration.getImportantEmails(maxResults);
                return result;
            } catch (error) {
                console.error('❌ Error getting important emails:', error);
                return { success: false, error: error.message };
            }
        });

        // Get unread emails
        ipcMain.handle('gmail-unread-emails', async (_event, maxResults = 20) => {
            try {
                const result = await this.gmailIntegration.getUnreadEmails(maxResults);
                return result;
            } catch (error) {
                console.error('❌ Error getting unread emails:', error);
                return { success: false, error: error.message };
            }
        });

        // Get recent emails
        ipcMain.handle('gmail-recent-emails', async (_event, maxResults = 10) => {
            try {
                const result = await this.gmailIntegration.getRecentEmails(maxResults);
                return result;
            } catch (error) {
                console.error('❌ Error getting recent emails:', error);
                return { success: false, error: error.message };
            }
        });

        // Sign out from Gmail
        ipcMain.handle('gmail-sign-out', async (_event) => {
            try {
                const success = await this.gmailIntegration.signOut();
                return { success, message: success ? 'Signed out from Gmail' : 'Failed to sign out' };
            } catch (error) {
                console.error('❌ Gmail sign out error:', error);
                return { success: false, error: error.message };
            }
        });

        // Check Google Drive/Sheets auth status (shares tokens with Docs)
        ipcMain.handle('google-drive-auth-status', async (_event) => {
            try {
                const isAuthenticated = this.googleDocsIntegration.isAuthenticated();
                return { authenticated: isAuthenticated };
            } catch (error) {
                return { authenticated: false, error: error.message };
            }
        });

        // Handle getting API keys for renderer process
        ipcMain.handle('get-api-keys', () => {
            try {
                const openaiConfig = this.secureConfig.getOpenAIConfig();
                const exaConfig = this.secureConfig.getExaConfig();
                const claudeConfig = this.secureConfig.getClaudeConfig();
                const perplexityConfig = this.secureConfig.getPerplexityConfig();
                const supabaseConfig = this.secureConfig.getSupabaseConfig();
                
                const perplexityKey = perplexityConfig?.apiKey || process.env.PPLX_API_KEY || '';
                const claudeKey = claudeConfig?.apiKey || process.env.CLAUDE_API_KEY || '';
                const apiProxyUrl = this.secureConfig.getSupabaseApiProxyUrl() || supabaseConfig?.apiProxyUrl || '';
                
                console.log('🔑 Perplexity API key from config:', perplexityConfig?.apiKey ? `${perplexityConfig.apiKey.substring(0, 10)}...` : 'NOT FOUND');
                console.log('🔑 Perplexity API key from env:', process.env.PPLX_API_KEY ? `${process.env.PPLX_API_KEY.substring(0, 10)}...` : 'NOT FOUND');
                console.log('🔑 Final Perplexity key present:', !!perplexityKey && perplexityKey.trim() !== '');
                
                console.log('🔑 Claude API key from config:', claudeConfig?.apiKey ? `${claudeConfig.apiKey.substring(0, 10)}...` : 'NOT FOUND');
                console.log('🔑 Claude API key from env:', process.env.CLAUDE_API_KEY ? `${process.env.CLAUDE_API_KEY.substring(0, 10)}...` : 'NOT FOUND');
                console.log('🔑 Final Claude key present:', !!claudeKey && claudeKey.trim() !== '');
                
                const openrouterConfig = this.secureConfig.getOpenRouterConfig();
                const openrouterKey = openrouterConfig?.apiKey || '';
                console.log('🔑 OpenRouter API key from config:', openrouterConfig?.apiKey ? `${openrouterConfig.apiKey.substring(0, 10)}...` : 'NOT FOUND');
                console.log('🔑 Final OpenRouter key present:', !!openrouterKey && openrouterKey.trim() !== '');
                
                console.log('🔗 API Proxy URL:', apiProxyUrl || 'NOT CONFIGURED (will use direct API calls)');
                
                return {
                    openai: openaiConfig?.apiKey || this.openaiApiKey || '',
                    exa: exaConfig?.apiKey || this.exaApiKey || '',
                    perplexity: perplexityKey,
                    claude: claudeKey,
                    openrouter: openrouterKey,
                    apiProxyUrl: apiProxyUrl,
                    supabaseAnonKey: supabaseConfig?.anonKey || ''
                };
            } catch (error) {
                console.error('Error getting API keys:', error);
                const perplexityKey = process.env.PPLX_API_KEY || '';
                const claudeKey = process.env.CLAUDE_API_KEY || '';
                const openrouterKey = process.env.OPENROUTER_API_KEY || '';
                console.log('🔑 Fallback Perplexity key present:', !!perplexityKey && perplexityKey.trim() !== '');
                console.log('🔑 Fallback Claude key present:', !!claudeKey && claudeKey.trim() !== '');
                console.log('🔑 Fallback OpenRouter key present:', !!openrouterKey && openrouterKey.trim() !== '');
                return {
                    openai: this.openaiApiKey || '',
                    exa: this.exaApiKey || '',
                    perplexity: perplexityKey,
                    claude: claudeKey,
                    openrouter: openrouterKey,
                    apiProxyUrl: '',
                    supabaseAnonKey: ''
                };
            }
        });

        // Handle OpenAI API call via main process (to avoid Electron fetch issues)
        ipcMain.handle('call-openai-api', async (_event, requestPayload, isLowModel = false) => {
            try {
                // Get user email for tracking
                const email = this.currentUserEmail;
                
                // Check user cost limits before making the call
                // Skip limit check for Low model (GPT-5 Mini) - it's free/unlimited
                if (!isLowModel && email && this.supabaseIntegration) {
                    const limitCheck = await this.supabaseIntegration.checkUserLimits(email);
                    if (!limitCheck.allowed) {
                        console.log(`🚫 User ${email} blocked: ${limitCheck.reason}`);
                        return {
                            ok: false,
                            status: 429,
                            statusText: 'Limit Exceeded',
                            data: {
                                error: limitCheck.reason,
                                costUsedDollars: limitCheck.costUsedDollars,
                                costLimitDollars: limitCheck.costLimitDollars,
                                isBlocked: limitCheck.isBlocked
                            }
                        };
                    }
                } else if (isLowModel) {
                    console.log('🆓 Low model (OpenAI) - skipping cost limit check');
                }
                
                const supabaseConfig = this.secureConfig.getSupabaseConfig();
                const SUPABASE_URL = supabaseConfig?.url || 'https://nbmnbgouiammxpkbyaxj.supabase.co';
                const SUPABASE_ANON_KEY = supabaseConfig?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibW5iZ291aWFtbXhwa2J5YXhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI1MjEwODcsImV4cCI6MjA3ODA5NzA4N30.ppFaxEFUyBWjwkgdszbvP2HUdXXKjC0Bu-afCQr0YxE';
                const PROXY_URL = `${SUPABASE_URL}/functions/v1/jarvis-api-proxy`;
                
                console.log('🔒 Main process: Calling OpenAI API via Edge Function');
                console.log('📤 URL:', PROXY_URL);
                
                return new Promise((resolve, reject) => {
                    const parsedUrl = new URL(PROXY_URL);
                    const postData = JSON.stringify({
                        provider: 'openai',
                        endpoint: 'responses',
                        payload: requestPayload
                    });
                    
                    const options = {
                        hostname: parsedUrl.hostname,
                        port: parsedUrl.port || 443,
                        path: parsedUrl.pathname,
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                            'Content-Type': 'application/json',
                            'apikey': SUPABASE_ANON_KEY,
                            'Content-Length': Buffer.byteLength(postData)
                        },
                        rejectUnauthorized: false
                    };
                    
                    const req = https.request(options, (res) => {
                        let data = '';
                        res.on('data', (chunk) => { data += chunk; });
                        res.on('end', async () => {
                            console.log('📥 Main process OpenAI: Response status:', res.statusCode);
                            if (res.statusCode >= 200 && res.statusCode < 300) {
                                try {
                                    const responseData = JSON.parse(data);
                                    console.log('✅ Main process OpenAI: Successfully parsed response');
                                    
                                    // Track token usage if we have email and usage data
                                    // Skip tracking for Low model (GPT-5 Mini) - it's free/unlimited
                                    console.log(`📊 OpenAI tracking check - Email: ${email || 'NOT SET'}, Supabase: ${this.supabaseIntegration ? 'YES' : 'NO'}, Usage in response: ${responseData.usage ? 'YES' : 'NO'}, isLowModel: ${isLowModel}`);
                                    
                                    if (isLowModel) {
                                        console.log('🆓 Low model - skipping cost tracking');
                                    } else if (email && this.supabaseIntegration && responseData.usage) {
                                        console.log(`📊 OpenAI FULL usage object:`, JSON.stringify(responseData.usage, null, 2));
                                        const tokensInput = responseData.usage.input_tokens || responseData.usage.prompt_tokens || 0;
                                        const tokensOutput = responseData.usage.output_tokens || responseData.usage.completion_tokens || 0;
                                        const model = requestPayload.model || 'gpt-4';
                                        
                                        console.log(`📊 OpenAI usage - Input: ${tokensInput}, Output: ${tokensOutput}, Model: ${model}`);
                                        
                                        // Record usage asynchronously (don't wait)
                                        this.supabaseIntegration.recordTokenUsage(
                                            email, 
                                            tokensInput, 
                                            tokensOutput, 
                                            model, 
                                            'openai', 
                                            'chat'
                                        ).then(() => console.log('✅ OpenAI token usage recorded successfully'))
                                        .catch(err => console.error('❌ Failed to record OpenAI token usage:', err));
                                    } else {
                                        console.log('⚠️ OpenAI tracking skipped - missing email, supabase, or usage data');
                                    }
                                    
                                    resolve({ ok: true, status: res.statusCode, statusText: res.statusMessage, data: responseData });
                                } catch (parseError) {
                                    console.error('❌ Main process OpenAI: Failed to parse response:', parseError);
                                    resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: { error: `Failed to parse response: ${parseError.message}` } });
                                }
                            } else {
                                console.error('❌ Main process OpenAI: Error response:', res.statusCode);
                                try {
                                    const errorData = JSON.parse(data);
                                    resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: errorData });
                                } catch {
                                    resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: { error: data.substring(0, 500) } });
                                }
                            }
                        });
                    });
                    req.on('error', (error) => {
                        console.error('❌ Main process OpenAI: Request error:', error);
                        resolve({ ok: false, status: 500, statusText: 'Network Error', data: { error: error.message } });
                    });
                    req.write(postData);
                    req.end();
                });
            } catch (error) {
                console.error('❌ Main process OpenAI: API call failed:', error);
                return { ok: false, status: 500, statusText: 'Internal Error', data: { error: error.message } };
            }
        });

        // Handle OpenRouter API call via main process (for token tracking and limit enforcement)
        ipcMain.handle('call-openrouter-api', async (_event, requestPayload, isLowModel = false) => {
            try {
                // Get user email for tracking
                const email = this.currentUserEmail;
                
                // Check user cost limits before making the call
                // Skip limit check for Low model (GPT-5 Mini) - it's free/unlimited
                if (!isLowModel && email && this.supabaseIntegration) {
                    const limitCheck = await this.supabaseIntegration.checkUserLimits(email);
                    if (!limitCheck.allowed) {
                        console.log(`🚫 User ${email} blocked from OpenRouter: ${limitCheck.reason}`);
                        return {
                            ok: false,
                            status: 429,
                            statusText: 'Limit Exceeded',
                            data: {
                                error: limitCheck.reason,
                                costUsedDollars: limitCheck.costUsedDollars,
                                costLimitDollars: limitCheck.costLimitDollars,
                                isBlocked: limitCheck.isBlocked
                            }
                        };
                    }
                } else if (isLowModel) {
                    console.log('🆓 Low model call - skipping cost limit check');
                }
                
                const openrouterConfig = this.secureConfig.getOpenRouterConfig();
                const OPENROUTER_API_KEY = openrouterConfig?.apiKey || process.env.OPENROUTER_API_KEY;
                
                if (!OPENROUTER_API_KEY) {
                    return { ok: false, status: 401, statusText: 'Unauthorized', data: { error: 'OpenRouter API key not configured' } };
                }
                
                console.log('🔒 Main process: Calling OpenRouter API');
                console.log('📤 Model:', requestPayload.model);
                
                return new Promise((resolve, reject) => {
                    const postData = JSON.stringify(requestPayload);
                    
                    const options = {
                        hostname: 'openrouter.ai',
                        port: 443,
                        path: '/api/v1/chat/completions',
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                            'Content-Type': 'application/json',
                            'HTTP-Referer': 'https://jarvis-ai.app',
                            'X-Title': 'Jarvis AI',
                            'Content-Length': Buffer.byteLength(postData)
                        }
                    };
                    
                    const req = https.request(options, (res) => {
                        let data = '';
                        res.on('data', (chunk) => { data += chunk; });
                        res.on('end', async () => {
                            console.log('📥 Main process OpenRouter: Response status:', res.statusCode);
                            if (res.statusCode >= 200 && res.statusCode < 300) {
                                try {
                                    const responseData = JSON.parse(data);
                                    console.log('✅ Main process OpenRouter: Successfully parsed response');
                                    
                                    // Track token usage if we have email and usage data
                                    // Skip tracking for Low model (GPT-5 Mini) - it's free/unlimited
                                    console.log(`📊 OpenRouter tracking check - Email: ${email || 'NOT SET'}, Usage in response: ${responseData.usage ? 'YES' : 'NO'}, isLowModel: ${isLowModel}`);
                                    
                                    if (isLowModel) {
                                        console.log('🆓 Low model - skipping cost tracking');
                                    } else if (email && this.supabaseIntegration && responseData.usage) {
                                        console.log(`📊 OpenRouter FULL usage object:`, JSON.stringify(responseData.usage, null, 2));
                                        const tokensInput = responseData.usage.prompt_tokens || 0;
                                        const tokensOutput = responseData.usage.completion_tokens || 0;
                                        const model = requestPayload.model || 'openrouter';
                                        // OpenRouter may return cost directly - check for it
                                        const apiCost = responseData.usage.total_cost || responseData.usage.cost || null;
                                        
                                        console.log(`📊 OpenRouter usage - Input: ${tokensInput}, Output: ${tokensOutput}, Model: ${model}, API Cost: ${apiCost || 'not provided'}`);
                                        
                                        // Record usage asynchronously (don't wait)
                                        // Pass API-provided cost if available
                                        this.supabaseIntegration.recordTokenUsage(
                                            email, 
                                            tokensInput, 
                                            tokensOutput, 
                                            model, 
                                            'openrouter', 
                                            'chat',
                                            apiCost  // Pass API cost if available
                                        ).then(() => console.log('✅ OpenRouter usage recorded successfully'))
                                        .catch(err => console.error('❌ Failed to record OpenRouter usage:', err));
                                    } else {
                                        console.log('⚠️ OpenRouter tracking skipped - missing email or usage data');
                                    }
                                    
                                    resolve({ ok: true, status: res.statusCode, statusText: res.statusMessage, data: responseData });
                                } catch (parseError) {
                                    console.error('❌ Main process OpenRouter: Failed to parse response:', parseError);
                                    resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: { error: `Failed to parse response: ${parseError.message}` } });
                                }
                            } else {
                                console.error('❌ Main process OpenRouter: Error response:', res.statusCode);
                                try {
                                    const errorData = JSON.parse(data);
                                    resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: errorData });
                                } catch {
                                    resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: { error: data.substring(0, 500) } });
                                }
                            }
                        });
                    });
                    req.on('error', (error) => {
                        console.error('❌ Main process OpenRouter: Request error:', error);
                        resolve({ ok: false, status: 500, statusText: 'Network Error', data: { error: error.message } });
                    });
                    req.write(postData);
                    req.end();
                });
            } catch (error) {
                console.error('❌ Main process OpenRouter: API call failed:', error);
                return { ok: false, status: 500, statusText: 'Internal Error', data: { error: error.message } };
            }
        });

        // Handle Perplexity API call via main process (with token tracking and limit enforcement)
        ipcMain.handle('call-perplexity-api', async (_event, requestPayload, userEmail = null) => {
            try {
                // Get user email for tracking
                const email = userEmail || this.currentUserEmail;
                
                // Check user cost limits before making the call
                if (email && this.supabaseIntegration) {
                    const limitCheck = await this.supabaseIntegration.checkUserLimits(email);
                    if (!limitCheck.allowed) {
                        console.log(`🚫 User ${email} blocked from Perplexity: ${limitCheck.reason}`);
                        return {
                            ok: false,
                            status: 429,
                            statusText: 'Limit Exceeded',
                            data: {
                                error: limitCheck.reason,
                                costUsedDollars: limitCheck.costUsedDollars,
                                costLimitDollars: limitCheck.costLimitDollars,
                                isBlocked: limitCheck.isBlocked
                            }
                        };
                    }
                }
                
                const supabaseConfig = this.secureConfig.getSupabaseConfig();
                const SUPABASE_URL = supabaseConfig?.url || 'https://nbmnbgouiammxpkbyaxj.supabase.co';
                const SUPABASE_ANON_KEY = supabaseConfig?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibW5iZ291aWFtbXhwa2J5YXhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI1MjEwODcsImV4cCI6MjA3ODA5NzA4N30.ppFaxEFUyBWjwkgdszbvP2HUdXXKjC0Bu-afCQr0YxE';
                const PROXY_URL = `${SUPABASE_URL}/functions/v1/jarvis-api-proxy`;
                
                console.log('🔒 Main process: Calling Perplexity API via Edge Function');
                console.log('📤 URL:', PROXY_URL);
                console.log('📤 Payload:', JSON.stringify({ provider: 'perplexity', payload: requestPayload }, null, 2));
                
                // Use Node.js https module (more reliable than fetch in older Node versions)
                return new Promise((resolve, reject) => {
                    const parsedUrl = new URL(PROXY_URL);
                    const postData = JSON.stringify({
                        provider: 'perplexity',
                        payload: requestPayload
                    });
                    
                    const options = {
                        hostname: parsedUrl.hostname,
                        port: parsedUrl.port || 443,
                        path: parsedUrl.pathname,
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                            'Content-Type': 'application/json',
                            'apikey': SUPABASE_ANON_KEY,
                            'Content-Length': Buffer.byteLength(postData)
                        },
                        rejectUnauthorized: false // Allow self-signed certificates (development)
                    };
                    
                    const req = https.request(options, (res) => {
                        let data = '';
                        
                        res.on('data', (chunk) => {
                            data += chunk;
                        });
                        
                        res.on('end', async () => {
                            console.log('📥 Main process Perplexity: Response status:', res.statusCode);
                            console.log('📥 Main process Perplexity: Response data length:', data.length);
                            
                            if (res.statusCode >= 200 && res.statusCode < 300) {
                                try {
                                    const responseData = JSON.parse(data);
                                    console.log('✅ Main process Perplexity: Successfully parsed response');
                                    
                                    // Track token usage if we have email and usage data
                                    if (email && this.supabaseIntegration && responseData.usage) {
                                        const tokensInput = responseData.usage.prompt_tokens || 0;
                                        const tokensOutput = responseData.usage.completion_tokens || 0;
                                        const model = requestPayload.model || 'perplexity';
                                        
                                        console.log(`📊 Perplexity usage - Input: ${tokensInput}, Output: ${tokensOutput}`);
                                        
                                        // Record usage asynchronously (don't wait)
                                        this.supabaseIntegration.recordTokenUsage(
                                            email, 
                                            tokensInput, 
                                            tokensOutput, 
                                            model, 
                                            'perplexity', 
                                            'web_search'
                                        ).catch(err => console.error('Failed to record Perplexity token usage:', err));
                                    }
                                    
                                    resolve({
                                        ok: true,
                                        status: res.statusCode,
                                        statusText: res.statusMessage,
                                        data: responseData
                                    });
                                } catch (parseError) {
                                    console.error('❌ Main process Perplexity: Failed to parse response:', parseError);
                                    console.error('❌ Main process Perplexity: Raw response:', data.substring(0, 500));
                                    resolve({
                                        ok: false,
                                        status: res.statusCode,
                                        statusText: res.statusMessage,
                                        data: { error: `Failed to parse response: ${parseError.message}`, raw: data.substring(0, 200) }
                                    });
                                }
                            } else {
                                // Error response
                                console.error('❌ Main process Perplexity: Error response:', res.statusCode, data.substring(0, 500));
                                try {
                                    const errorData = JSON.parse(data);
                                    resolve({
                                        ok: false,
                                        status: res.statusCode,
                                        statusText: res.statusMessage,
                                        data: errorData
                                    });
                                } catch {
                                    resolve({
                                        ok: false,
                                        status: res.statusCode,
                                        statusText: res.statusMessage,
                                        data: { error: data.substring(0, 500) }
                                    });
                                }
                            }
                        });
                    });
                    
                    req.on('error', (error) => {
                        console.error('❌ Main process Perplexity: Request error:', error);
                        resolve({
                            ok: false,
                            status: 500,
                            statusText: 'Network Error',
                            data: { error: error.message }
                        });
                    });
                    
                    req.write(postData);
                    req.end();
                });
            } catch (error) {
                console.error('❌ Main process Perplexity: API call failed:', error);
                return {
                    ok: false,
                    status: 500,
                    statusText: 'Internal Error',
                    data: { error: error.message }
                };
            }
        });

        // Handle Claude API call via main process (with token tracking and limit enforcement)
        ipcMain.handle('call-claude-api', async (_event, requestPayload, userEmail = null) => {
            try {
                // Get user email for tracking
                const email = userEmail || this.currentUserEmail;
                
                // Check user cost limits before making the call
                if (email && this.supabaseIntegration) {
                    const limitCheck = await this.supabaseIntegration.checkUserLimits(email);
                    if (!limitCheck.allowed) {
                        console.log(`🚫 User ${email} blocked from Claude: ${limitCheck.reason}`);
                        return {
                            ok: false,
                            status: 429,
                            statusText: 'Limit Exceeded',
                            data: {
                                error: limitCheck.reason,
                                costUsedDollars: limitCheck.costUsedDollars,
                                costLimitDollars: limitCheck.costLimitDollars,
                                isBlocked: limitCheck.isBlocked
                            }
                        };
                    }
                }
                
                // Try direct API key first, then fall back to Supabase proxy
                const claudeConfig = this.secureConfig.getClaudeConfig ? this.secureConfig.getClaudeConfig() : null;
                const CLAUDE_API_KEY = claudeConfig?.apiKey || process.env.CLAUDE_API_KEY;
                
                if (CLAUDE_API_KEY && CLAUDE_API_KEY.trim() !== '') {
                    // Direct Claude API call
                    console.log('🔒 Main process: Calling Claude API directly');
                    
                    return new Promise((resolve, reject) => {
                        const postData = JSON.stringify(requestPayload);
                        
                        const options = {
                            hostname: 'api.anthropic.com',
                            port: 443,
                            path: '/v1/messages',
                            method: 'POST',
                            headers: {
                                'x-api-key': CLAUDE_API_KEY,
                                'anthropic-version': '2023-06-01',
                                'Content-Type': 'application/json',
                                'Content-Length': Buffer.byteLength(postData)
                            }
                        };
                        
                        const req = https.request(options, (res) => {
                            let data = '';
                            res.on('data', (chunk) => { data += chunk; });
                            res.on('end', async () => {
                                console.log('📥 Main process Claude: Response status:', res.statusCode);
                                if (res.statusCode >= 200 && res.statusCode < 300) {
                                    try {
                                        const responseData = JSON.parse(data);
                                        console.log('✅ Main process Claude: Successfully parsed response');
                                        
                                        // Track token usage if we have email and usage data
                                        if (email && this.supabaseIntegration && responseData.usage) {
                                            const tokensInput = responseData.usage.input_tokens || 0;
                                            const tokensOutput = responseData.usage.output_tokens || 0;
                                            const model = requestPayload.model || 'claude';
                                            
                                            console.log(`📊 Claude usage - Input: ${tokensInput}, Output: ${tokensOutput}`);
                                            
                                            // Record usage asynchronously (don't wait)
                                            this.supabaseIntegration.recordTokenUsage(
                                                email, 
                                                tokensInput, 
                                                tokensOutput, 
                                                model, 
                                                'claude', 
                                                'chat'
                                            ).catch(err => console.error('Failed to record Claude token usage:', err));
                                        }
                                        
                                        resolve({ ok: true, status: res.statusCode, statusText: res.statusMessage, data: responseData });
                                    } catch (parseError) {
                                        console.error('❌ Main process Claude: Failed to parse response:', parseError);
                                        resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: { error: `Failed to parse response: ${parseError.message}` } });
                                    }
                                } else {
                                    console.error('❌ Main process Claude: Error response:', res.statusCode);
                                    try {
                                        const errorData = JSON.parse(data);
                                        resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: errorData });
                                    } catch {
                                        resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: { error: data.substring(0, 500) } });
                                    }
                                }
                            });
                        });
                        req.on('error', (error) => {
                            console.error('❌ Main process Claude: Request error:', error);
                            resolve({ ok: false, status: 500, statusText: 'Network Error', data: { error: error.message } });
                        });
                        req.write(postData);
                        req.end();
                    });
                } else {
                    // Fall back to Supabase proxy
                    const supabaseConfig = this.secureConfig.getSupabaseConfig();
                    const SUPABASE_URL = supabaseConfig?.url || 'https://nbmnbgouiammxpkbyaxj.supabase.co';
                    const SUPABASE_ANON_KEY = supabaseConfig?.anonKey;
                    
                    if (!SUPABASE_ANON_KEY) {
                        return { ok: false, status: 401, statusText: 'Unauthorized', data: { error: 'Neither Claude API key nor Supabase proxy configured' } };
                    }
                    
                    const PROXY_URL = `${SUPABASE_URL}/functions/v1/jarvis-api-proxy`;
                    console.log('🔒 Main process: Calling Claude API via Supabase proxy');
                    
                    return new Promise((resolve, reject) => {
                        const parsedUrl = new URL(PROXY_URL);
                        const postData = JSON.stringify({
                            provider: 'claude',
                            payload: requestPayload
                        });
                        
                        const options = {
                            hostname: parsedUrl.hostname,
                            port: parsedUrl.port || 443,
                            path: parsedUrl.pathname,
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                                'Content-Type': 'application/json',
                                'apikey': SUPABASE_ANON_KEY,
                                'Content-Length': Buffer.byteLength(postData)
                            }
                        };
                        
                        const req = https.request(options, (res) => {
                            let data = '';
                            res.on('data', (chunk) => { data += chunk; });
                            res.on('end', async () => {
                                console.log('📥 Main process Claude (proxy): Response status:', res.statusCode);
                                if (res.statusCode >= 200 && res.statusCode < 300) {
                                    try {
                                        const responseData = JSON.parse(data);
                                        console.log('✅ Main process Claude (proxy): Successfully parsed response');
                                        
                                        // Track token usage if we have email and usage data
                                        if (email && this.supabaseIntegration && responseData.usage) {
                                            const tokensInput = responseData.usage.input_tokens || 0;
                                            const tokensOutput = responseData.usage.output_tokens || 0;
                                            const model = requestPayload.model || 'claude';
                                            
                                            console.log(`📊 Claude (proxy) usage - Input: ${tokensInput}, Output: ${tokensOutput}`);
                                            
                                            this.supabaseIntegration.recordTokenUsage(
                                                email, 
                                                tokensInput, 
                                                tokensOutput, 
                                                model, 
                                                'claude', 
                                                'chat'
                                            ).catch(err => console.error('Failed to record Claude token usage:', err));
                                        }
                                        
                                        resolve({ ok: true, status: res.statusCode, statusText: res.statusMessage, data: responseData });
                                    } catch (parseError) {
                                        resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: { error: `Failed to parse response: ${parseError.message}` } });
                                    }
                                } else {
                                    try {
                                        const errorData = JSON.parse(data);
                                        resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: errorData });
                                    } catch {
                                        resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: { error: data.substring(0, 500) } });
                                    }
                                }
                            });
                        });
                        req.on('error', (error) => {
                            resolve({ ok: false, status: 500, statusText: 'Network Error', data: { error: error.message } });
                        });
                        req.write(postData);
                        req.end();
                    });
                }
            } catch (error) {
                console.error('❌ Main process Claude: API call failed:', error);
                return { ok: false, status: 500, statusText: 'Internal Error', data: { error: error.message } };
            }
        });

        // Handle manual subscription check (Simple API Call)
        ipcMain.handle('check-subscription-manual', async (event, userEmail) => {
            try {
                // Use Supabase to check subscription
                const subscriptionResult = await this.supabaseIntegration.checkSubscriptionByEmail(userEmail);
                
                if (subscriptionResult.hasSubscription && subscriptionResult.subscription) {
                    const subscriptionData = {
                        email: userEmail,
                        subscriptionId: subscriptionResult.subscription.id,
                        status: subscriptionResult.subscription.status,
                        nextBilling: subscriptionResult.subscription.currentPeriodEnd,
                        features: ['unlimited_messages', 'screenshot_analysis', 'voice_activation'],
                        createdAt: new Date().toISOString()
                    };
                    
                    await this.storeSubscriptionData(subscriptionData);
                    
                    return {
                        hasActiveSubscription: true,
                        subscriptionData: subscriptionData
                    };
                } else {
                    return {
                        hasActiveSubscription: false,
                        error: subscriptionResult.error || 'No active subscription found'
                    };
                }
            } catch (error) {
                console.error('Error checking subscription via API:', error);
                return {
                    hasActiveSubscription: false,
                    error: error.message
                };
            }
        });

        // Handle sign-in user
        ipcMain.handle('sign-in-user', async (_event, email, password) => {
            try {
                if (!email || !email.includes('@')) {
                    return {
                        success: false,
                        error: 'Invalid email address'
                    };
                }

                console.log('🔐 Signing in user:', email);

                // Check subscription in Supabase
                if (!this.supabaseIntegration) {
                    return {
                        success: false,
                        error: 'Subscription service not available'
                    };
                }

                const subscriptionResult = await this.supabaseIntegration.checkSubscriptionByEmail(email);

                if (subscriptionResult.hasSubscription && subscriptionResult.subscription) {
                    // Check if user has a password set
                    const passwordResult = await this.supabaseIntegration.hasPassword(email);
                    
                    if (passwordResult.hasPassword) {
                        // User has password, verify it
                        if (!password) {
                            return {
                                success: true,
                                hasSubscription: true,
                                requiresPassword: true,
                                error: 'Password required'
                            };
                        }
                        
                        const verifyResult = await this.supabaseIntegration.verifyPassword(email, password);
                        if (!verifyResult.success) {
                            return {
                                success: false,
                                error: verifyResult.error || 'Incorrect password'
                            };
                        }
                    }
                    
                    // User has active subscription and password verified (or no password set)
                    const subscriptionData = {
                        email: email,
                        subscriptionId: subscriptionResult.subscription.id,
                        status: subscriptionResult.subscription.status,
                        nextBilling: subscriptionResult.subscription.currentPeriodEnd,
                        features: ['unlimited_messages', 'screenshot_analysis', 'voice_activation'],
                        createdAt: new Date().toISOString()
                    };

                    // Store subscription data locally
                    await this.storeSubscriptionData(subscriptionData);
                    
                    // Track current user email for token usage tracking
                    this.currentUserEmail = email;
                    console.log(`📧 Token tracking: User email set to ${email} (sign-in)`);

                    console.log('✅ User signed in successfully with active subscription');
                    return {
                        success: true,
                        hasSubscription: true,
                        subscriptionData: subscriptionData,
                        hasPassword: passwordResult.hasPassword
                    };
                } else {
                    // No active subscription found
                    console.log('ℹ️ No active subscription found for email:', email);
                    return {
                        success: true,
                        hasSubscription: false,
                        error: 'No active subscription found for this email'
                    };
                }
            } catch (error) {
                console.error('Error signing in user:', error);
                return {
                    success: false,
                    error: error.message || 'Failed to sign in'
                };
            }
        });

        // Handle sign-out user
        ipcMain.handle('sign-out-user', async () => {
            try {
                console.log('🔐 Signing out user...');

                const fs = require('fs');
                const path = require('path');
                const userDataPath = app.getPath('userData');
                
                // Remove user email file
                const userFile = path.join(userDataPath, 'jarvis_user.json');
                if (fs.existsSync(userFile)) {
                    fs.unlinkSync(userFile);
                    console.log('✅ Removed user email file');
                }

                // Remove subscription status file
                const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
                if (fs.existsSync(subscriptionFile)) {
                    fs.unlinkSync(subscriptionFile);
                    console.log('✅ Removed subscription status file');
                }

                // Notify main window if it exists
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.webContents.send('user-signed-out');
                }

                // Notify account window if it exists
                if (this.accountWindow && !this.accountWindow.isDestroyed()) {
                    this.accountWindow.webContents.send('subscription-status-changed', { status: 'free' });
                }

                console.log('✅ User signed out successfully');
                return {
                    success: true
                };
            } catch (error) {
                console.error('Error signing out user:', error);
                return {
                    success: false,
                    error: error.message || 'Failed to sign out'
                };
            }
        });

        // Handle setting password
        ipcMain.handle('set-user-password', async (_event, email, password) => {
            try {
                if (!this.supabaseIntegration) {
                    return {
                        success: false,
                        error: 'Service not available'
                    };
                }
                return await this.supabaseIntegration.setPassword(email, password);
            } catch (error) {
                console.error('Error setting password:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // Handle verifying password
        ipcMain.handle('verify-user-password', async (_event, email, password) => {
            try {
                if (!this.supabaseIntegration) {
                    return {
                        success: false,
                        error: 'Service not available'
                    };
                }
                return await this.supabaseIntegration.verifyPassword(email, password);
            } catch (error) {
                console.error('Error verifying password:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // Handle checking if user has password
        ipcMain.handle('check-user-has-password', async (_event, email) => {
            try {
                if (!this.supabaseIntegration) {
                    return {
                        success: false,
                        hasPassword: false,
                        error: 'Service not available'
                    };
                }
                return await this.supabaseIntegration.hasPassword(email);
            } catch (error) {
                console.error('Error checking password:', error);
                return {
                    success: false,
                    hasPassword: false,
                    error: error.message
                };
            }
        });

        // Handle sending password reset email
        ipcMain.handle('send-password-reset-email', async (_event, email) => {
            try {
                if (!this.supabaseIntegration) {
                    return {
                        success: false,
                        error: 'Service not available'
                    };
                }

                // Generate reset token
                const tokenResult = await this.supabaseIntegration.generatePasswordResetToken(email);
                if (!tokenResult.success) {
                    return tokenResult;
                }

                // Send email with Resend
                const resendConfig = this.secureConfig.getResendConfig();
                if (!resendConfig.apiKey) {
                    return {
                        success: false,
                        error: 'Email service not configured'
                    };
                }

                const axios = require('axios');
                const response = await axios.post('https://api.resend.com/emails', {
                    from: resendConfig.fromEmail,
                    to: email,
                    subject: 'Jarvis - Password Reset Code',
                    html: `
                        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
                            <div style="text-align: center; margin-bottom: 30px;">
                                <h1 style="color: #6366f1; margin: 0; font-size: 28px;">Jarvis</h1>
                            </div>
                            <div style="background: #1a1a1a; border-radius: 16px; padding: 32px; color: #ffffff;">
                                <h2 style="margin: 0 0 16px 0; font-size: 20px; color: #ffffff;">Password Reset</h2>
                                <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                                    You requested to reset your password. Use the code below to set a new password:
                                </p>
                                <div style="background: #2a2a2a; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
                                    <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #6366f1;">${tokenResult.resetCode}</span>
                                </div>
                                <p style="color: #666666; font-size: 12px; margin: 0;">
                                    This code expires in 15 minutes. If you didn't request this, you can ignore this email.
                                </p>
                            </div>
                            <p style="text-align: center; color: #666666; font-size: 12px; margin-top: 24px;">
                                © ${new Date().getFullYear()} Jarvis AI Assistant
                            </p>
                        </div>
                    `
                }, {
                    headers: {
                        'Authorization': `Bearer ${resendConfig.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                });

                console.log('✅ Password reset email sent to:', email);
                return {
                    success: true
                };
            } catch (error) {
                console.error('Error sending password reset email:', error.response?.data || error.message);
                return {
                    success: false,
                    error: error.response?.data?.message || error.message || 'Failed to send email'
                };
            }
        });

        // Handle verifying password reset code
        ipcMain.handle('verify-password-reset-code', async (_event, email, code) => {
            try {
                if (!this.supabaseIntegration) {
                    return {
                        success: false,
                        error: 'Service not available'
                    };
                }
                return await this.supabaseIntegration.verifyPasswordResetToken(email, code);
            } catch (error) {
                console.error('Error verifying reset code:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // Handle resetting password with code
        ipcMain.handle('reset-password-with-code', async (_event, email, code, newPassword) => {
            try {
                if (!this.supabaseIntegration) {
                    return {
                        success: false,
                        error: 'Service not available'
                    };
                }
                return await this.supabaseIntegration.resetPasswordWithToken(email, code, newPassword);
            } catch (error) {
                console.error('Error resetting password:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // Handle opening password reset page in browser
        ipcMain.handle('open-password-reset-page', async (_event, email) => {
            try {
                const { shell } = require('electron');
                
                // Open account page with forgot password flow in browser
                let url = 'https://yesjarvis.com/account/#forgot';
                if (email) {
                    url = `https://yesjarvis.com/account/?email=${encodeURIComponent(email)}#forgot`;
                }
                
                await shell.openExternal(url);
                return { success: true };
            } catch (error) {
                console.error('Error opening password reset page:', error);
                return {
                    success: false,
                    error: error.message
                };
            }
        });

        // Handle cancel subscription - redirect to Polar customer portal
        ipcMain.handle('cancel-subscription', async () => {
            try {
                // Read the current subscription data to get the customer email
                const fs = require('fs');
                const path = require('path');
                const userDataPath = app.getPath('userData');
                const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
                
                // Use the organization-specific customer portal URL
                // The correct URL format is: https://polar.sh/jarvis-ai/portal/request?id=[request-id]&email=[email]
                let customerPortalUrl = 'https://polar.sh/jarvis-ai/portal/request?id=27efef68-7002-456c-849e-c6a69b72100a';
                
                if (fs.existsSync(subscriptionFile)) {
                    try {
                        const subscriptionData = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
                        if (subscriptionData.email) {
                            // Add email parameter to the correct portal URL
                            customerPortalUrl = `https://polar.sh/jarvis-ai/portal/request?id=27efef68-7002-456c-849e-c6a69b72100a&${encodeURIComponent(subscriptionData.email)}`;
                        }
                    } catch (error) {
                    }
                }
                
                // Open Polar's customer portal where users can manage their subscription
                const { shell } = require('electron');
                await shell.openExternal(customerPortalUrl);
                
                return { success: true, message: 'Opened Polar customer portal' };
            } catch (error) {
                console.error('Error opening Polar portal:', error);
                return { success: false, error: error.message };
            }
        });


        // Handle clear subscription data
        ipcMain.handle('clear-subscription-data', async () => {
            try {
                const fs = require('fs');
                const path = require('path');
                
                const userDataPath = app.getPath('userData');
                const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
                
                // Delete the subscription file
                if (fs.existsSync(subscriptionFile)) {
                    fs.unlinkSync(subscriptionFile);
                }
                
                return { success: true, message: 'Subscription data cleared' };
            } catch (error) {
                console.error('Error clearing subscription data:', error);
                return { success: false, error: error.message };
            }
        });

        // Handle manual subscription validation trigger
        ipcMain.handle('trigger-subscription-validation', async () => {
            try {
                const fs = require('fs');
                const path = require('path');
                
                const userDataPath = app.getPath('userData');
                const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
                
                if (!fs.existsSync(subscriptionFile)) {
                    return { success: false, message: 'No subscription file found' };
                }
                
                const localData = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
                
                const isValid = await this.validateSubscriptionWithPolar(localData);
                
                if (!isValid) {
                    // Remove local subscription data
                    fs.unlinkSync(subscriptionFile);
                    
                    // Notify the main window if it's open
                    if (this.mainWindow) {
                        this.mainWindow.webContents.send('subscription-cancelled');
                    }
                    
                    // If the main window is visible, show the paywall
                    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                        this.mainWindow.webContents.send('show-paywall');
                    }
                    
                    // Also notify any open settings windows
                    if (this.accountWindow && !this.accountWindow.isDestroyed()) {
                        this.accountWindow.webContents.send('subscription-status-changed', { status: 'free' });
                    }
                    
                    return { success: true, message: 'Subscription cancelled and access removed' };
                } else {
                    return { success: true, message: 'Subscription is still active' };
                }
            } catch (error) {
                console.error('Error in manual subscription validation:', error);
                return { success: false, error: error.message };
            }
        });


        // Handle immediate subscription check for premium features
        ipcMain.handle('check-subscription-before-premium-action', async () => {
            try {
                // Get user email
                const userEmail = this.getUserEmail();
                
                if (!userEmail) {
                    return { hasActiveSubscription: false, shouldShowPaywall: true };
                }
                
                // Check Supabase for subscription (includes expiration date check)
                const subscriptionResult = await this.supabaseIntegration.checkSubscriptionByEmail(userEmail);
                
                if (subscriptionResult.hasSubscription && subscriptionResult.subscription) {
                    return { hasActiveSubscription: true, shouldShowPaywall: false };
                } else {
                    // No active subscription - remove local file if it exists
                    const fs = require('fs');
                    const path = require('path');
                    const userDataPath = app.getPath('userData');
                    const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
                    if (fs.existsSync(subscriptionFile)) {
                        fs.unlinkSync(subscriptionFile);
                    }
                    return { hasActiveSubscription: false, shouldShowPaywall: true };
                }
            } catch (error) {
                console.error('Error checking subscription before premium action:', error);
                return { hasActiveSubscription: false, shouldShowPaywall: true };
            }
        });

        // Handle subscription validation with Polar API
        ipcMain.handle('validate-subscription-status', async () => {
            try {
                const fs = require('fs');
                const path = require('path');
                
                const userDataPath = app.getPath('userData');
                
                // TEMPORARY: Force free mode for testing
                const testModeFile = path.join(userDataPath, 'TEST_MODE_FREE_USER');
                if (fs.existsSync(testModeFile)) {
                    console.log('🧪 TEST MODE: Skipping subscription validation');
                    return { 
                        hasActiveSubscription: false, 
                        subscriptionData: null,
                        status: 'free'
                    };
                }
                
                const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
                
                if (!fs.existsSync(subscriptionFile)) {
                    return { 
                        hasActiveSubscription: false, 
                        subscriptionData: null,
                        status: 'free'
                    };
                }
                
                const localData = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
                
                // Check with Polar API if subscription is still active
                const isValid = await this.validateSubscriptionWithPolar(localData);
                
                if (!isValid) {
                    // Remove local subscription data
                    fs.unlinkSync(subscriptionFile);
                    return { 
                        hasActiveSubscription: false, 
                        subscriptionData: null,
                        status: 'free'
                    };
                }
                return { 
                    hasActiveSubscription: true, 
                    subscriptionData: localData,
                    status: 'premium'
                };
                
            } catch (error) {
                console.error('Error validating subscription:', error);
                return { 
                    hasActiveSubscription: false, 
                    subscriptionData: null,
                    status: 'free'
                };
            }
        });

        // Handle creating checkout session
        ipcMain.handle('create-checkout-session', async () => {
            try {
                // Get user email (optional - user can enter it during checkout)
                const userEmail = this.getUserEmail();
                
                // Get product ID from config
                const polarConfig = this.secureConfig.getPolarConfig();
                const productId = polarConfig?.productId || 'd6f0145b-067a-4c7b-8e48-7f3c78e8a489';
                
                // Use Polar integration to create checkout session
                // Email is optional - user can enter it on Polar's checkout page
                const checkoutResult = await this.polarIntegration.createCheckoutSession(productId, userEmail || null);
                
                if (!checkoutResult.success) {
                    throw new Error(checkoutResult.error || 'Failed to create checkout session');
                }
                
                shell.openExternal(checkoutResult.checkoutUrl);
                
                return { success: true, checkoutUrl: checkoutResult.checkoutUrl };
            } catch (error) {
                console.error('❌ Error creating checkout session:', error);
                return { success: false, error: error.message };
            }
        });

        // Handle creating checkout session for adding credits
        ipcMain.handle('create-credits-checkout', async (event, productId) => {
            try {
                console.log('🛒 Creating credits checkout for product:', productId);
                
                // Get user email (optional - user can enter it during checkout)
                const userEmail = this.getUserEmail();
                
                // Use Polar integration to create checkout session
                const checkoutResult = await this.polarIntegration.createCheckoutSession(productId, userEmail || null);
                
                if (!checkoutResult.success) {
                    throw new Error(checkoutResult.error || 'Failed to create checkout session');
                }
                
                shell.openExternal(checkoutResult.checkoutUrl);
                
                return { success: true, checkoutUrl: checkoutResult.checkoutUrl };
            } catch (error) {
                console.error('❌ Error creating credits checkout:', error);
                return { success: false, error: error.message };
            }
        });

        // Handle checking subscription status
        // NOTE: This only reads local file - does NOT validate with API
        // Validation happens via webhooks (immediate) and periodic checks (daily)
        ipcMain.removeHandler('check-subscription-status');
        ipcMain.handle('check-subscription-status', async () => {
            try {
                // Get user email
                const userEmail = this.getUserEmail();
                
                if (!userEmail) {
                    console.log('No user email found, returning free status');
                    return {
                        status: 'free',
                        hasActiveSubscription: false,
                        subscriptionData: null
                    };
                }
                
                // Check Supabase for subscription (this includes expiration date check)
                const subscriptionResult = await this.supabaseIntegration.checkSubscriptionByEmail(userEmail);
                
                if (subscriptionResult.hasSubscription && subscriptionResult.subscription) {
                    const subscriptionData = {
                        email: userEmail,
                        subscriptionId: subscriptionResult.subscription.id,
                        status: subscriptionResult.subscription.status,
                        nextBilling: subscriptionResult.subscription.currentPeriodEnd,
                        features: ['unlimited_messages', 'screenshot_analysis', 'voice_activation'],
                        createdAt: new Date().toISOString()
                    };
                    
                    // Store locally for faster access (but Supabase is source of truth)
                    await this.storeSubscriptionData(subscriptionData);
                    
                    return {
                        status: 'premium',
                        hasActiveSubscription: true,
                        subscriptionData: subscriptionData
                    };
                } else {
                    // No active subscription in Supabase - remove local file if it exists
                    const fs = require('fs');
                    const path = require('path');
                    const userDataPath = app.getPath('userData');
                    const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
                    if (fs.existsSync(subscriptionFile)) {
                        fs.unlinkSync(subscriptionFile);
                        console.log('Removed local subscription file - no active subscription in Supabase');
                    }
                    
                    return {
                        status: 'free',
                        hasActiveSubscription: false,
                        subscriptionData: null
                    };
                }
            } catch (error) {
                console.error('Error checking subscription status:', error);
                return {
                    status: 'free',
                    hasActiveSubscription: false,
                    subscriptionData: null
                };
            }
        });
    }

    // Helper method to check subscription status
    async checkSubscriptionStatus() {
        try {
            const fs = require('fs');
            const path = require('path');
            
            // Use the same path as storeSubscriptionData - user's data directory
            const userDataPath = app.getPath('userData');
            const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
            
            if (fs.existsSync(subscriptionFile)) {
                const subscriptionData = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
                return {
                    status: 'premium',
                    hasActiveSubscription: true,
                    subscriptionData: subscriptionData
                };
            } else {
                return {
                    status: 'free',
                    hasActiveSubscription: false,
                    subscriptionData: null
                };
            }
        } catch (error) {
            console.error('Error checking subscription status:', error);
            return {
                status: 'free',
                hasActiveSubscription: false,
                subscriptionData: null
            };
        }
    }

    // Validate subscription with Polar API
    async validateSubscriptionWithPolar(localData) {
        try {
            if (!localData || !localData.email) {
                return false;
            }
            
            // Add retry logic for API calls with exponential backoff
            let customer = null;
            let retryCount = 0;
            const maxRetries = 3; // Increased retries
            let lastError = null;
            
            // Use Supabase to check subscription
            let subscriptionResult = null;
            retryCount = 0;
            lastError = null;
            
            while (retryCount <= maxRetries) {
                try {
                    subscriptionResult = await this.supabaseIntegration.checkSubscriptionByEmail(localData.email);
                    break;
                } catch (error) {
                    lastError = error;
                    retryCount++;
                    if (retryCount > maxRetries) {
                        console.error('❌ Subscription check failed after all retries');
                        break; // Don't throw, just break and handle below
                    }
                    const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
            
            // If we got an error during subscription check, be lenient
            if (lastError) {
                return true;
            }
            
            if (subscriptionResult && subscriptionResult.hasSubscription) {
                return true;
            } else {
                return false;
            }
            
        } catch (error) {
            console.error('Error validating subscription with Polar:', error);
            return true;
        }
    }

    // Start periodic subscription validation
    startSubscriptionValidation() {
        // Only validate once per day instead of every 10 minutes
        // We rely on webhooks for immediate cancellation updates
        setInterval(async () => {
            this.performSubscriptionValidation();
        }, 24 * 60 * 60 * 1000); // 24 hours - once per day
    }

    // Perform subscription validation
    // NOTE: This is only called once per day. We rely primarily on webhooks for cancellations.
    async performSubscriptionValidation() {
        try {
            const fs = require('fs');
            const path = require('path');
            
            const userDataPath = app.getPath('userData');
            const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
            
            if (!fs.existsSync(subscriptionFile)) {
                return;
            }
            
            const localData = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
            
            // Only validate subscriptions older than 24 hours to avoid false cancellations
            const minAgeForValidation = 24 * 60 * 60 * 1000; // 24 hours
            const subscriptionAge = localData.createdAt 
                ? Date.now() - new Date(localData.createdAt).getTime() 
                : Infinity;
            
            if (subscriptionAge < minAgeForValidation) {
                return;
            }
            
            const isValid = await this.validateSubscriptionWithPolar(localData);
            
            if (!isValid) {
                // Remove local subscription data
                fs.unlinkSync(subscriptionFile);
                
                // Notify the main window if it's open
                if (this.mainWindow) {
                    this.mainWindow.webContents.send('subscription-cancelled');
                }
                
                // If the main window is visible, show the paywall
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.webContents.send('show-paywall');
                }
                
                // Also notify any open settings windows
                if (this.accountWindow && !this.accountWindow.isDestroyed()) {
                    this.accountWindow.webContents.send('subscription-status-changed', { status: 'free' });
                }
            }
        } catch (error) {
            console.error('Error in daily subscription validation:', error);
            // Don't cancel on API errors
        }
    }

    // Helper method to force fullscreen visibility - can be called from anywhere
    forceFullscreenVisibility() {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
        
        // Only apply if overlay is marked as visible
        if (!this.isOverlayVisible) return;
        
        // Skip if account or password reset window is focused - don't interfere with them
        if (this.accountWindow && !this.accountWindow.isDestroyed() && this.accountWindow.isFocused()) {
            return;
        }
        if (this.passwordResetWindow && !this.passwordResetWindow.isDestroyed() && this.passwordResetWindow.isFocused()) {
            return;
        }
        
        // Ensure window is visible first
        if (!this.mainWindow.isVisible()) {
            this.mainWindow.show();
        }
        
        try {
            // CRITICAL: Must set these in order
            try {
                this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
            } catch (_) {
                this.mainWindow.setVisibleOnAllWorkspaces(true);
            }
            
            // CRITICAL: Use screen-saver level for maximum fullscreen visibility (highest level = 1000)
            // This is the key to appearing over fullscreen apps
            let levelSet = false;
            
            try {
                // Screen-saver level is the highest and appears over everything including fullscreen
                this.mainWindow.setAlwaysOnTop(true, 'screen-saver');
                levelSet = true;
            } catch (screenSaverErr) {
                try {
                    // Fallback to pop-up-menu if screen-saver fails
                    this.mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
                    levelSet = true;
                } catch (popUpErr) {
                    try {
                        this.mainWindow.setAlwaysOnTop(true, 'floating');
                        levelSet = true;
                    } catch (floatingError) {
                        try {
                            this.mainWindow.setAlwaysOnTop(true, 'normal');
                            levelSet = true;
                        } catch (normalError) {
                            console.error('Could not set any window level:', normalError);
                        }
                    }
                }
            }
            
            this.mainWindow.moveTop();
            
            // macOS-only: Reinforce content protection (use stealth mode preference)
            const stealthEnabled = this.getStealthModePreference();
            this.setWindowContentProtection(this.mainWindow, stealthEnabled);
            
            // One reinforcement after a short delay
            setTimeout(() => {
                if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.isOverlayVisible) return;
                try { this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) { this.mainWindow.setVisibleOnAllWorkspaces(true); }
                try { this.mainWindow.setAlwaysOnTop(true, 'screen-saver'); } catch (_) { try { this.mainWindow.setAlwaysOnTop(true, 'pop-up-menu'); } catch (_) { try { this.mainWindow.setAlwaysOnTop(true, 'floating'); } catch (_) {} } }
                // Reinforce content protection (use stealth mode preference)
                const stealthEnabled = this.getStealthModePreference();
                this.setWindowContentProtection(this.mainWindow, stealthEnabled);
                this.mainWindow.moveTop();
            }, 150);
        } catch (error) {
            // If everything fails, at least try to keep the window visible
            console.error('Error forcing fullscreen visibility:', error);
            try {
                this.mainWindow.show();
                this.mainWindow.setAlwaysOnTop(true);
            } catch (e) {
                console.error('Critical error keeping window visible:', e);
            }
        }
    }

    toggleOverlay() {
        // If overlay window doesn't exist yet (e.g., paywall-first flow), create it now
        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
            try {
                this.createWindow();
            } catch (e) {
                console.error('Failed to create overlay window on toggle:', e);
            }
            return; // ready-to-show handler will display it
        }

        if (this.isOverlayVisible) {
            this.hideOverlay();
        } else {
            this.showOverlay();
        }
        
        // Notify renderer of toggle for tutorial tracking
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('overlay-toggled');
        }
    }

    showOverlay() {
        if (!this.mainWindow) return;
        
        // Set visibility properties BEFORE showing
        try {
            this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        } catch (_) {
            try {
                this.mainWindow.setVisibleOnAllWorkspaces(true);
            } catch (__) {}
        }
        
        // CRITICAL: Try screen-saver level first (highest = 1000)
        try {
            this.mainWindow.setAlwaysOnTop(true, 'screen-saver');
        } catch (_) {
            try {
                this.mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
            } catch (__) {
                try {
                    this.mainWindow.setAlwaysOnTop(true, 'floating');
                } catch (___) {
                    this.mainWindow.setAlwaysOnTop(true);
                }
            }
        }
        
        // Start with click-through mode - let renderer handle making it interactive on hover
        // This allows clicking through to other windows when not interacting with the overlay
        try {
            this.mainWindow.setIgnoreMouseEvents(true, { forward: true });
        } catch (_) {}
        
        // On Windows, ensure window is focusable when showing overlay
        if (process.platform === 'win32') {
            try {
                this.mainWindow.setFocusable(true);
            } catch (_) {}
        }
        
        // macOS-only: Reinforce content protection when showing (use stealth mode preference)
        const stealthEnabled = this.getStealthModePreference();
        this.setWindowContentProtection(this.mainWindow, stealthEnabled);

        // Show the window WITHOUT stealing focus (prevents browser blur events)
        // This is critical for avoiding proctoring software detection (Canvas, etc.)
        try {
            this.mainWindow.showInactive(); // Show without activating/focusing
        } catch (_) {
            this.mainWindow.show(); // Fallback if showInactive not available
        }
        this.mainWindow.moveTop();
        this.isOverlayVisible = true;
        
        // DO NOT call focus() - this would trigger browser blur events
        // The window will receive input when the user clicks on it naturally
        
        // Use the robust fullscreen visibility method
        this.forceFullscreenVisibility();
        
        // Start continuous enforcement loop for fullscreen visibility
        this.startFullscreenEnforcement();
    }
    
    startFullscreenEnforcement() {
        // Clear any existing interval
        if (this.fullscreenEnforcementInterval) {
            clearInterval(this.fullscreenEnforcementInterval);
        }
        
        // Enforce fullscreen visibility every 500ms when overlay is visible
        this.fullscreenEnforcementInterval = setInterval(() => {
            if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.isOverlayVisible) {
                if (this.fullscreenEnforcementInterval) {
                    clearInterval(this.fullscreenEnforcementInterval);
                    this.fullscreenEnforcementInterval = null;
                }
                return;
            }
            
            // Skip enforcement if account or password reset window is open and focused
            if (this.accountWindow && !this.accountWindow.isDestroyed() && this.accountWindow.isFocused()) {
                return;
            }
            if (this.passwordResetWindow && !this.passwordResetWindow.isDestroyed() && this.passwordResetWindow.isFocused()) {
                return;
            }
            
            // Aggressively enforce fullscreen visibility
            try {
                // Set visible on all workspaces with fullscreen support
                try {
                    this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                } catch (_) {
                    this.mainWindow.setVisibleOnAllWorkspaces(true);
                }
                
                // Set window level to screen-saver (highest)
                try {
                    this.mainWindow.setAlwaysOnTop(true, 'screen-saver');
                } catch (_) {
                    try {
                        this.mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
                    } catch (__) {
                        try {
                            this.mainWindow.setAlwaysOnTop(true, 'floating');
                        } catch (___) {}
                    }
                }
                
                // Bring to front
                this.mainWindow.moveTop();
                
                // macOS-only: Reinforce content protection in enforcement loop (use stealth mode preference)
                const stealthEnabled = this.getStealthModePreference();
                this.setWindowContentProtection(this.mainWindow, stealthEnabled);
            } catch (e) {
                // Ignore errors in enforcement loop
            }
        }, 500);
    }
    
    stopFullscreenEnforcement() {
        if (this.fullscreenEnforcementInterval) {
            clearInterval(this.fullscreenEnforcementInterval);
            this.fullscreenEnforcementInterval = null;
        }
    }

    hideOverlay() {
        if (!this.mainWindow) return;
        
        this.mainWindow.hide();
        this.isOverlayVisible = false;
        
        // Stop fullscreen enforcement when hidden
        this.stopFullscreenEnforcement();
    }

    async checkFreeAccess() {
        try {
            const userDataPath = app.getPath('userData');
            const fs = require('fs');
            const path = require('path');
            
            const freeAccessFile = path.join(userDataPath, 'jarvis-free-access.json');
            if (fs.existsSync(freeAccessFile)) {
                const data = JSON.parse(fs.readFileSync(freeAccessFile, 'utf8'));
                return data.hasFreeAccess === true || data.granted === true;
            }
            
            return false;
        } catch (error) {
            console.error('Error checking free access:', error);
            return false;
        }
    }

    grantFreeAccess() {
        try {
            const userDataPath = app.getPath('userData');
            const fs = require('fs');
            const path = require('path');
            
            // Create free access flag file
            const freeAccessFile = path.join(userDataPath, 'jarvis-free-access.json');
            const data = {
                hasFreeAccess: true,
                grantedAt: new Date().toISOString()
            };
            
            fs.writeFileSync(freeAccessFile, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Error granting free access:', error);
        }
    }

    async extractWebsiteContent(url) {
        return new Promise((resolve, reject) => {
            const postData = JSON.stringify({
                urls: [url],
                type: "text"
            });

            const options = {
                hostname: 'api.exa.ai',
                port: 443,
                path: '/contents',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                    'x-api-key': this.exaApiKey
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        const response = JSON.parse(data);
                        
                        if (response.results && response.results.length > 0) {
                            const result = response.results[0];
                            this.currentDocument = {
                                url: result.url || url,
                                content: result.text || result.content || 'No content available',
                                title: result.title || 'Document',
                                extractedAt: new Date().toISOString()
                            };
                            resolve(this.currentDocument);
                        } else {
                            console.error('No content in Exa API response:', response);
                            reject(new Error('No content found on the website'));
                        }
                    } catch (error) {
                        console.error('Failed to parse Exa API response:', error);
                        console.error('Raw response:', data);
                        reject(new Error('Failed to parse Exa API response'));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.write(postData);
            req.end();
        });
    }

    getCurrentDocument() {
        return this.currentDocument;
    }

    clearCurrentDocument() {
        this.currentDocument = null;
    }

    getUserEmail() {
        try {
            const fs = require('fs');
            const path = require('path');
            const userDataPath = app.getPath('userData');
            const userFile = path.join(userDataPath, 'jarvis_user.json');
            
            if (fs.existsSync(userFile)) {
                const userData = JSON.parse(fs.readFileSync(userFile, 'utf8'));
                return userData.email;
            }
            return null;
        } catch (error) {
            console.error('Error getting user email:', error);
            return null;
        }
    }

    // Helper method to get stealth mode preference
    getStealthModePreference() {
        try {
            const fs = require('fs');
            const path = require('path');
            const userDataPath = app.getPath('userData');
            const stealthFile = path.join(userDataPath, 'stealth_mode.json');
            if (fs.existsSync(stealthFile)) {
                const stealthData = JSON.parse(fs.readFileSync(stealthFile, 'utf8'));
                const enabled = stealthData.enabled !== false; // Default to true if not explicitly false
                console.log(`📋 Loaded stealth mode preference: ${enabled ? 'ENABLED' : 'DISABLED'}`);
                return enabled;
            } else {
                // File doesn't exist, default to enabled
                console.log('📋 No stealth mode preference found, defaulting to ENABLED');
                return true;
            }
        } catch (error) {
            console.warn('⚠️ Could not read stealth mode preference, defaulting to enabled:', error);
            return true; // Default to enabled
        }
    }

    // Helper method to set content protection on any window (uses native module if available)
    // Applies ALL 10 stealth methods to make window invisible to screen sharing/recording
    setWindowContentProtection(window, enable) {
        if (!window || process.platform !== 'darwin') {
            console.log(`⚠️ Skipping content protection: window=${!!window}, platform=${process.platform}`);
            return;
        }
        
        try {
            console.log(`🔒 Setting COMPREHENSIVE STEALTH MODE to ${enable ? 'ENABLED' : 'DISABLED'} for window`);
            
            // Use native module if available (applies ALL 11+ stealth methods)
            if (this.nativeContentProtection && this.nativeContentProtection.isAvailable()) {
                console.log('✅ Using native module with ALL 11+ anti-capture methods:');
                console.log('   1. GPU-exclusive rendering');
                console.log('   2. Fullscreen exclusive mode behavior');
                console.log('   3. OS Privacy Restrictions (secure window)');
                console.log('   4. Overlay window (non-capturable)');
                console.log('   5. Secure Rendering (NSWindowSharingNone)');
                console.log('   6. Hardware-accelerated video surface blocking');
                console.log('   7. Virtual desktops/Spaces isolation');
                console.log('   8. Sandbox/containerized app behavior');
                console.log('   9. System-level overlay prevention');
                console.log('   10. Protected swapchain (GPU-level)');
                console.log('   11. 🔐 System-Level Secure Input (NEW!)');
                console.log('       → Makes window appear BLANK/TRANSPARENT');
                console.log('       → Same as password fields, Touch ID, Keychain');
                console.log('       → STRONGEST PROTECTION AVAILABLE');
                
                // Use comprehensive stealth (applies all methods at once)
                if (this.nativeContentProtection.applyComprehensiveStealth) {
                    this.nativeContentProtection.applyComprehensiveStealth(window, enable);
                } else {
                    // Fallback to standard method if comprehensive not available
                    this.nativeContentProtection.setContentProtection(window, enable);
                }
                
                // CRITICAL: Also apply Electron's built-in API as backup
                // This ensures maximum compatibility
                try {
                    window.setContentProtection(enable);
                    console.log('✅ Also applied Electron built-in content protection as backup');
                } catch (e) {
                    console.warn('⚠️ Electron backup content protection failed:', e);
                }
            } else {
                // Fallback to Electron's built-in API (Method 5 only)
                console.log('⚠️ Using Electron built-in API (native module not available)');
                console.log('   Only Method 5 (Secure Rendering) will be applied');
                console.log('   NOTE: This may not hide from screenshots, only screen sharing');
                window.setContentProtection(enable);
            }
            
            // CRITICAL: For screenshots, we also need to detect and hide the window
            // setContentProtection works for screen sharing but screenshots may still capture it
            if (enable) {
                this.setupScreenshotDetection();
            } else {
                this.removeScreenshotDetection();
            }
            
            console.log(`✅ Stealth mode ${enable ? 'ENABLED' : 'DISABLED'} successfully`);
        } catch (error) {
            console.error('❌ Failed to set stealth mode:', error);
            // Try fallback
            try {
                window.setContentProtection(enable);
                if (enable) {
                    this.setupScreenshotDetection();
                } else {
                    this.removeScreenshotDetection();
                }
                console.log('✅ Fallback content protection applied');
            } catch (fallbackError) {
                console.error('❌ Fallback also failed:', fallbackError);
            }
        }
    }

    // Setup screenshot detection to hide overlay when screenshots are taken
    setupScreenshotDetection() {
        if (process.platform !== 'darwin') return;
        if (this.screenshotDetectionSetup) return; // Already setup
        
        this.screenshotDetectionSetup = true;
        console.log('📸 Setting up screenshot detection for stealth mode');
        
        // Monitor for screenshot shortcuts (Cmd+Shift+3, Cmd+Shift+4, Cmd+Shift+5)
        const screenshotShortcuts = [
            'CommandOrControl+Shift+3',
            'CommandOrControl+Shift+4',
            'CommandOrControl+Shift+5'
        ];
        
        screenshotShortcuts.forEach(shortcut => {
            try {
                const registered = globalShortcut.register(shortcut, () => {
                    console.log(`🥷 Screenshot shortcut detected: ${shortcut}`);
                    if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isVisible()) {
                        // Make opacity change so fast it's imperceptible
                        // Set opacity to near-zero and restore immediately
                        this.mainWindow.setOpacity(0.001);
                        
                        // Restore opacity almost instantly - screenshot happens in < 10ms
                        // Use requestAnimationFrame timing for minimal delay
                        setTimeout(() => {
                            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                if (this.getStealthModePreference()) {
                                    this.mainWindow.setOpacity(1.0);
                                }
                            }
                        }, 20); // Ultra-fast - 20ms should be imperceptible
                    }
                });
                
                if (registered) {
                    console.log(`✅ Registered screenshot shortcut: ${shortcut}`);
                } else {
                    console.warn(`⚠️ Failed to register screenshot shortcut: ${shortcut}`);
                }
            } catch (error) {
                console.warn(`⚠️ Could not register screenshot shortcut ${shortcut}:`, error);
            }
        });
        
        // Also try to detect screenshots by monitoring window focus/blur events
        // This is a fallback for other screenshot methods
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.on('blur', () => {
                // When window loses focus, it might be a screenshot
                // Hide briefly as a precaution
                if (this.getStealthModePreference() && this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isVisible()) {
                    // Don't hide on every blur, but we could add logic here if needed
                }
            });
        }
    }

    // Remove screenshot detection
    removeScreenshotDetection() {
        if (!this.screenshotDetectionSetup) return;
        
        this.screenshotDetectionSetup = false;
        console.log('📸 Removing screenshot detection');
        
        // Unregister shortcuts
        const screenshotShortcuts = [
            'CommandOrControl+Shift+3',
            'CommandOrControl+Shift+4',
            'CommandOrControl+Shift+5'
        ];
        
        screenshotShortcuts.forEach(shortcut => {
            try {
                globalShortcut.unregister(shortcut);
            } catch (error) {
                // Ignore errors
            }
        });
    }




    // Load current user email from saved subscription on app startup
    loadCurrentUserEmail() {
        try {
            const fs = require('fs');
            const path = require('path');
            const userDataPath = app.getPath('userData');
            const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
            
            if (fs.existsSync(subscriptionFile)) {
                const subscriptionData = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
                
                if (subscriptionData.email) {
                    this.currentUserEmail = subscriptionData.email;
                    console.log(`📧 Token tracking: User email loaded on startup: ${subscriptionData.email}`);
                } else {
                    console.log('⚠️ Token tracking: No email found in saved subscription');
                }
            } else {
                console.log('⚠️ Token tracking: No saved subscription file found');
            }
        } catch (error) {
            console.error('❌ Error loading user email for token tracking:', error);
        }
    }

    async checkActiveSubscription() {
        try {
            const fs = require('fs');
            const path = require('path');
            const userDataPath = app.getPath('userData');
            const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
            
            if (fs.existsSync(subscriptionFile)) {
                const subscriptionData = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
                
                // Check if subscription is still active
                if (subscriptionData.status === 'active' || subscriptionData.status === 'trialing') {
                    // Track current user email for token usage
                    if (subscriptionData.email) {
                        this.currentUserEmail = subscriptionData.email;
                        console.log(`📧 Token tracking: User email set to ${subscriptionData.email}`);
                    }
                    
                    return {
                        email: subscriptionData.email,
                        nextBilling: subscriptionData.currentPeriodEnd,
                        features: ['unlimited_messages', 'screenshot_analysis', 'voice_activation'],
                        status: subscriptionData.status
                    };
                }
            }
            
            return null;
        } catch (error) {
            console.error('Error checking active subscription:', error);
            return null;
        }
    }

    async storeSubscriptionData(subscriptionData) {
        try {
            const fs = require('fs');
            const path = require('path');
            const userDataPath = app.getPath('userData');
            
            if (!fs.existsSync(userDataPath)) {
                fs.mkdirSync(userDataPath, { recursive: true });
            }
            
            // Store subscription status
            const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
            const dataToStore = {
                ...subscriptionData,
                createdAt: new Date().toISOString()
            };
            fs.writeFileSync(subscriptionFile, JSON.stringify(dataToStore, null, 2));
            console.log('✅ Subscription data stored:', subscriptionFile);
            
            // CRITICAL: Also store email in jarvis_user.json so getUserEmail() can find it
            if (subscriptionData.email) {
                const userFile = path.join(userDataPath, 'jarvis_user.json');
                const userData = {
                    email: subscriptionData.email,
                    updatedAt: new Date().toISOString()
                };
                fs.writeFileSync(userFile, JSON.stringify(userData, null, 2));
                console.log('✅ User email stored:', userFile, 'Email:', subscriptionData.email);
            } else {
                console.warn('⚠️ No email in subscriptionData, cannot store user email');
            }
        } catch (error) {
            console.error('Error storing subscription data:', error);
        }
    }

    async checkUserSubscriptionViaAPI(userEmail) {
        try {
            // Use Supabase to check subscription
            const subscriptionResult = await this.supabaseIntegration.checkSubscriptionByEmail(userEmail);
            
            if (subscriptionResult.hasSubscription && subscriptionResult.subscription) {
                const subscriptionData = {
                    email: userEmail,
                    nextBilling: subscriptionResult.subscription.currentPeriodEnd,
                    features: ['unlimited_messages', 'screenshot_analysis', 'voice_activation'],
                    status: subscriptionResult.subscription.status,
                    subscriptionId: subscriptionResult.subscription.id
                };
                
                // Store the subscription data
                await this.storeSubscriptionData(subscriptionData);
                
                return {
                    hasSubscription: true,
                    subscriptionData: subscriptionData
                };
            }
            
            return { hasSubscription: false };
            
        } catch (error) {
            console.error('Error checking subscription via API:', error);
            return { hasSubscription: false, error: error.message };
        }
    }
}

// Create the app instance
new JarvisApp();
