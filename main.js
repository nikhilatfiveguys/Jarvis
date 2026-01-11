const { app, BrowserWindow, ipcMain, screen, desktopCapturer, shell, globalShortcut, clipboard } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const os = require('os');

// Windows-specific: Import module to prevent focus stealing
let windowsHideAltTab = null;
if (process.platform === 'win32') {
    try {
        windowsHideAltTab = require('./native/windows-hide-alt-tab');
    } catch (e) {
        console.warn('⚠️ Failed to load windows-hide-alt-tab module:', e.message);
    }
}

// Windows-specific: Import keyboard hook for stealth typing
let windowsKeyboardHook = null;
if (process.platform === 'win32') {
    try {
        windowsKeyboardHook = require('./native/windows-keyboard-hook');
    } catch (e) {
        console.warn('⚠️ Failed to load windows-keyboard-hook module:', e.message);
    }
}

// Handle Squirrel events for auto-updates (Windows)
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

// Windows-optimized: No native content protection module needed
// Windows uses Electron's built-in content protection API

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
        this.interactiveEnforcementInterval = null;
        this.menuInteractiveInterval = null; // Keep window interactive while menu is open
        this.modalInteractiveInterval = null; // Keep window interactive while modal is open
        this.isModalOpen = false; // Track if modal is open
        this.isTransitioningOnboarding = false; // Track onboarding window transitions
        this.screenRecordingCheckInterval = null; // Track screen recording detection
        this.currentUserEmail = null; // Track current user for token usage
        this.wasVisibleBeforeRecording = false; // Track if window was visible before recording
        this.screenshotDetectionSetup = false; // Track screenshot detection setup
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
        // Use the same method as get-api-keys handler to ensure consistency
        const exaConfig = this.secureConfig.getExaConfig();
        const openaiConfig = this.secureConfig.getOpenAIConfig();
        
        // #region agent log
        const fs = require('fs');
        const logPath = 'e:\\Jarvis-windowsOS\\.cursor\\debug.log';
        try {
            fs.appendFileSync(logPath, JSON.stringify({location:'main.js:103',message:'Loading API keys from secure config',data:{hasExaConfig:!!exaConfig,hasOpenAIConfig:!!openaiConfig,openaiConfigKeys:openaiConfig?Object.keys(openaiConfig):null,openaiApiKeyPresent:!!openaiConfig?.apiKey,openaiApiKeyLength:openaiConfig?.apiKey?.length||0,openaiApiKeyValue:openaiConfig?.apiKey||'undefined',processEnvKey:process.env.OPENAI_API_KEY||'undefined',processEnvKeyLength:process.env.OPENAI_API_KEY?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})+'\n');
        } catch(e) {}
        // #endregion
        
        this.exaApiKey = exaConfig?.apiKey || '';
        this.currentDocument = null;
        // Get OpenAI API key the same way get-api-keys handler does
        // Try config first, then fallback to process.env (same as get-api-keys)
        this.openaiApiKey = openaiConfig?.apiKey || process.env.OPENAI_API_KEY || '';
        
        // #region agent log
        try {
            fs.appendFileSync(logPath, JSON.stringify({location:'main.js:117',message:'API keys assigned',data:{openaiApiKeyAssigned:this.openaiApiKey,openaiApiKeyLength:this.openaiApiKey?.length||0,openaiApiKeyIsEmpty:!this.openaiApiKey||this.openaiApiKey.trim()===''},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})+'\n');
        } catch(e) {}
        // #endregion
        
        // Also set process.env for backward compatibility (as user suggested)
        if (this.openaiApiKey && this.openaiApiKey.trim() !== '') {
            process.env.OPENAI_API_KEY = this.openaiApiKey;
            // #region agent log
            try {
                fs.appendFileSync(logPath, JSON.stringify({location:'main.js:123',message:'Set process.env.OPENAI_API_KEY',data:{envKeySet:!!process.env.OPENAI_API_KEY,envKeyLength:process.env.OPENAI_API_KEY?.length||0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})+'\n');
            } catch(e) {}
            // #endregion
        }
        
        // #region agent log
        try {
            fs.appendFileSync(logPath, JSON.stringify({location:'main.js:109',message:'API keys loaded',data:{hasOpenAIApiKey:!!this.openaiApiKey,openaiApiKeyLength:this.openaiApiKey?.length||0,openaiApiKeyTrimmed:this.openaiApiKey?.trim()?.length||0,willInitializeVoiceRecorder:!!(this.openaiApiKey && this.openaiApiKey.trim() !== '')},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})+'\n');
        } catch(e) {}
        // #endregion
        
        // Initialize voice recorder only if API key is available
        // Use the same key that the renderer process uses (via get-api-keys)
        if (this.openaiApiKey && this.openaiApiKey.trim() !== '') {
            // Log partial key for debugging (first 7 chars + ...)
            const keyPreview = this.openaiApiKey.length > 7 
                ? `${this.openaiApiKey.substring(0, 7)}...` 
                : '***';
            console.log(`✅ Initializing voice recorder with OpenAI API key: ${keyPreview}`);
            console.log(`   (Using same key as Jarvis chat model)`);
            this.voiceRecorder = new VoiceRecorder(this.openaiApiKey);
            // #region agent log
            try {
                fs.appendFileSync(logPath, JSON.stringify({location:'main.js:132',message:'Voice recorder initialized',data:{hasVoiceRecorder:!!this.voiceRecorder,apiKeyPreview:keyPreview},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})+'\n');
            } catch(e) {}
            // #endregion
        } else {
            console.warn('⚠️ OpenAI API key not configured. Voice recording will be disabled.');
            console.warn('   Please set OPENAI_API_KEY in your .env file or environment variables.');
            console.warn('   (Voice recorder uses the same key as the Jarvis chat model)');
            this.voiceRecorder = null;
            // #region agent log
            try {
                fs.appendFileSync(logPath, JSON.stringify({location:'main.js:141',message:'Voice recorder NOT initialized - API key missing',data:{openaiApiKey:this.openaiApiKey,openaiApiKeyType:typeof this.openaiApiKey},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})+'\n');
            } catch(e) {}
            // #endregion
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
                if (process.platform === 'win32' && windowsHideAltTab) {
                    try {
                        windowsHideAltTab.showWithoutActivate(this.mainWindow);
                    } catch (e) {
                        this.mainWindow.showInactive();
                    }
                } else {
                this.mainWindow.show();
                this.mainWindow.focus();
                }
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
            
            // Windows: Desktop capture works without explicit permission requests
            // No need to request permissions on Windows
            
            // Setup IPC handlers (needed for all flows)
            this.setupIpcHandlers();
            
            // PAYWALL DISABLED - Go directly to main window
            // Always create window - interactive tutorial happens in overlay now
                    this.createWindow();
            
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
            // Windows: Quit app when all windows are closed
            app.quit();
        });

        app.on('before-quit', () => {
            globalShortcut.unregisterAll();
            // Cleanup screen recording detection
            if (this.screenRecordingCheckInterval) {
                clearInterval(this.screenRecordingCheckInterval);
                this.screenRecordingCheckInterval = null;
            }
        });

        // Handle app activation (Windows: restore window if minimized)
        app.on('activate', () => {
            if (this.mainWindow) {
                if (this.mainWindow.isMinimized()) {
                    this.mainWindow.restore();
                }
                if (process.platform === 'win32' && windowsHideAltTab) {
                    try {
                        windowsHideAltTab.showWithoutActivate(this.mainWindow);
                    } catch (e) {
                        this.mainWindow.showInactive();
                    }
                } else {
                this.mainWindow.show();
                this.mainWindow.focus();
                }
            } else if (BrowserWindow.getAllWindows().length === 0) {
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
            // Cleanup keyboard hook on Windows
            if (process.platform === 'win32' && windowsKeyboardHook) {
                try {
                    windowsKeyboardHook.uninstallKeyboardHook();
                    console.log('✅ Keyboard hook uninstalled');
                } catch (e) {
                    console.warn('⚠️ Failed to uninstall keyboard hook:', e.message);
                }
            }
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
        
        // Windows-optimized window options
        paywallOptions.frame = true; // Show frame on Windows
        paywallOptions.autoHideMenuBar = true;
        
        this.paywallWindow = new BrowserWindow(paywallOptions);

        // Enable content protection (check stealth mode preference)
        const stealthEnabled = this.getStealthModePreference();
        if (stealthEnabled) {
            try {
                this.paywallWindow.setContentProtection(true);
            } catch (e) {}
        }

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
        
        // Windows-optimized window options
        windowOptions.frame = true; // Show frame on Windows
        windowOptions.autoHideMenuBar = true;
        
        this.onboardingWindow = new BrowserWindow(windowOptions);

        // Enable content protection (check stealth mode preference)
        const stealthEnabled = this.getStealthModePreference();
        if (stealthEnabled) {
            try {
                this.onboardingWindow.setContentProtection(true);
            } catch (e) {}
        }

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
        // Windows: Open Privacy settings for screen recording/microphone
        shell.openExternal('ms-settings:privacy-screen').catch(() => {
            shell.openExternal('ms-settings:privacy-microphone').catch((err) => {
                // Fallback: Open main privacy settings
                shell.openExternal('ms-settings:privacy').catch((err2) => {
                    console.error('Failed to open Windows privacy settings:', err2);
                });
            });
        });
    }

    // Windows: Desktop capture works without explicit permission requests
    async requestScreenRecordingPermission() {
        // Windows: Desktop capture works without explicit permission requests
        // Desktop capture is available by default on Windows
        console.log('✅ Windows: Desktop capture available without explicit permissions');
        this.screenRecordingPermissionGranted = true;
        
        // Notify the overlay that permissions are available
        setTimeout(() => {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('screen-permission-granted');
            }
        }, 500);
    }

    createAccountWindow() {
        // Reuse existing window if it exists
        if (this.accountWindow && !this.accountWindow.isDestroyed()) {
            this.accountWindow.show();
            this.accountWindow.focus();
            // Windows: Focus the window
            accountWindow.focus();
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
        
        const accountWindow = new BrowserWindow(accountOptions);

        // Enable content protection (check stealth mode preference)
        const stealthEnabled = this.getStealthModePreference();
        if (stealthEnabled) {
            try {
                accountWindow.setContentProtection(true);
            } catch (e) {}
        }

        accountWindow.loadFile('account-window.html');
        
        // Show and focus when ready - ensures proper focus
        accountWindow.once('ready-to-show', () => {
            // Temporarily lower main window level so account window can be focused
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.setAlwaysOnTop(true, 'floating', 0);
            }
            accountWindow.show();
            accountWindow.focus();
            // Windows: Focus the window
            accountWindow.focus();
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
            // Windows: Focus the window
            resetWindow.focus();
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
        
        const resetWindow = new BrowserWindow(resetOptions);

        // Enable content protection
        const stealthEnabled = this.getStealthModePreference();
        if (stealthEnabled) {
            try {
                resetWindow.setContentProtection(true);
            } catch (e) {}
        }

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
            // Windows: Focus the window
            resetWindow.focus();
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
        
        // Windows-optimized window options
        hotkeysOptions.frame = true;
        hotkeysOptions.autoHideMenuBar = true;
        
        const hotkeysWindow = new BrowserWindow(hotkeysOptions);

        // Enable content protection (check stealth mode preference)
        const stealthEnabled = this.getStealthModePreference();
        if (stealthEnabled) {
            try {
                hotkeysWindow.setContentProtection(true);
            } catch (e) {}
        }

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
            // Windows shortcuts
            const shortcuts = [
                'Ctrl+S',           // Ctrl+S for toggle recording
                'Alt+V'             // Alt+V for toggle recording
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
        
        // Use browser-based recording (no external dependencies needed)
        // Check if API key is available for transcription
        const openaiConfig = this.secureConfig.getOpenAIConfig();
        const apiKey = openaiConfig?.apiKey || this.openaiApiKey || process.env.OPENAI_API_KEY || '';
        
        if (!apiKey || apiKey.trim() === '') {
            const errorMsg = 'Voice recording not available - OpenAI API key not configured';
            console.error(errorMsg);
            if (this.mainWindow) {
                this.mainWindow.webContents.send('voice-recording-error', errorMsg);
            }
            return;
        }
        
        // Initialize voice recorder for transcription (doesn't need to record, just transcribe)
        if (!this.voiceRecorder) {
            try {
                this.voiceRecorder = new VoiceRecorder(apiKey);
                this.openaiApiKey = apiKey;
            } catch (error) {
                console.error('❌ Failed to initialize voice recorder:', error);
                if (this.mainWindow) {
                    this.mainWindow.webContents.send('voice-recording-error', 'Failed to initialize voice recorder');
                }
                return;
            }
        }
        
        this.isVoiceRecording = true;
        this.recordingStartTime = Date.now();
        
        // Trigger browser-based recording in renderer
        if (this.mainWindow) {
            this.mainWindow.webContents.send('start-browser-recording');
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

        // Create a true overlay window - same approach for both macOS and Windows
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
            movable: true, // Allow moving - needed for interaction on Windows
            minimizable: false,
            maximizable: false,
            skipTaskbar: true, // Hide from taskbar - background app
            focusable: false, // Non-focusable by default - will be enabled when user needs to type
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
        
        // Windows-specific options
        if (process.platform === 'win32') {
            mainWindowOptions.autoHideMenuBar = true; // Hide menu bar on Windows
        }
        
        this.mainWindow = new BrowserWindow(mainWindowOptions);

        // Windows: Hide from taskbar - background app
        if (process.platform === 'win32') {
            this.mainWindow.setSkipTaskbar(true);
        }

        // Windows: Enable content protection using Electron's built-in API
        // Check if stealth mode is enabled (default: true)
        // NOTE: Content protection on Windows can cause videos in other tabs to turn white
        // due to DWM composition interference. We'll only enable it if explicitly needed.
        const stealthModeEnabled = this.getStealthModePreference();
        // DISABLED: setContentProtection causes videos in other tabs to turn white
        // The window is already hidden from taskbar and uses WS_EX_NOACTIVATE, which provides
        // sufficient stealth without interfering with video rendering
        // if (stealthModeEnabled) {
        //     try {
        //         this.mainWindow.setContentProtection(true);
        //         console.log('✅ Windows content protection enabled');
        //     } catch (e) {
        //         console.log('⚠️ Windows content protection not available:', e.message);
        //     }
        // }
        
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

        // Windows: Just like macOS - window is interactive by default, no special setup needed
        // Only setup handlers, don't mess with mouse events
        if (process.platform === 'win32') {
            this.setupWindowsRegionTracking(); // Just for handlers, not for tracking
        }
        

        // Windows: No dock to hide (macOS-specific feature)

        // Load the HTML file
        this.mainWindow.loadFile('index.html').catch(err => {
            console.error('Failed to load index.html:', err);
        });


        // Window is ready; show overlay immediately
        this.mainWindow.once('ready-to-show', () => {
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1391',message:'ready-to-show event fired',data:{platform:process.platform,hasWindowsHideAltTab:!!windowsHideAltTab},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            
            // Windows: Start with click-through, region tracking will handle interactivity
            if (process.platform === 'win32') {
                this.mainWindow.setIgnoreMouseEvents(true, { forward: true });
                this.mainWindow.setFocusable(false); // Non-focusable by default - background app
                this.mainWindow.setSkipTaskbar(true); // Hide from taskbar - background app
                
                // Ensure window is visible (opacity 1.0)
                try {
                    this.mainWindow.setOpacity(1.0);
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1400',message:'setOpacity(1.0) called',data:{opacity:1.0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                    // #endregion
                } catch (e) {
                    console.warn('⚠️ Failed to set opacity:', e.message);
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1402',message:'setOpacity failed',data:{error:e.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                    // #endregion
                }
                
                // Configure window to be non-focus-stealing (but visible)
                if (windowsHideAltTab) {
                    try {
                        windowsHideAltTab.hideFromAltTab(this.mainWindow, { makeInvisible: false });
                        console.log('✅ Window configured as non-focus-stealing');
                        // #region agent log
                        fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1408',message:'hideFromAltTab called',data:{makeInvisible:false},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
                        // #endregion
                        // Ensure opacity is still 1.0 after configuration
                        this.mainWindow.setOpacity(1.0);
                        // #region agent log
                        fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1411',message:'setOpacity(1.0) after hideFromAltTab',data:{opacity:1.0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                        // #endregion
                    } catch (e) {
                        console.warn('⚠️ Failed to configure window:', e.message);
                        // #region agent log
                        fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1413',message:'hideFromAltTab failed',data:{error:e.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
                        // #endregion
                    }
                }
            }
            
            // Show window without activating it (prevents focus stealing)
            if (process.platform === 'win32' && windowsHideAltTab) {
                try {
                    // #region agent log
                    const boundsBefore = this.mainWindow.getBounds();
                    const visibleBefore = this.mainWindow.isVisible();
                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1420',message:'Before showWithoutActivate',data:{bounds:boundsBefore,visible:visibleBefore,isMinimized:this.mainWindow.isMinimized()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                    // #endregion
                    windowsHideAltTab.showWithoutActivate(this.mainWindow);
                    // #region agent log
                    const boundsAfter = this.mainWindow.getBounds();
                    const visibleAfter = this.mainWindow.isVisible();
                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1422',message:'After showWithoutActivate',data:{bounds:boundsAfter,visible:visibleAfter,isMinimized:this.mainWindow.isMinimized()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                    // #endregion
                    // Ensure window is visible after showing
                    this.mainWindow.setOpacity(1.0);
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1424',message:'setOpacity(1.0) after showWithoutActivate',data:{opacity:1.0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                    // #endregion
                    
                    // Windows: Reapply window styles after showing to ensure it stays hidden from taskbar
                    // Windows may add window to taskbar when it's shown, so we need to reapply WS_EX_TOOLWINDOW
                    setTimeout(() => {
                        if (this.mainWindow && !this.mainWindow.isDestroyed() && windowsHideAltTab) {
                            try {
                                windowsHideAltTab.hideFromAltTab(this.mainWindow, { makeInvisible: false });
                                this.mainWindow.setSkipTaskbar(true);
                                // #region agent log
                                fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1435',message:'Reapplied window styles after showing to hide from taskbar',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'D'})}).catch(()=>{});
                                // #endregion
                            } catch (e) {
                                this.mainWindow.setSkipTaskbar(true);
                            }
                        }
                    }, 100);
                } catch (e) {
                    console.warn('⚠️ Failed to show without activate, using fallback:', e.message);
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1426',message:'showWithoutActivate failed, using fallback',data:{error:e.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                    // #endregion
                    this.mainWindow.showInactive();
                    this.mainWindow.setOpacity(1.0);
                }
            } else {
            this.mainWindow.show();
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1430',message:'show() called (non-Windows)',data:{platform:process.platform},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                // #endregion
            }
            
            // Don't focus immediately on Windows - let region tracking handle it
            if (process.platform !== 'win32') {
                this.mainWindow.focus();
            }
            
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
            
            // Small delay to ensure all properties are set before showing
            setTimeout(() => {
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    // Now show the overlay
                    this.showOverlay();
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

        // Windows: Prevent focus stealing - use window styles + reactive prevention
        // Window styles (WS_EX_NOACTIVATE) should prevent focus, but we also handle it reactively
        if (process.platform === 'win32') {
            // Keep window non-focusable by default - background app behavior
            this.mainWindow.setFocusable(false);
            
            // Track when user is actually typing (not just hovering)
            // Use instance property so IPC handlers can access it
            this.userIsTyping = false;
            let typingTimeout = null;
            
            // Throttle preventActivation calls to prevent lag
            let lastPreventActivationTime = 0;
            const PREVENT_ACTIVATION_THROTTLE_MS = 500; // Max once per 500ms
            let lastFocusRestoreTime = 0; // Track when we last restored focus in setFocusable wrapper
            
            // Wrapper to ensure window stays hidden from taskbar when made focusable
            // Windows may add window to taskbar when setFocusable(true) is called
            // THROTTLED to prevent lag - only reapply styles max once per second
            let lastStyleReapplyTime = 0;
            const STYLE_REAPPLY_THROTTLE_MS = 2000; // Increased to 2 seconds to reduce lag
            let isUserInteracting = false; // Track if user is actively interacting
            const originalSetFocusable = this.mainWindow.setFocusable.bind(this.mainWindow);
            this.mainWindow.setFocusable = (focusable) => {
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1585',message:'setFocusable called',data:{focusable,stealthMode:this.getStealthModePreference(),userIsTyping:this.userIsTyping,isFocused:this.mainWindow.isFocused(),isFocusableBefore:this.mainWindow.isFocusable?.()},timestamp:Date.now(),sessionId:'debug-session',runId:'focus-debug',hypothesisId:'E'})}).catch(()=>{});
                // #endregion
                // In stealth mode, prevent making window focusable
                if (focusable && this.getStealthModePreference() && process.platform === 'win32') {
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1590',message:'Blocking setFocusable(true) in stealth mode',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'focus-debug',hypothesisId:'E'})}).catch(()=>{});
                    // #endregion
                    return; // Don't make focusable in stealth mode
                }
                originalSetFocusable(focusable);
                if (focusable && this.mainWindow && !this.mainWindow.isDestroyed()) {
                    // Mark that user is interacting (region tracking or typing)
                    isUserInteracting = true;
                    // Clear flag after interaction stops
                    setTimeout(() => {
                        isUserInteracting = false;
                    }, 1000);
                    
                    // ALWAYS call setSkipTaskbar (fast, no lag) to ensure it stays hidden
                    this.mainWindow.setSkipTaskbar(true);
                    
                    // Don't call preventActivation here - it's too expensive (PowerShell)
                    // Window styles (WS_EX_NOACTIVATE) should prevent focus acquisition
                    // The focus event handler will restore focus if it does get stolen
                    
                    // Skip PowerShell entirely - it's slow and failing
                    // setSkipTaskbar(true) is fast and reliable enough
                    // Only use PowerShell on initial window creation, not on every setFocusable call
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1577',message:'setFocusable(true) completed',data:{isFocusableAfter:this.mainWindow.isFocusable?.(),isFocused:this.mainWindow.isFocused()},timestamp:Date.now(),sessionId:'debug-session',runId:'typing-debug',hypothesisId:'B'})}).catch(()=>{});
                    // #endregion
                } else if (!focusable) {
                    // When making non-focusable, also ensure it stays hidden
                    this.mainWindow.setSkipTaskbar(true);
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1583',message:'setFocusable(false) completed',data:{isFocusableAfter:this.mainWindow.isFocusable?.(),isFocused:this.mainWindow.isFocused()},timestamp:Date.now(),sessionId:'debug-session',runId:'typing-debug',hypothesisId:'B'})}).catch(()=>{});
                    // #endregion
                }
            };
            
            // No periodic reapplication - rely on setSkipTaskbar(true) which is fast and reliable
            // The wrapper around setFocusable already ensures it stays hidden
            // Periodic PowerShell calls were causing lag spikes
            
            // Detect when user is actually typing (not just hovering)
            // Set userIsTyping BEFORE making focusable to prevent focus handler from interfering
            this.mainWindow.webContents.on('before-input-event', (event, input) => {
                // In stealth mode, don't handle input events - keyboard hook handles it
                const stealthEnabled = this.getStealthModePreference();
                if (stealthEnabled && process.platform === 'win32') {
                    // Prevent default to stop the event from reaching the input
                    event.preventDefault();
                    console.log('🔒 Stealth mode: Blocked before-input-event (keyboard hook handles input)');
                    return;
                }
                
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1633',message:'before-input-event fired',data:{type:input.type,key:input.key,code:input.code,isEnter:input.key==='Enter',isFocusable:this.mainWindow.isFocusable?.(),isFocused:this.mainWindow.isFocused(),userIsTyping:this.userIsTyping,stealthMode:stealthEnabled},timestamp:Date.now(),sessionId:'debug-session',runId:'enter-key-debug',hypothesisId:'C'})}).catch(()=>{});
                // #endregion
                
                // CRITICAL: Don't prevent default - allow all input including Enter and backspace
                // The event should be allowed to propagate normally
                // #region agent log
                if (input.key === 'Enter') {
                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1647',message:'Enter key in before-input-event, NOT preventing default',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'enter-key-debug',hypothesisId:'C'})}).catch(()=>{});
                    // For Enter key, don't interfere with focus - let the form submit naturally
                    return;
                }
                // #endregion
                
                // Set flag FIRST so focus handler knows user is typing
                this.userIsTyping = true;
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1614',message:'User typing detected, setting userIsTyping=true',data:{key:input.key,type:input.type},timestamp:Date.now(),sessionId:'debug-session',runId:'typing-fix',hypothesisId:'A'})}).catch(()=>{});
                // #endregion
                
                    // Make focusable and ensure window can receive keyboard input
                    // The wrapper will ensure it stays hidden from taskbar
                    // Only make focusable if not already focusable to avoid unnecessary calls
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:2043',message:'request-focus: making window focusable',data:{isFocusableBefore:this.mainWindow.isFocusable?.()},timestamp:Date.now(),sessionId:'debug-session',runId:'focus-debug',hypothesisId:'D'})}).catch(()=>{});
                    // #endregion
                    if (!this.mainWindow.isFocusable?.()) {
                        this.mainWindow.setFocusable(true);
                    }
                    
                    // CRITICAL: Focus the window and ensure text input can receive keyboard input
                    // WS_EX_NOACTIVATE might prevent activation, but we can still receive input
                    try {
                        // #region agent log
                        fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:2051',message:'request-focus: calling focus()',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'focus-debug',hypothesisId:'D'})}).catch(()=>{});
                        // #endregion
                        // Focus the window first
                        this.mainWindow.focus();
                        // Also focus the webContents to ensure it can receive keyboard events
                        this.mainWindow.webContents.focus();
                    
                    // Try to focus the text input element directly
                    this.mainWindow.webContents.executeJavaScript(`
                        (function() {
                            const textInput = document.getElementById('text-input');
                            if (textInput) {
                                textInput.focus();
                                return true;
                            }
                            return false;
                        })();
                    `).catch(() => {});
                    
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1575',message:'Focused window, webContents, and text input for typing',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'A'})}).catch(()=>{});
                    // #endregion
                } catch (e) {
                    // Silently ignore
                }
                
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1570',message:'Made window focusable for typing',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'A'})}).catch(()=>{});
                // #endregion
                
                // Reset after user stops typing (longer timeout to allow for typing)
                if (typingTimeout) clearTimeout(typingTimeout);
                typingTimeout = setTimeout(() => {
                    this.userIsTyping = false;
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1578',message:'User stopped typing, resetting userIsTyping=false',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'post-fix',hypothesisId:'A'})}).catch(()=>{});
                    // #endregion
                    if (this.mainWindow && !this.mainWindow.isDestroyed() && !this.mainWindow.isFocused()) {
                        this.mainWindow.setFocusable(false);
                    }
                }, 3000); // Increased from 2000 to 3000 to give more time for typing
            });
            
            // If window gets focus unexpectedly, restore to previous window
            // BUT: Don't interfere if user is actively typing
            // In stealth mode, always restore focus immediately
            this.mainWindow.on('focus', () => {
                // In stealth mode, immediately restore focus - window should never have focus
                const stealthEnabled = this.getStealthModePreference();
                if (stealthEnabled && process.platform === 'win32') {
                    console.log('🔒 Stealth mode: Window got focus, restoring to previous window');
                    // Immediately restore focus
                    if (windowsHideAltTab) {
                        try {
                            windowsHideAltTab.restoreFocusIfStolen(this.mainWindow);
                        } catch (e) {
                            console.warn('⚠️ Failed to restore focus:', e.message);
                        }
                    }
                    // Make window non-focusable
                    try {
                        this.mainWindow.setFocusable(false);
                    } catch (e) {}
                    return;
                }
                
                // #region agent log
                fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1673',message:'Focus event fired',data:{userIsTyping:this.userIsTyping,isFocusable:this.mainWindow.isFocusable?.(),isFocused:this.mainWindow.isFocused()},timestamp:Date.now(),sessionId:'debug-session',runId:'typing-fix2',hypothesisId:'B'})}).catch(()=>{});
                // #endregion
                
                // CRITICAL: If user is typing, allow focus immediately - don't interfere
                if (this.userIsTyping) {
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1680',message:'Focus event - user is typing, allowing focus',data:{userIsTyping:this.userIsTyping},timestamp:Date.now(),sessionId:'debug-session',runId:'typing-fix2',hypothesisId:'B'})}).catch(()=>{});
                    // #endregion
                    return; // Allow focus for typing - don't interfere
                }
                
                // Use a longer delay to allow before-input-event to set userIsTyping first
                // This prevents race conditions where focus fires before typing is detected
                // Increased delay to 200ms to give more time for typing to start
                setTimeout(() => {
                    // Check again after delay - user might have started typing
                    if (this.userIsTyping) {
                        // #region agent log
                        fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1690',message:'Focus event: user started typing after delay, allowing focus',data:{userIsTyping:this.userIsTyping},timestamp:Date.now(),sessionId:'debug-session',runId:'typing-fix2',hypothesisId:'B'})}).catch(()=>{});
                        // #endregion
                        // User started typing - allow focus
                        return;
                    }
                    
                    // User is not typing - restore focus to previous window
                    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                        // #region agent log
                        fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1695',message:'Focus event: user not typing after delay, restoring focus',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'typing-fix2',hypothesisId:'B'})}).catch(()=>{});
                        // #endregion
                        // Window got focus unexpectedly - restore to previous window
                        // This prevents Canvas from detecting the focus change
                        // Make window non-focusable
                        this.mainWindow.setFocusable(false);
                        
                        // Throttle native API calls to prevent lag (max once per 500ms)
                        const now = Date.now();
                        if (now - lastPreventActivationTime >= 500) {
                            lastPreventActivationTime = now;
                            
                            // Use native API to restore focus to actual foreground window (browser, etc.)
                            if (windowsHideAltTab) {
                                try {
                                    windowsHideAltTab.preventActivation(this.mainWindow);
                                    // #region agent log
                                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1718',message:'Focus event - restored focus using native API',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'typing-fix2',hypothesisId:'B'})}).catch(()=>{});
                                    // #endregion
                                } catch (e) {
                                    // Silently ignore
                                }
                            }
                        }
                    }
                }, 200); // Increased delay to 200ms to give more time for typing to start
            });
        } else {
        this.mainWindow.on('focus', () => {
            // Window is interactive by default, just ensure it's focused
        });
        }

        // Handle window blur - no special handling needed
        this.mainWindow.on('blur', () => {
            // Window stays interactive by default
        });

            // Windows: Handle input events - allow focus only when user is actually typing
        if (process.platform === 'win32') {
            this.mainWindow.webContents.on('before-input-event', (event, input) => {
                // In stealth mode, prevent input events - keyboard hook handles it
                const stealthEnabled = this.getStealthModePreference();
                if (stealthEnabled) {
                    event.preventDefault();
                    console.log('🔒 Stealth mode: Blocked before-input-event (keyboard hook handles input)');
                    return;
                }
                // Only allow focus if user is actually typing (not just showing window)
                // The window will naturally receive focus when user clicks on input
                // Don't force focus here as it can trigger browser blur events
            });
        } else {
        this.mainWindow.webContents.on('before-input-event', (event, input) => {
            // In stealth mode, prevent input events (though stealth mode is Windows-only)
            const stealthEnabled = this.getStealthModePreference();
            if (stealthEnabled) {
                event.preventDefault();
                return;
            }
            // When user tries to type, just focus the window
            if (this.mainWindow && !this.mainWindow.isDestroyed() && !this.mainWindow.isFocused()) {
                this.mainWindow.focus();
            }
        });
        }

        // Windows: Ensure text input can receive focus and keyboard input
        this.mainWindow.webContents.on('dom-ready', () => {
            // Inject script to ensure text input gets focus when clicked
            this.mainWindow.webContents.executeJavaScript(`
                (function() {
                    const textInput = document.getElementById('text-input');
                    console.log('Text input element:', textInput);
                    if (textInput) {
                        // Remove any attributes that might prevent input
                        textInput.removeAttribute('disabled');
                        textInput.removeAttribute('readonly');
                        textInput.tabIndex = 0;
                        textInput.style.pointerEvents = 'auto';
                        
                        // Focus on any interaction and make window interactive
                        const focusAndRequest = function() {
                            console.log('Focusing text input');
                            textInput.focus();
                            if (window.require) {
                                const { ipcRenderer } = window.require('electron');
                                // Make window interactive so we can type
                                ipcRenderer.invoke('set-ignore-mouse-events', false).catch(() => {});
                                ipcRenderer.invoke('request-focus').catch(() => {});
                            }
                        };
                        
                        textInput.addEventListener('click', focusAndRequest, true);
                        textInput.addEventListener('mousedown', focusAndRequest, true);
                        textInput.addEventListener('mouseup', focusAndRequest, true);
                        textInput.addEventListener('focus', function() {
                            console.log('Text input focused');
                            if (window.require) {
                                const { ipcRenderer } = window.require('electron');
                                // Make window interactive so we can type
                                ipcRenderer.invoke('set-ignore-mouse-events', false).catch(() => {});
                                ipcRenderer.invoke('request-focus').catch(() => {});
                            }
                        });
                        
                        // Also try to focus on any mouse event anywhere
                        document.addEventListener('mousedown', function(e) {
                            if (e.target === textInput || textInput.contains(e.target)) {
                                focusAndRequest();
                            }
                        }, true);
                        
                        // Auto-focus after a delay
                        setTimeout(focusAndRequest, 1000);
                    } else {
                        console.error('Text input element not found!');
                    }
                })();
            `).catch((err) => {
                console.error('Failed to inject focus script:', err);
            });
        });
        
        // Windows: Handle any mouse click to ensure window gets focus
        // REMOVED: Global mousedown handler that requests focus
        // This was causing focus stealing even in stealth mode
        // Individual handlers (overlay mousedown, etc.) handle focus requests when needed

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
            // Windows: Desktop capture works without explicit permissions
            return true;
        });
        
        ipcMain.handle('complete-interactive-tutorial', () => {
            this.markOnboardingComplete();
            this.needsInteractiveTutorial = false;
            return true;
        });
        
        // Handle resetting user data for onboarding testing
        ipcMain.handle('reset-user-for-onboarding', async () => {
            try {
                const fs = require('fs');
                const path = require('path');
                const userDataPath = app.getPath('userData');
                
                console.log('🔄 Resetting user data for onboarding testing...');
                
                const filesToRemove = [
                    'onboarding_complete.json',
                    'jarvis_user.json',
                    'subscription_status.json',
                    'voice-shortcut.json',
                    'toggle-shortcut.json',
                    'answer-screen-shortcut.json'
                ];
                
                let removedCount = 0;
                filesToRemove.forEach(fileName => {
                    const filePath = path.join(userDataPath, fileName);
                    if (fs.existsSync(filePath)) {
                        try {
                            fs.unlinkSync(filePath);
                            console.log(`✅ Removed ${fileName}`);
                            removedCount++;
                        } catch (error) {
                            console.error(`⚠️ Error removing ${fileName}:`, error.message);
                        }
                    }
                });
                
                // Reset current user email
                this.currentUserEmail = null;
                
                console.log(`✅ Reset complete! Removed ${removedCount} file(s). Restart the app to see onboarding.`);
                
                return {
                    success: true,
                    message: `Reset complete! Removed ${removedCount} file(s). Restart the app to see onboarding.`,
                    filesRemoved: removedCount
                };
            } catch (error) {
                console.error('❌ Error resetting user data:', error);
                return {
                    success: false,
                    error: error.message || 'Failed to reset user data'
                };
            }
        });

        // Handle overlay toggle
        ipcMain.handle('toggle-overlay', () => {
            this.toggleOverlay();
        });

        // Handle making overlay interactive
        // On Windows, only make interactive if mouse is actually over overlay (handled by region tracking)
        // On other platforms, make it interactive immediately
        ipcMain.handle('make-interactive', () => {
            if (process.platform === 'win32') {
                // On Windows, region tracking handles this automatically
                // Only make interactive if mouse is actually over overlay
                // CRITICAL: Don't make focusable - mouse events work without focus
                // Only make focusable when user is actually typing (handled by before-input-event)
                if (this.isMouseOverOverlay && this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.setIgnoreMouseEvents(false);
                    // Don't make focusable - prevents focus stealing
                    // this.mainWindow.setFocusable(true);
                    return { success: true };
                }
                // If not over overlay, don't make interactive (stay click-through)
                return { success: false, reason: 'mouse not over overlay' };
            } else {
                // On macOS, make it interactive
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.setIgnoreMouseEvents(false);
                    this.mainWindow.setFocusable(true);
                    return { success: true };
                }
                return { success: false };
            }
        });
        
        // Force window to be interactive (bypasses region tracking check)
        // Used for buttons that need to work even when region tracking hasn't detected mouse yet
        ipcMain.handle('force-interactive', () => {
            if (process.platform === 'win32' && this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.setIgnoreMouseEvents(false);
                // Don't make focusable - prevents focus stealing
                // Mouse clicks work without focus
                // this.mainWindow.setFocusable(true);
                // Also update the region tracking state so it stays interactive
                this.isMouseOverOverlay = true;
                // Don't focus - prevents focus stealing
                // this.mainWindow.focus();
                return { success: true };
            } else if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.setIgnoreMouseEvents(false);
                this.mainWindow.setFocusable(true);
                this.mainWindow.focus();
                return { success: true };
            }
            return { success: false };
        });

        // Handle focus request from renderer
        // CRITICAL: request-focus is called when user clicks text input
        // In stealth mode, we don't want to focus - keyboard hook handles input
        ipcMain.handle('request-focus', () => {
            // In stealth mode, don't focus - keyboard hook handles typing
            if (this.getStealthModePreference() && process.platform === 'win32') {
                console.log('🔒 Stealth mode active - ignoring focus request (keyboard hook handles input)');
                return { success: false, reason: 'stealth_mode_active' };
            }
            // #region agent log
            fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1953',message:'request-focus IPC called',data:{isMouseOverOverlay:this.isMouseOverOverlay,platform:process.platform,isFocusable:this.mainWindow?.isFocusable?.(),isFocused:this.mainWindow?.isFocused()},timestamp:Date.now(),sessionId:'debug-session',runId:'typing-fix2',hypothesisId:'A'})}).catch(()=>{});
            // #endregion
            // Don't interfere if account or password reset window is focused
            if (this.accountWindow && !this.accountWindow.isDestroyed() && this.accountWindow.isFocused()) {
                return true;
            }
            if (this.passwordResetWindow && !this.passwordResetWindow.isDestroyed() && this.passwordResetWindow.isFocused()) {
                return true;
            }
            
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                try {
                    // CRITICAL: Always make window focusable when request-focus is called
                    // This is called when user clicks text input, so they want to type
                    // Make window focusable first if it's not
                    if (!this.mainWindow.isFocusable?.()) {
                        // #region agent log
                        fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1968',message:'request-focus: window not focusable, calling setFocusable(true)',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'typing-fix2',hypothesisId:'A'})}).catch(()=>{});
                        // #endregion
                        this.mainWindow.setFocusable(true);
                    }
                    
                    // Also ensure mouse events are enabled
                    this.mainWindow.setIgnoreMouseEvents(false);
                    
                    // CRITICAL: Set userIsTyping flag BEFORE focusing to prevent focus handler from interfering
                    // This ensures the focus handler knows the user wants to type
                    this.userIsTyping = true;
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1972',message:'request-focus: setting userIsTyping=true before focusing',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'typing-fix2',hypothesisId:'A'})}).catch(()=>{});
                    // #endregion
                    
                    // Focus the window so it can receive keyboard input
                    this.mainWindow.focus();
                    this.mainWindow.webContents.focus();
                    
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1978',message:'request-focus: called focus(), checking result',data:{isFocused:this.mainWindow.isFocused(),isFocusable:this.mainWindow.isFocusable?.()},timestamp:Date.now(),sessionId:'debug-session',runId:'typing-fix2',hypothesisId:'A'})}).catch(()=>{});
                    // #endregion
                        return true;
                } catch (e) {
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:1985',message:'request-focus: exception caught',data:{error:e.message},timestamp:Date.now(),sessionId:'debug-session',runId:'typing-fix2',hypothesisId:'A'})}).catch(()=>{});
                    // #endregion
                    return false;
                }
            }
            return false;
        });

        // Handle making overlay click-through - DISABLED on Windows, window stays interactive
        ipcMain.handle('make-click-through', () => {
            // Windows: Don't allow click-through - window must stay interactive
            // if (this.mainWindow) {
            //     this.mainWindow.setIgnoreMouseEvents(true, { forward: true });
            //     this.mainWindow.setFocusable(true);
            // }
        });
        
        // Handle enabling drag-through mode
        ipcMain.handle('enable-drag-through', () => {
            if (this.mainWindow) {
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
                    // NOTE: Content protection on Windows causes videos in other tabs to turn white
                    // due to DWM composition interference. We disable it on Windows.
                    // On macOS, content protection doesn't have this issue.
                    if (process.platform === 'darwin') {
                        // Temporarily ensure content protection is enabled for screenshot (macOS only)
                    // The overlay will stay visible but won't appear in the screenshot
                    console.log('📸 Ensuring content protection is enabled for screenshot');
                    try {
                        this.mainWindow.setContentProtection(true);
                    } catch (e) {
                        // Content protection may not be available on all platforms
                        console.log('Content protection not available:', e.message);
                        }
                    }
                }
                
                // Windows: Desktop capture works without explicit permission
                console.log('📸 Windows: Desktop capture available');
                
                // Use Electron's built-in desktopCapturer with proper error handling
                let sources;
                try {
                    sources = await desktopCapturer.getSources({
                        types: ['screen'],
                        thumbnailSize: { width: 1920, height: 1080 }
                    });
                } catch (capturerError) {
                    console.error('DesktopCapturer error:', capturerError);
                    // Windows: Generic error handling
                    throw new Error(`Failed to capture screen: ${capturerError.message}`);
                }
                
                if (!sources || sources.length === 0) {
                    // Windows: No sources available
                    throw new Error('No screen sources available. Please check your display settings.');
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
            // Windows: Window is interactive by default - don't change it
            // Just focus the window if needed
            if (!shouldIgnore) {
                this.mainWindow.focus();
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



        // Handle adding content to Notes app (macOS) or Notepad/Sticky Notes (Windows)
        ipcMain.handle('add-to-notes', async (event, content) => {
            try {
                const timestamp = new Date().toLocaleString();
                const noteContent = `Jarvis AI Response - ${timestamp}\n\n${content}`;
                
                if (process.platform === 'darwin') {
                    // macOS: Use Notes app via AppleScript
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
                } else if (process.platform === 'win32') {
                    // Windows: Use Notepad
                    const fs = require('fs');
                    const os = require('os');
                    const tempFile = path.join(os.tmpdir(), `jarvis-note-${Date.now()}.txt`);
                    
                    return new Promise((resolve, reject) => {
                        fs.writeFile(tempFile, noteContent, 'utf8', (err) => {
                            if (err) {
                                reject(err);
                            } else {
                                // Open with Notepad
                                exec(`notepad "${tempFile}"`, (error) => {
                                    if (error) {
                                        // Fallback: Try to open with default text editor
                                        shell.openPath(tempFile).then(() => {
                                            resolve('Opened in text editor successfully!');
                                        }).catch(reject);
                                    } else {
                                        resolve('Opened in Notepad successfully!');
                                    }
                                });
                            }
                        });
                    });
                } else {
                    // Linux: Use default text editor
                    const fs = require('fs');
                    const os = require('os');
                    const tempFile = path.join(os.tmpdir(), `jarvis-note-${Date.now()}.txt`);
                    
                    return new Promise((resolve, reject) => {
                        fs.writeFile(tempFile, noteContent, 'utf8', (err) => {
                            if (err) {
                                reject(err);
                            } else {
                                shell.openPath(tempFile).then(() => {
                                    resolve('Opened in text editor successfully!');
                                }).catch(reject);
                            }
                        });
                    });
                }
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
                // Re-register default shortcuts (platform-specific)
                const defaultShortcuts = process.platform === 'darwin'
                    ? ['Command+S', 'Option+V']
                    : ['Ctrl+S', 'Alt+V'];
                
                defaultShortcuts.forEach(shortcut => {
                    try {
                        globalShortcut.register(shortcut, () => { this.toggleVoiceRecording(); });
                    } catch (_) {}
                });
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
            
            // Focus the hotkeys window to ensure it can receive keyboard events
            if (this.hotkeysWindow && !this.hotkeysWindow.isDestroyed()) {
                this.hotkeysWindow.focus();
                this.hotkeysWindow.show();
            }
            
            // If already listening, clean up the old listener first
            if (shortcutListener && this.hotkeysWindow && !this.hotkeysWindow.isDestroyed()) {
                this.hotkeysWindow.webContents.removeListener('before-input-event', shortcutListener);
                shortcutListener = null;
            }
            
            // Reset state
            pressedModifiers.clear();
            pressedKey = null;
            
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
                        if (process.platform === 'darwin') {
                            this.setWindowContentProtection(window, enabled);
                        } else if (process.platform === 'win32' && enabled) {
                            try {
                                window.setContentProtection(true);
                            } catch (e) {}
                        }
                        protectedCount++;
                    }
                });
                
                // Windows: Setup/teardown keyboard hook for stealth typing
                if (process.platform === 'win32' && windowsKeyboardHook) {
                    if (enabled) {
                        // Ensure window stays non-focusable when stealth mode is enabled
                        windows.forEach(window => {
                            if (window && !window.isDestroyed()) {
                                try {
                                    window.setFocusable(false);
                                    window.setIgnoreMouseEvents(true, { forward: true });
                                    console.log('✅ Window set to non-focusable for stealth mode');
                                } catch (e) {
                                    console.warn('⚠️ Failed to set window non-focusable:', e.message);
                                }
                            }
                        });
                        
                        // Install keyboard hook
                        if (windowsKeyboardHook.installKeyboardHook()) {
                            console.log('✅ Keyboard hook installed for stealth typing');
                            
                            // Set callback to forward key events to renderer
                            const callbackSet = windowsKeyboardHook.setKeyEventCallback((keyEvent) => {
                                console.log('🔑 Keyboard hook callback received key event:', keyEvent);
                                // Forward to all windows
                                windows.forEach(window => {
                                    if (window && !window.isDestroyed() && window.webContents) {
                                        window.webContents.send('stealth-key-event', keyEvent);
                                    }
                                });
                            });
                            
                            if (!callbackSet) {
                                console.warn('⚠️ Failed to set keyboard hook callback');
                            } else {
                                console.log('✅ Keyboard hook callback set successfully');
                            }
                            
                            // Enable key consumption (prevent keys from reaching background apps)
                            windowsKeyboardHook.setConsumeKeys(true);
                            console.log('✅ Keyboard hook consuming keys - typing will work without focus');
                        } else {
                            console.warn('⚠️ Failed to install keyboard hook - stealth typing will not work');
                            console.warn('   Make sure to build the native module: cd native/windows-keyboard-hook && npm run rebuild');
                        }
                    } else {
                        // Disable key consumption but keep hook installed
                        if (windowsKeyboardHook.setConsumeKeys) {
                            windowsKeyboardHook.setConsumeKeys(false);
                            console.log('✅ Keyboard hook disabled (keys will pass through)');
                        }
                    }
                } else if (process.platform === 'win32' && !windowsKeyboardHook) {
                    console.warn('⚠️ Keyboard hook module not available - stealth typing will not work');
                    console.warn('   Make sure to build the native module: cd native/windows-keyboard-hook && npm run rebuild');
                }
                
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

        // Push-to-talk IPC handlers - now uses browser-based recording
        ipcMain.handle('start-push-to-talk', async () => {
            // Trigger browser-based recording in renderer
            if (this.mainWindow && !this.isVoiceRecording) {
                this.isVoiceRecording = true;
                this.mainWindow.webContents.send('start-browser-recording');
            }
        });

        ipcMain.handle('stop-push-to-talk', async () => {
            // Browser recording stops itself, just update state
            if (this.isVoiceRecording) {
                this.isVoiceRecording = false;
            }
        });
        
        // Handle audio buffer from renderer for transcription
        ipcMain.handle('transcribe-audio-buffer', async (_event, audioBuffer) => {
            try {
                if (!this.voiceRecorder) {
                    // Try to initialize voice recorder if needed
                    const openaiConfig = this.secureConfig.getOpenAIConfig();
                    const apiKey = openaiConfig?.apiKey || this.openaiApiKey || process.env.OPENAI_API_KEY || '';
                    if (apiKey && apiKey.trim() !== '') {
                        this.voiceRecorder = new VoiceRecorder(apiKey);
                    }
                }
                
                if (!this.voiceRecorder) {
                    throw new Error('Voice recorder not initialized');
                }
                
                // Save buffer to temp file
                const fs = require('fs');
                const path = require('path');
                const os = require('os');
                const tempFile = path.join(os.tmpdir(), `jarvis-recording-${Date.now()}.webm`);
                fs.writeFileSync(tempFile, audioBuffer);
                
                // Transcribe the audio
                const transcribedText = await this.voiceRecorder.transcribeAudio(tempFile);
                
                // Clean up temp file
                try {
                    fs.unlinkSync(tempFile);
                } catch (e) {
                    // Ignore cleanup errors
                }
                
                // Send transcription to renderer
                if (transcribedText && this.mainWindow) {
                    this.mainWindow.webContents.send('voice-transcription', transcribedText);
                }
                
                // Send stopped event
                if (this.mainWindow) {
                    this.mainWindow.webContents.send('voice-recording-stopped');
                }
                
                this.isVoiceRecording = false;
                
                return { success: true, text: transcribedText };
            } catch (error) {
                console.error('Error transcribing audio buffer:', error);
                if (this.mainWindow) {
                    let errorMsg = error.message || 'Voice recording failed';
                    this.mainWindow.webContents.send('voice-recording-error', errorMsg);
                    this.mainWindow.webContents.send('voice-recording-stopped');
                }
                this.isVoiceRecording = false;
                return { success: false, error: error.message };
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
                    openai: openaiConfig?.apiKey || this.openaiApiKey || process.env.OPENAI_API_KEY || '',
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

        // Handle OpenAI API streaming call via main process
        ipcMain.handle('call-openai-api-stream', async (_event, requestPayload, isLowModel = false) => {
            try {
                // Get user email for tracking
                const email = this.currentUserEmail;
                
                // Check user cost limits before making the call
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
                }
                
                // Add stream: true to request payload
                const streamingPayload = {
                    ...requestPayload,
                    stream: true
                };
                
                const supabaseConfig = this.secureConfig.getSupabaseConfig();
                const SUPABASE_URL = supabaseConfig?.url || 'https://nbmnbgouiammxpkbyaxj.supabase.co';
                const SUPABASE_ANON_KEY = supabaseConfig?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibW5iZ291aWFtbXhwa2J5YXhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI1MjEwODcsImV4cCI6MjA3ODA5NzA4N30.ppFaxEFUyBWjwkgdszbvP2HUdXXKjC0Bu-afCQr0YxE';
                const PROXY_URL = `${SUPABASE_URL}/functions/v1/jarvis-api-proxy`;
                
                console.log('🔒 Main process: Calling OpenAI API with streaming via Edge Function');
                // #region agent log
                const logPath = path.join(__dirname, '.cursor', 'debug.log');
                const fs = require('fs');
                const logEntry = JSON.stringify({
                    location: 'main.js:3535',
                    message: 'Starting streaming API call',
                    data: { hasWindow: !!this.mainWindow, isDestroyed: this.mainWindow?.isDestroyed() },
                    timestamp: Date.now(),
                    sessionId: 'debug-session',
                    runId: 'streaming-debug',
                    hypothesisId: 'A'
                }) + '\n';
                try { fs.appendFileSync(logPath, logEntry); } catch (e) {}
                // #endregion
                
                return new Promise((resolve, reject) => {
                    const parsedUrl = new URL(PROXY_URL);
                    const postData = JSON.stringify({
                        provider: 'openai',
                        endpoint: 'responses',
                        payload: streamingPayload
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
                            'Content-Length': Buffer.byteLength(postData),
                            'Accept': 'text/event-stream'
                        },
                        rejectUnauthorized: false
                    };
                    
                    let buffer = '';
                    let fullResponse = '';
                    let usageData = null;
                    let currentEventType = null;
                    let isStreaming = false;
                    let firstChunkReceived = false;
                    
                    const req = https.request(options, (res) => {
                        console.log('📥 Main process OpenAI Streaming: Response status:', res.statusCode);
                        console.log('📥 Content-Type:', res.headers['content-type']);
                        // #region agent log
                        const logPath = path.join(__dirname, '.cursor', 'debug.log');
                        const fs = require('fs');
                        const logEntry = JSON.stringify({
                            location: 'main.js:3578',
                            message: 'Streaming response received',
                            data: { status: res.statusCode, contentType: res.headers['content-type'], hasWindow: !!this.mainWindow },
                            timestamp: Date.now(),
                            sessionId: 'debug-session',
                            runId: 'streaming-debug',
                            hypothesisId: 'A'
                        }) + '\n';
                        try { fs.appendFileSync(logPath, logEntry); } catch (e) {}
                        // #endregion
                        
                        // Check if response is actually streaming (SSE) or regular JSON
                        // Note: Some proxies return SSE with application/json content-type, so we need to check the actual content
                        const contentType = res.headers['content-type'] || '';
                        isStreaming = contentType.includes('text/event-stream') || contentType.includes('text/plain');
                        
                        if (res.statusCode < 200 || res.statusCode >= 300) {
                            let errorData = '';
                            res.on('data', (chunk) => { errorData += chunk; });
                            res.on('end', () => {
                                try {
                                    const parsed = JSON.parse(errorData);
                                    resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: parsed });
                                } catch {
                                    resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: { error: errorData.substring(0, 500) } });
                                }
                            });
                            return;
                        }
                        
                        // Handle data chunks - detect SSE format from content
                        res.on('data', (chunk) => {
                            const chunkStr = chunk.toString();
                            
                            // Detect SSE format from first chunk if not already detected
                            if (!firstChunkReceived) {
                                firstChunkReceived = true;
                                if (chunkStr.trim().startsWith('event:') || chunkStr.includes('\nevent:') || chunkStr.includes('\r\nevent:')) {
                                    isStreaming = true;
                                    console.log('📡 Detected SSE format from content, switching to streaming mode');
                                    // #region agent log
                                    const logPath = path.join(__dirname, '.cursor', 'debug.log');
                                    const fs = require('fs');
                                    const logEntry = JSON.stringify({
                                        location: 'main.js:3627',
                                        message: 'SSE format detected from first chunk',
                                        data: { chunkPreview: chunkStr.substring(0, 100) },
                                        timestamp: Date.now(),
                                        sessionId: 'debug-session',
                                        runId: 'streaming-debug',
                                        hypothesisId: 'H'
                                    }) + '\n';
                                    try { fs.appendFileSync(logPath, logEntry); } catch (e) {}
                                    // #endregion
                                }
                            }
                            
                            // If not streaming, accumulate for JSON parsing
                            if (!isStreaming) {
                                buffer += chunkStr;
                                return;
                            }
                            
                            // Continue with streaming handler for all subsequent chunks
                            buffer += chunkStr;
                            const lines = buffer.split(/\r?\n/);
                            buffer = lines.pop() || '';
                            
                            for (const line of lines) {
                                if (!line.trim()) {
                                    currentEventType = null;
                                    continue;
                                }
                                
                                if (line.startsWith('event: ')) {
                                    currentEventType = line.slice(7).trim();
                                } else if (line.startsWith('data: ')) {
                                    const data = line.slice(6).trim();
                                    if (data === '[DONE]') {
                                        // Handle done
                                        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                            this.mainWindow.webContents.send('openai-stream-chunk', {
                                                content: '',
                                                done: true,
                                                fullResponse: fullResponse
                                            });
                                        }
                                        resolve({ ok: true, status: res.statusCode, fullResponse: fullResponse });
                                        return;
                                    }
                                    
                                    try {
                                        const parsed = JSON.parse(data);
                                        const isDeltaEvent = currentEventType === 'response.output_text.δ' || 
                                                           currentEventType === 'response.output_text.delta' ||
                                                           parsed.type === 'response.outputtext.δ' ||
                                                           parsed.type === 'response.outputtext.delta';
                                        
                                        if (isDeltaEvent) {
                                            const deltaText = parsed.δ || parsed.delta || parsed['δ'] || '';
                                            if (deltaText) {
                                                fullResponse += deltaText;
                                                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                                    this.mainWindow.webContents.send('openai-stream-chunk', {
                                                        content: deltaText,
                                                        done: false
                                                    });
                                                }
                                            }
                                        } else if (currentEventType === 'response.completed' || parsed.type === 'response.completed') {
                                            if (parsed.response?.usage) {
                                                usageData = parsed.response.usage;
                                            }
                                            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                                this.mainWindow.webContents.send('openai-stream-chunk', {
                                                    content: '',
                                                    done: true,
                                                    fullResponse: fullResponse
                                                });
                                            }
                                            if (email && this.supabaseIntegration && usageData && !isLowModel) {
                                                const tokensInput = usageData.input_tokens || usageData.inputtokens || 0;
                                                const tokensOutput = usageData.output_tokens || usageData.outputtokens || 0;
                                                const model = requestPayload.model || 'gpt-4';
                                                
                                                this.supabaseIntegration.recordTokenUsage(
                                                    email, 
                                                    tokensInput, 
                                                    tokensOutput, 
                                                    model, 
                                                    'openai', 
                                                    'chat'
                                                ).then(() => console.log('✅ OpenAI streaming token usage recorded'))
                                                .catch(err => console.error('❌ Failed to record OpenAI streaming token usage:', err));
                                            }
                                            resolve({ ok: true, status: res.statusCode, fullResponse: fullResponse });
                                            return;
                                        }
                                    } catch (e) {
                                        // Ignore parse errors
                                    }
                                }
                            }
                        });
                        
                        // Handle end event (unified handler for both streaming and non-streaming)
                        res.on('end', () => {
                            if (isStreaming) {
                                // Process remaining buffer for streaming
                                if (buffer.trim()) {
                                    const lines = buffer.split(/\r?\n/);
                                    for (const line of lines) {
                                        if (!line.trim()) continue;
                                        if (line.startsWith('event: ')) {
                                            currentEventType = line.slice(7).trim();
                                        } else if (line.startsWith('data: ')) {
                                            const data = line.slice(6).trim();
                                            if (data && data !== '[DONE]') {
                                                try {
                                                    const parsed = JSON.parse(data);
                                                    const isDeltaEvent = currentEventType === 'response.output_text.δ' || 
                                                                       currentEventType === 'response.output_text.delta' ||
                                                                       parsed.type === 'response.outputtext.δ' ||
                                                                       parsed.type === 'response.outputtext.delta';
                                                    
                                                    if (isDeltaEvent) {
                                                        const deltaText = parsed.δ || parsed.delta || parsed['δ'] || '';
                                                        if (deltaText) {
                                                            fullResponse += deltaText;
                                                            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                                                this.mainWindow.webContents.send('openai-stream-chunk', {
                                                                    content: deltaText,
                                                                    done: false
                                                                });
                                                            }
                                                        }
                                                    }
                                                } catch (e) {
                                                    // Ignore
                                                }
                                            }
                                        }
                                    }
                                }
                                
                                // Send final done message
                                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                    this.mainWindow.webContents.send('openai-stream-chunk', {
                                        content: '',
                                        done: true,
                                        fullResponse: fullResponse
                                    });
                                }
                                
                                if (email && this.supabaseIntegration && usageData && !isLowModel) {
                                    const tokensInput = usageData.input_tokens || usageData.inputtokens || 0;
                                    const tokensOutput = usageData.output_tokens || usageData.outputtokens || 0;
                                    const model = requestPayload.model || 'gpt-4';
                                    
                                    this.supabaseIntegration.recordTokenUsage(
                                        email, 
                                        tokensInput, 
                                        tokensOutput, 
                                        model, 
                                        'openai', 
                                        'chat'
                                    ).then(() => console.log('✅ OpenAI streaming token usage recorded'))
                                    .catch(err => console.error('❌ Failed to record OpenAI streaming token usage:', err));
                                }
                                
                                resolve({ ok: true, status: res.statusCode, fullResponse: fullResponse });
                                return;
                            }
                            
                            // Handle non-streaming response
                            if (!isStreaming && buffer) {
                                // Handle as regular JSON
                                let responseData;
                                try {
                                    responseData = JSON.parse(buffer);
                                } catch (parseError) {
                                    console.error('❌ Failed to parse non-streaming response:', parseError);
                                    resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: { error: `Failed to parse response: ${parseError.message}` } });
                                    return;
                                }
                                
                                // Check if the response is actually SSE wrapped in JSON (raw field contains SSE)
                                if (responseData.raw && typeof responseData.raw === 'string' && 
                                    (responseData.raw.trim().startsWith('event:') || responseData.raw.includes('\nevent:'))) {
                                        console.log('📡 Response appears to be SSE format in raw field, parsing as stream');
                                        // It's actually SSE, parse it
                                        const sseLines = responseData.raw.split(/\r?\n/);
                                        let sseEventType = null;
                                        
                                        // Parse SSE from raw field
                                        for (const line of sseLines) {
                                            if (!line.trim()) {
                                                sseEventType = null;
                                                continue;
                                            }
                                            
                                            if (line.startsWith('event: ')) {
                                                sseEventType = line.slice(7).trim();
                                            } else if (line.startsWith('data: ')) {
                                                const sseData = line.slice(6).trim();
                                                if (sseData === '[DONE]') {
                                                    // Stream complete
                                                    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                                        this.mainWindow.webContents.send('openai-stream-chunk', {
                                                            content: '',
                                                            done: true,
                                                            fullResponse: fullResponse
                                                        });
                                                    }
                                                    if (email && this.supabaseIntegration && usageData && !isLowModel) {
                                                        const tokensInput = usageData.input_tokens || usageData.inputtokens || 0;
                                                        const tokensOutput = usageData.output_tokens || usageData.outputtokens || 0;
                                                        const model = requestPayload.model || 'gpt-4';
                                                        
                                                        this.supabaseIntegration.recordTokenUsage(
                                                            email, 
                                                            tokensInput, 
                                                            tokensOutput, 
                                                            model, 
                                                            'openai', 
                                                            'chat'
                                                        ).then(() => console.log('✅ OpenAI streaming token usage recorded'))
                                                        .catch(err => console.error('❌ Failed to record OpenAI streaming token usage:', err));
                                                    }
                                                    resolve({ ok: true, status: res.statusCode, fullResponse: fullResponse });
                                                    return;
                                                }
                                                
                                                try {
                                                    const parsed = JSON.parse(sseData);
                                                    const isDeltaEvent = sseEventType === 'response.output_text.δ' || 
                                                                       sseEventType === 'response.output_text.delta' ||
                                                                       parsed.type === 'response.outputtext.δ' ||
                                                                       parsed.type === 'response.outputtext.delta';
                                                    
                                                    if (isDeltaEvent) {
                                                        const deltaText = parsed.δ || parsed.delta || parsed['δ'] || '';
                                                        if (deltaText) {
                                                            fullResponse += deltaText;
                                                            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                                                this.mainWindow.webContents.send('openai-stream-chunk', {
                                                                    content: deltaText,
                                                                    done: false
                                                                });
                                                            }
                                                        }
                                                    } else if (sseEventType === 'response.completed' || parsed.type === 'response.completed') {
                                                        if (parsed.response?.usage) {
                                                            usageData = parsed.response.usage;
                                                        }
                                                        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                                            this.mainWindow.webContents.send('openai-stream-chunk', {
                                                                content: '',
                                                                done: true,
                                                                fullResponse: fullResponse
                                                            });
                                                        }
                                                        if (email && this.supabaseIntegration && usageData && !isLowModel) {
                                                            const tokensInput = usageData.input_tokens || usageData.inputtokens || 0;
                                                            const tokensOutput = usageData.output_tokens || usageData.outputtokens || 0;
                                                            const model = requestPayload.model || 'gpt-4';
                                                            
                                                            this.supabaseIntegration.recordTokenUsage(
                                                                email, 
                                                                tokensInput, 
                                                                tokensOutput, 
                                                                model, 
                                                                'openai', 
                                                                'chat'
                                                            ).then(() => console.log('✅ OpenAI streaming token usage recorded'))
                                                            .catch(err => console.error('❌ Failed to record OpenAI streaming token usage:', err));
                                                        }
                                                        resolve({ ok: true, status: res.statusCode, fullResponse: fullResponse });
                                                        return;
                                                    }
                                                } catch (e) {
                                                    // Ignore parse errors
                                                }
                                            }
                                        }
                                        return;
                                    }
                                    
                                    // Regular JSON response handling
                                    // responseData is already parsed above
                                    try {
                                        // #region agent log
                                        const logPath = path.join(__dirname, '.cursor', 'debug.log');
                                        const fs = require('fs');
                                        const logEntry1 = JSON.stringify({
                                            location: 'main.js:3621',
                                            message: 'Parsed response data structure',
                                            data: { responseKeys: Object.keys(responseData || {}), hasRaw: !!responseData.raw, rawType: typeof responseData.raw },
                                            timestamp: Date.now(),
                                            sessionId: 'debug-session',
                                            runId: 'streaming-debug',
                                            hypothesisId: 'F'
                                        }) + '\n';
                                        try { fs.appendFileSync(logPath, logEntry1); } catch (e) {}
                                        // #endregion
                                        
                                        // Extract text from response - handle proxy wrapper with 'raw' field
                                        let responseText = '';
                                        let actualResponse = responseData;
                                        
                                        // If response is wrapped in 'raw' field, parse it
                                        if (responseData.raw) {
                                            try {
                                                if (typeof responseData.raw === 'string') {
                                                    actualResponse = JSON.parse(responseData.raw);
                                                } else {
                                                    actualResponse = responseData.raw;
                                                }
                                            } catch (e) {
                                                // If raw is not JSON, use it as text
                                                responseText = String(responseData.raw);
                                            }
                                        }
                                        
                                        // Extract text from actual response - use same logic as extractText in script.js
                                        if (!responseText && actualResponse) {
                                            // Handle Responses API output array
                                            if (actualResponse.output && Array.isArray(actualResponse.output)) {
                                                for (const out of actualResponse.output) {
                                                    // Message type with content
                                                    if (out?.type === 'message' && out?.content) {
                                                        if (typeof out.content === 'string') {
                                                            responseText = out.content;
                                                            break;
                                                        } else if (Array.isArray(out.content)) {
                                                            for (const item of out.content) {
                                                                if ((item.type === "output_text" || item.type === "text") && item.text) {
                                                                    responseText = String(item.text);
                                                                    break;
                                                                }
                                                            }
                                                            if (responseText) break;
                                                        }
                                                    }
                                                    // Direct output_text type
                                                    if (out?.type === 'output_text' && out?.text) {
                                                        responseText = String(out.text);
                                                        break;
                                                    }
                                                    // Role-based content
                                                    if (out?.role === 'assistant' && out?.content) {
                                                        if (typeof out.content === 'string') {
                                                            responseText = out.content;
                                                            break;
                                                        } else if (Array.isArray(out.content)) {
                                                            for (const item of out.content) {
                                                                if ((item.type === "output_text" || item.type === "text") && item.text) {
                                                                    responseText = String(item.text);
                                                                    break;
                                                                }
                                                            }
                                                            if (responseText) break;
                                                        }
                                                    }
                                                    // Content array
                                                    if (out?.content && Array.isArray(out.content)) {
                                                        const textItem = out.content.find(c => c.type === "output_text" || c.type === "text");
                                                        if (textItem?.text) {
                                                            responseText = String(textItem.text);
                                                            break;
                                                        }
                                                    }
                                                    // Direct text
                                                    if (out?.text && typeof out.text === 'string') {
                                                        responseText = out.text;
                                                        break;
                                                    }
                                                    if (typeof out === 'string') {
                                                        responseText = out;
                                                        break;
                                                    }
                                                }
                                            }
                                            
                                            // Handle Chat Completions format
                                            if (!responseText && actualResponse.choices && Array.isArray(actualResponse.choices) && actualResponse.choices.length > 0) {
                                                const choice = actualResponse.choices[0];
                                                if (choice.message?.content) {
                                                    responseText = String(choice.message.content);
                                                } else if (choice.text) {
                                                    responseText = String(choice.text);
                                                }
                                            }
                                            
                                            // Try alternative extraction methods
                                            if (!responseText) {
                                                if (actualResponse.text && typeof actualResponse.text === 'string') {
                                                    responseText = actualResponse.text;
                                                } else if (actualResponse.content && typeof actualResponse.content === 'string') {
                                                    responseText = actualResponse.content;
                                                } else if (actualResponse.message?.content && typeof actualResponse.message.content === 'string') {
                                                    responseText = actualResponse.message.content;
                                                }
                                            }
                                        }
                                        
                                        // Send as single chunk if we got text
                                        // #region agent log
                                        const logEntry2 = JSON.stringify({
                                            location: 'main.js:3675',
                                            message: 'Non-streaming response parsed',
                                            data: { hasText: !!responseText, textLength: responseText.length, hasWindow: !!this.mainWindow },
                                            timestamp: Date.now(),
                                            sessionId: 'debug-session',
                                            runId: 'streaming-debug',
                                            hypothesisId: 'E'
                                        }) + '\n';
                                        try { fs.appendFileSync(logPath, logEntry2); } catch (e) {}
                                        // #endregion
                                        
                                        if (responseText && this.mainWindow && !this.mainWindow.isDestroyed()) {
                                            this.mainWindow.webContents.send('openai-stream-chunk', {
                                                content: responseText,
                                                done: true,
                                                fullResponse: responseText
                                            });
                                        } else {
                                            // #region agent log
                                            const logEntry3 = JSON.stringify({
                                                location: 'main.js:3685',
                                                message: 'Failed to extract text from response',
                                                data: { responseStructure: JSON.stringify(actualResponse).substring(0, 500) },
                                                timestamp: Date.now(),
                                                sessionId: 'debug-session',
                                                runId: 'streaming-debug',
                                                hypothesisId: 'F'
                                            }) + '\n';
                                            try { fs.appendFileSync(logPath, logEntry3); } catch (e) {}
                                            // #endregion
                                        }
                                        
                                        resolve({ ok: true, status: res.statusCode, fullResponse: responseText || '' });
                                    } catch (parseError) {
                                        console.error('❌ Failed to parse non-streaming response:', parseError);
                                        resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: { error: `Failed to parse response: ${parseError.message}` } });
                                    }
                                }
                            });
                        });
                        
                        req.on('error', (error) => {
                            console.error('❌ Main process OpenAI Streaming: Request error:', error);
                            resolve({ ok: false, status: 500, statusText: 'Network Error', data: { error: error.message } });
                        });
                        
                        req.write(postData);
                        req.end();
                    });
                } catch (error) {
                    console.error('❌ Main process OpenAI Streaming: API call failed:', error);
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
                
                // #region agent log
                const fs = require('fs');
                const logPath = 'e:\\Jarvis-windowsOS\\.cursor\\debug.log';
                try {
                    fs.appendFileSync(logPath, JSON.stringify({location:'main.js:3372',message:'Subscription check result received',data:{email,hasSubscription:subscriptionResult.hasSubscription,hasSubscriptionData:!!subscriptionResult.subscription,subscriptionStatus:subscriptionResult.subscription?.status,isError:subscriptionResult.isError,error:subscriptionResult.error},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})+'\n');
                } catch(e) {}
                // #endregion

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
        
        // Ensure window is visible first (without activating)
        if (!this.mainWindow.isVisible()) {
            if (process.platform === 'win32' && windowsHideAltTab) {
                try {
                    windowsHideAltTab.showWithoutActivate(this.mainWindow);
                } catch (e) {
                    this.mainWindow.showInactive();
                }
            } else {
            this.mainWindow.show();
            }
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
            
            // Reinforce content protection (use stealth mode preference)
            // NOTE: Content protection on Windows causes videos in other tabs to turn white
            // due to DWM composition interference. We only enable it on macOS.
            const stealthEnabled = this.getStealthModePreference();
            if (process.platform === 'darwin') {
                this.setWindowContentProtection(this.mainWindow, stealthEnabled);
            }
            // Windows: Content protection disabled to prevent video rendering issues
            
            // One reinforcement after a short delay
            setTimeout(() => {
                if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.isOverlayVisible) return;
                try { this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) { this.mainWindow.setVisibleOnAllWorkspaces(true); }
                try { this.mainWindow.setAlwaysOnTop(true, 'screen-saver'); } catch (_) { try { this.mainWindow.setAlwaysOnTop(true, 'pop-up-menu'); } catch (_) { try { this.mainWindow.setAlwaysOnTop(true, 'floating'); } catch (_) {} } }
                // Reinforce content protection (use stealth mode preference)
                // NOTE: Content protection on Windows causes videos in other tabs to turn white
                // due to DWM composition interference. We only enable it on macOS.
                if (process.platform === 'darwin') {
                    this.setWindowContentProtection(this.mainWindow, stealthEnabled);
                }
                // Windows: Content protection disabled to prevent video rendering issues
                // Don't call moveTop() in loops - it causes flickering/spamming
                // this.mainWindow.moveTop();
            }, 150);
        } catch (error) {
            // If everything fails, at least try to keep the window visible
            console.error('Error forcing fullscreen visibility:', error);
            try {
                if (process.platform === 'win32' && windowsHideAltTab) {
                    try {
                        windowsHideAltTab.showWithoutActivate(this.mainWindow);
                    } catch (e) {
                        this.mainWindow.showInactive();
                    }
                } else {
                this.mainWindow.show();
                }
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
        if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
        
        // Set visibility properties
        try {
            this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        } catch (_) {
            try {
                this.mainWindow.setVisibleOnAllWorkspaces(true);
            } catch (__) {}
        }
        
        // Set always on top
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
        
        // Windows: Content protection (if enabled) - only set once, don't spam
        // Cache stealth mode to avoid repeated file reads
        if (!this._cachedStealthMode) {
            this._cachedStealthMode = this.getStealthModePreference();
        }
        // NOTE: Content protection on Windows causes videos in other tabs to turn white
        // due to DWM composition interference. We disable it on Windows.
        // On macOS, content protection doesn't have this issue, so we keep it there.
        // Windows: Content protection disabled to prevent video rendering issues
        
        // Show window without activating it (prevents focus stealing)
        // #region agent log
        const isVisibleBefore = this.mainWindow.isVisible();
        const boundsBeforeShow = this.mainWindow.getBounds();
        fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:4530',message:'showOverlay - before show',data:{isVisible:isVisibleBefore,bounds:boundsBeforeShow,isMinimized:this.mainWindow.isMinimized()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        if (!this.mainWindow.isVisible()) {
            if (process.platform === 'win32' && windowsHideAltTab) {
                try {
                    windowsHideAltTab.showWithoutActivate(this.mainWindow);
                    // Ensure window is visible
                    this.mainWindow.setOpacity(1.0);
                    // #region agent log
                    const boundsAfter = this.mainWindow.getBounds();
                    const visibleAfter = this.mainWindow.isVisible();
                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:4535',message:'showOverlay - after showWithoutActivate',data:{bounds:boundsAfter,visible:visibleAfter,opacity:1.0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
                    // #endregion
                } catch (e) {
                    console.warn('⚠️ Failed to show without activate, using fallback:', e.message);
                    this.mainWindow.showInactive();
                    this.mainWindow.setOpacity(1.0);
                }
            } else {
            this.mainWindow.show();
            }
        } else {
            // Ensure opacity is 1.0 even if already visible
            if (process.platform === 'win32') {
                try {
                    this.mainWindow.setOpacity(1.0);
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:4548',message:'showOverlay - window already visible, setOpacity(1.0)',data:{opacity:1.0},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
                    // #endregion
                } catch (e) {}
            }
        }
        if (this.mainWindow.isMinimized()) {
            this.mainWindow.restore();
        }
        
        // Windows: Start in click-through mode, make interactive when mouse is over overlay
        // Background app - hidden from taskbar
        if (process.platform === 'win32') {
            this.mainWindow.setSkipTaskbar(true); // Hide from taskbar - background app
            // Start with click-through mode - region tracking will make it interactive on hover
            this.mainWindow.setIgnoreMouseEvents(true, { forward: true });
            
            // In stealth mode, always keep window non-focusable
            const stealthEnabled = this.getStealthModePreference();
            if (stealthEnabled) {
                this.mainWindow.setFocusable(false); // Non-focusable in stealth mode
                console.log('🔒 Stealth mode: Window kept non-focusable');
            } else {
                this.mainWindow.setFocusable(false); // Non-focusable by default - background app
            }
        }
        
        // Mark as visible
        this.isOverlayVisible = true;
        
        // Start region tracking on Windows - makes window interactive only when mouse is over overlay
        if (process.platform === 'win32') {
            // Ensure we start in click-through mode
            this.mainWindow.setIgnoreMouseEvents(true, { forward: true });
            // Region tracking will start when overlay bounds are received
        }
    }
    
    startFullscreenEnforcement() {
        // Clear any existing interval
        if (this.fullscreenEnforcementInterval) {
            clearInterval(this.fullscreenEnforcementInterval);
        }
        
        // DISABLED: Fullscreen enforcement loop - was causing flickering/spamming
        // Windows: Just set properties once, don't enforce in a loop
        this.fullscreenEnforcementInterval = null;
    }
    
    stopFullscreenEnforcement() {
        if (this.fullscreenEnforcementInterval) {
            clearInterval(this.fullscreenEnforcementInterval);
            this.fullscreenEnforcementInterval = null;
        }
    }

    hideOverlay() {
        if (!this.mainWindow) return;
        
        // Clear interactive enforcement interval when hiding
        if (this.interactiveEnforcementInterval) {
            clearInterval(this.interactiveEnforcementInterval);
            this.interactiveEnforcementInterval = null;
        }
        
        // Clear Windows mouse tracking interval when hiding
        if (this.windowsMouseCheckInterval) {
            clearInterval(this.windowsMouseCheckInterval);
            this.windowsMouseCheckInterval = null;
        }
        
        // Clear menu interactive interval when hiding
        if (this.menuInteractiveInterval) {
            clearInterval(this.menuInteractiveInterval);
            this.menuInteractiveInterval = null;
        }
        
        // Clear region tracking start timeout when hiding
        if (this.regionTrackingStartTimeout) {
            clearTimeout(this.regionTrackingStartTimeout);
            this.regionTrackingStartTimeout = null;
        }
        
        
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
                // Only log once to prevent spam
                if (!this._stealthModeLogged) {
                    console.log(`📋 Loaded stealth mode preference: ${enabled ? 'ENABLED' : 'DISABLED'}`);
                    this._stealthModeLogged = true;
                }
                return enabled;
            } else {
                // File doesn't exist, default to enabled
                // Only log once to prevent spam
                if (!this._stealthModeLogged) {
                    console.log('📋 No stealth mode preference found, defaulting to ENABLED');
                    this._stealthModeLogged = true;
                }
                return true;
            }
        } catch (error) {
            console.warn('⚠️ Could not read stealth mode preference, defaulting to enabled:', error);
            return true; // Default to enabled
        }
    }

    // Windows: Set content protection using Electron's built-in API
    setWindowContentProtection(window, enable) {
        if (!window) {
            console.log(`⚠️ Skipping content protection: window not available`);
            return;
        }
        
        try {
            console.log(`🔒 Setting Windows content protection to ${enable ? 'ENABLED' : 'DISABLED'}`);
            
            // Windows: Use Electron's built-in content protection API
            window.setContentProtection(enable);
            
            // For screenshots, also set up detection
            if (enable) {
                this.setupScreenshotDetection();
            } else {
                this.removeScreenshotDetection();
            }
            
            console.log(`✅ Windows content protection ${enable ? 'ENABLED' : 'DISABLED'} successfully`);
        } catch (error) {
            console.error('❌ Failed to set content protection:', error);
        }
    }

    // Windows: Setup screenshot detection to hide overlay when screenshots are taken
    setupScreenshotDetection() {
        if (this.screenshotDetectionSetup) return; // Already setup
        
        this.screenshotDetectionSetup = true;
        console.log('📸 Setting up screenshot detection for stealth mode');
        
        // Windows: Monitor for screenshot shortcuts (Win+Shift+S, PrintScreen, Alt+PrintScreen)
        const screenshotShortcuts = [
            'CommandOrControl+Shift+S',  // Windows Snipping Tool
            'PrintScreen',               // Full screen capture
            'Alt+PrintScreen'            // Active window capture
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
            'CommandOrControl+Shift+S',
            'PrintScreen',
            'Alt+PrintScreen'
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

    // Windows-specific region tracking - make only overlay area interactive
    setupWindowsRegionTracking() {
        if (!this.mainWindow) return;
        
        this.overlayBounds = null;
        this.isMouseOverOverlay = false;
        this.windowsMouseCheckInterval = null;
        this.regionTrackingStartTimeout = null; // Debounce timeout
        this.isMenuOpen = false; // Track if settings menu is open
        
        // Handler to get window bounds for renderer
        ipcMain.handle('get-window-bounds', () => {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                return this.mainWindow.getBounds();
            }
            return null;
        });
        
        // Handler to receive overlay bounds from renderer
        ipcMain.on('update-overlay-bounds', (event, bounds) => {
            this.overlayBounds = bounds;
            // CRITICAL: Don't start region tracking if menu is open
            if (this.isOverlayVisible && process.platform === 'win32' && !this.windowsMouseCheckInterval && !this.isMenuOpen) {
                this.updateWindowsMouseRegion();
            }
            // If menu is open, ensure window stays interactive with new bounds
            // Don't make focusable - mouse events work without focus
            if (this.isMenuOpen && this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.setIgnoreMouseEvents(false);
                // Don't make focusable - prevents focus stealing
                // this.mainWindow.setFocusable(true);
                this.isMouseOverOverlay = true;
            }
        });
        
        // Handler to query menu state from renderer (synchronous check)
        ipcMain.handle('get-menu-state', () => {
            return this.isMenuOpen;
        });
        
        // Handler to receive modal state from renderer (for document selection/name modals)
        ipcMain.on('modal-state-changed', (event, isOpen) => {
            console.log(`📋 [MAIN] Received modal-state-changed: ${isOpen}`);
            // Track modal state
            this.isModalOpen = isOpen;
            if (this.mainWindow && !this.mainWindow.isDestroyed() && process.platform === 'win32') {
                if (isOpen) {
                    // Modal is open - stop region tracking and keep window interactive
                    console.log('📋 Modal opened - STOPPING region tracking');
                    
                    // Stop region tracking interval
                    if (this.windowsMouseCheckInterval) {
                        clearInterval(this.windowsMouseCheckInterval);
                        this.windowsMouseCheckInterval = null;
                    }
                    
                    // Ensure window stays interactive
                    // Don't make focusable - mouse events work without focus
                    this.mainWindow.setIgnoreMouseEvents(false);
                    // Don't make focusable - prevents focus stealing
                    // this.mainWindow.setFocusable(true);
                    // Don't focus - prevents focus stealing
                    // this.mainWindow.focus();
                    this.isMouseOverOverlay = true;
                    
                    // Set up periodic check to keep window interactive while modal is open
                    if (this.modalInteractiveInterval) {
                        clearInterval(this.modalInteractiveInterval);
                    }
                    const keepInteractive = () => {
                        if (this.isModalOpen && this.mainWindow && !this.mainWindow.isDestroyed()) {
                            this.mainWindow.setIgnoreMouseEvents(false);
                            // Don't make focusable - mouse events work without focus
                            // this.mainWindow.setFocusable(true);
                            this.isMouseOverOverlay = true;
                        } else {
                            if (this.modalInteractiveInterval) {
                                clearInterval(this.modalInteractiveInterval);
                                this.modalInteractiveInterval = null;
                            }
                        }
                    };
                    keepInteractive();
                    this.modalInteractiveInterval = setInterval(keepInteractive, 10);
                } else {
                    // Modal closed - restart region tracking if menu is also closed
                    console.log('📋 Modal closed - restarting region tracking');
                    if (this.modalInteractiveInterval) {
                        clearInterval(this.modalInteractiveInterval);
                        this.modalInteractiveInterval = null;
                    }
                    
                    // Only restart region tracking if menu is also closed
                    if (!this.isMenuOpen && this.setupWindowsOverlayTracking) {
                        // Restart region tracking after a short delay
                        setTimeout(() => {
                            if (!this.isMenuOpen && !this.isModalOpen && this.setupWindowsOverlayTracking) {
                                this.startWindowsOverlayTracking();
                            }
                        }, 100);
                    }
                }
            }
        });
        
        // Handler to receive menu state from renderer
        ipcMain.on('menu-state-changed', (event, isOpen) => {
            // #region agent log
            const fs = require('fs');
            const logPath = 'e:\\Jarvis-windowsOS\\.cursor\\debug.log';
            try {
                fs.appendFileSync(logPath, JSON.stringify({location:'main.js:4804',message:'Received menu-state-changed IPC',data:{isOpen,previousState:this.isMenuOpen},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})+'\n');
            } catch(e) {}
            // #endregion
            console.log(`📋 [MAIN] Received menu-state-changed: ${isOpen}`);
            // Set menu state IMMEDIATELY - this is critical
            this.isMenuOpen = isOpen;
            if (this.mainWindow && !this.mainWindow.isDestroyed() && process.platform === 'win32') {
                if (isOpen) {
                    // #region agent log
                    const fs = require('fs');
                    const logPath = 'e:\\Jarvis-windowsOS\\.cursor\\debug.log';
                    try {
                        fs.appendFileSync(logPath, JSON.stringify({location:'main.js:4816',message:'Processing menu open',data:{hasInterval:!!this.windowsMouseCheckInterval,windowExists:!!this.mainWindow,windowDestroyed:this.mainWindow?.isDestroyed()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})+'\n');
                    } catch(e) {}
                    // #endregion
                    // Menu is open - COMPLETELY STOP region tracking and keep window interactive
                    console.log('📋 Menu opened - STOPPING region tracking completely');
                    
                    // COMPLETELY STOP region tracking interval - this is the key
                    if (this.windowsMouseCheckInterval) {
                        console.log('⏸️ Stopping region tracking interval...');
                        clearInterval(this.windowsMouseCheckInterval);
                        this.windowsMouseCheckInterval = null;
                        console.log('⏸️ Region tracking STOPPED');
                        // #region agent log
                        try {
                            fs.appendFileSync(logPath, JSON.stringify({location:'main.js:4825',message:'Region tracking interval cleared',data:{intervalCleared:true},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})+'\n');
                        } catch(e) {}
                        // #endregion
                    }
                    
                    // Ensure window stays interactive immediately
                    // Don't make focusable - mouse events work without focus
                    this.mainWindow.setIgnoreMouseEvents(false);
                    // Don't make focusable - prevents focus stealing
                    // this.mainWindow.setFocusable(true);
                    // Don't focus - prevents focus stealing
                    // this.mainWindow.focus();
                    this.isMouseOverOverlay = true;
                    // #region agent log
                    try {
                        fs.appendFileSync(logPath, JSON.stringify({location:'main.js:4832',message:'Window set to interactive',data:{ignoreMouseEvents:false,focusable:true,isMouseOverOverlay:this.isMouseOverOverlay},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})+'\n');
                    } catch(e) {}
                    // #endregion
                    
                    // Store reference to original method before overriding (only once)
                    if (!this.mainWindow._originalSetIgnoreMouseEvents) {
                        this.mainWindow._originalSetIgnoreMouseEvents = this.mainWindow.setIgnoreMouseEvents.bind(this.mainWindow);
                    }
                    
                    // Override setIgnoreMouseEvents to prevent click-through when menu is open
                    this.mainWindow.setIgnoreMouseEvents = (ignore, options) => {
                        if (this.isMenuOpen && ignore === true) {
                            // Menu is open - NEVER allow click-through, force interactive
                            console.log('🚫 Blocked setIgnoreMouseEvents(true) - menu is open');
                            return this.mainWindow._originalSetIgnoreMouseEvents(false);
                        }
                        return this.mainWindow._originalSetIgnoreMouseEvents(ignore, options);
                    };
                    
                    // Set up VERY aggressive periodic check to keep window interactive while menu is open
                    if (this.menuInteractiveInterval) {
                        clearInterval(this.menuInteractiveInterval);
                    }
                    // Run immediately, then every 10ms to override any click-through attempts
                    const keepInteractive = () => {
                        if (this.isMenuOpen && this.mainWindow && !this.mainWindow.isDestroyed()) {
                            // Force window to stay interactive - override ANY click-through attempts
                            this.mainWindow.setIgnoreMouseEvents(false);
                            // Don't make focusable - mouse events work without focus
                            // this.mainWindow.setFocusable(true);
                            this.isMouseOverOverlay = true;
                        } else {
                            // Menu closed, clear interval
                            if (this.menuInteractiveInterval) {
                                clearInterval(this.menuInteractiveInterval);
                                this.menuInteractiveInterval = null;
                            }
                        }
                    };
                    // Run immediately
                    keepInteractive();
                    // Then run every 10ms - very aggressive
                    this.menuInteractiveInterval = setInterval(keepInteractive, 10);
                } else {
                    // Menu closed - restart region tracking if modal is also closed
                    console.log('📋 Menu closed - restarting region tracking');
                    if (this.menuInteractiveInterval) {
                        clearInterval(this.menuInteractiveInterval);
                        this.menuInteractiveInterval = null;
                    }
                    // Restore original setIgnoreMouseEvents if we overrode it
                    if (this.mainWindow && this.mainWindow.setIgnoreMouseEvents && this.mainWindow.setIgnoreMouseEvents._original) {
                        this.mainWindow.setIgnoreMouseEvents = this.mainWindow.setIgnoreMouseEvents._original;
                    }
                    // Only restore click-through if modal is also closed
                    if (!this.isModalOpen) {
                        // Clear any existing region tracking interval to force restart
                        if (this.windowsMouseCheckInterval) {
                            clearInterval(this.windowsMouseCheckInterval);
                            this.windowsMouseCheckInterval = null;
                        }
                        // Immediately set window to click-through (will be made interactive if mouse is over overlay)
                        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                            this.mainWindow.setIgnoreMouseEvents(true, { forward: true });
                            this.mainWindow.setFocusable(true);
                            this.isMouseOverOverlay = false;
                        }
                        // Restart region tracking if overlay is visible
                        if (this.isOverlayVisible && this.overlayBounds) {
                            // Small delay to ensure menu state is fully updated
                            setTimeout(() => {
                                if (!this.isMenuOpen && !this.isModalOpen && this.isOverlayVisible && this.overlayBounds) {
                                    this.updateWindowsMouseRegion();
                                }
                            }, 50);
                        }
                    }
                }
            }
        });
    }
    
    updateWindowsMouseRegion() {
        if (!this.mainWindow || this.mainWindow.isDestroyed()) {
            return;
        }
        
        // CRITICAL: Don't start region tracking if menu or modal is open
        if (this.isMenuOpen || this.isModalOpen) {
            console.log('⚠️ Cannot start region tracking - menu or modal is open');
            return;
        }
        
        // Don't start if already running
        if (this.windowsMouseCheckInterval) {
            return; // Already running, don't restart
        }
        
        if (!this.overlayBounds) {
            return;
        }
        
        // Ensure we start in click-through mode
        this.mainWindow.setIgnoreMouseEvents(true, { forward: true });
        
        console.log('✅ Starting Windows region tracking with bounds:', this.overlayBounds);
        
        // Start polling to detect when mouse is over overlay
        // Use 50ms interval to prevent freezing - don't run too frequently
        let lastState = null;
        let leaveTimeout = null;
        let lastStateChangeTime = 0;
        const STATE_CHANGE_THROTTLE_MS = 100; // Throttle state changes to prevent lag
        
        // Use 50ms interval to prevent freezing - don't run too frequently
        this.windowsMouseCheckInterval = setInterval(() => {
            // CRITICAL: Check menu/modal state FIRST (synchronously) - no async, no delays
            // If menu or modal is open, completely stop region tracking logic
            if (this.isMenuOpen || this.isModalOpen) {
                // Force window to stay interactive - override any previous state
                lastState = true;
                this.isMouseOverOverlay = true;
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    // Throttle these calls to prevent lag
                    const now = Date.now();
                    if (now - lastStateChangeTime >= STATE_CHANGE_THROTTLE_MS) {
                    this.mainWindow.setIgnoreMouseEvents(false);
                    this.mainWindow.setFocusable(true);
                        lastStateChangeTime = now;
                    }
                }
                // Cancel any pending leave timeout - critical to prevent click-through
                if (leaveTimeout) {
                    clearTimeout(leaveTimeout);
                    leaveTimeout = null;
                }
                // Don't do anything else - just keep window interactive and return immediately
                return;
            }
            
            if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.overlayBounds || !this.isOverlayVisible) {
                if (this.windowsMouseCheckInterval) {
                    clearInterval(this.windowsMouseCheckInterval);
                    this.windowsMouseCheckInterval = null;
                }
                if (leaveTimeout) {
                    clearTimeout(leaveTimeout);
                    leaveTimeout = null;
                }
                return;
            }
            
            try {
                
                const point = screen.getCursorScreenPoint();
                const bounds = this.overlayBounds;
                
                // Add minimal padding only when menu is open for easier interaction
                // No padding when menu is closed to prevent invisible clickable space
                const padding = this.isMenuOpen ? 20 : 0; // Minimal padding only when menu is open
                const isOver = point.x >= bounds.x - padding && 
                               point.x <= bounds.x + bounds.width + padding &&
                               point.y >= bounds.y - padding && 
                               point.y <= bounds.y + bounds.height + padding;
                
                // Only change state if it actually changed AND enough time has passed (throttle)
                const now = Date.now();
                const timeSinceLastChange = now - lastStateChangeTime;
                
                if (isOver && lastState !== true && timeSinceLastChange >= STATE_CHANGE_THROTTLE_MS) {
                    // Cancel any pending leave timeout
                    if (leaveTimeout) {
                        clearTimeout(leaveTimeout);
                        leaveTimeout = null;
                    }
                    // Mouse entered overlay - make interactive
                    lastState = true;
                    this.isMouseOverOverlay = true;
                    lastStateChangeTime = now;
                    // #region agent log
                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:5615',message:'Mouse entered overlay - making interactive',data:{timeSinceLastChange},timestamp:Date.now(),sessionId:'debug-session',runId:'freeze-debug',hypothesisId:'A'})}).catch(()=>{});
                    // #endregion
                    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                        // #region agent log
                        fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:5832',message:'Region tracking: mouse entered overlay',data:{stealthMode:this.getStealthModePreference()},timestamp:Date.now(),sessionId:'debug-session',runId:'focus-debug',hypothesisId:'C'})}).catch(()=>{});
                        // #endregion
                        this.mainWindow.setIgnoreMouseEvents(false);
                        // In stealth mode, don't make focusable
                        const stealthEnabled = this.getStealthModePreference();
                        if (!stealthEnabled) {
                            // #region agent log
                            fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:5832',message:'Setting focusable=true (mouse entered, not stealth)',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'focus-debug',hypothesisId:'C'})}).catch(()=>{});
                            // #endregion
                            this.mainWindow.setFocusable(true);
                        } else {
                            // #region agent log
                            fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:5832',message:'Skipping setFocusable (stealth mode, mouse entered)',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'focus-debug',hypothesisId:'C'})}).catch(()=>{});
                            // #endregion
                        }
                        // REMOVED focus() call - it causes focus stealing and lag
                        // The window will receive input when user clicks without needing focus()
                        console.log('🖱️ Mouse over overlay - made interactive');
                    }
                } else if (!isOver && lastState !== false && !leaveTimeout && !this.isMenuOpen) {
                    // Mouse left overlay - make click-through after a delay
                    // BUT: Don't do this if menu is open!
                    leaveTimeout = setTimeout(() => {
                        // CRITICAL: Check menu state FIRST - if menu is open, NEVER make click-through
                        if (this.isMenuOpen) {
                            lastState = true;
                            this.isMouseOverOverlay = true;
                            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                this.mainWindow.setIgnoreMouseEvents(false);
                                this.mainWindow.setFocusable(true);
                            }
                            leaveTimeout = null;
                            return;
                        }
                        
                        // Double-check menu state again before making click-through
                        if (this.isMenuOpen) {
                            lastState = true;
                            this.isMouseOverOverlay = true;
                            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                // #region agent log
                                fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:5831',message:'Region tracking: menu open',data:{stealthMode:this.getStealthModePreference()},timestamp:Date.now(),sessionId:'debug-session',runId:'focus-debug',hypothesisId:'C'})}).catch(()=>{});
                                // #endregion
                                this.mainWindow.setIgnoreMouseEvents(false);
                                // In stealth mode, don't make focusable
                                const stealthEnabled = this.getStealthModePreference();
                                if (!stealthEnabled) {
                                    // #region agent log
                                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:5831',message:'Setting focusable=true (menu open, not stealth)',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'focus-debug',hypothesisId:'C'})}).catch(()=>{});
                                    // #endregion
                                    this.mainWindow.setFocusable(true);
                                } else {
                                    // #region agent log
                                    fetch('http://127.0.0.1:7242/ingest/91d30b1f-b1ff-43ce-a439-7eb1eb183847',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'main.js:5831',message:'Skipping setFocusable (stealth mode, menu open)',data:{},timestamp:Date.now(),sessionId:'debug-session',runId:'focus-debug',hypothesisId:'C'})}).catch(()=>{});
                                    // #endregion
                                }
                            }
                            leaveTimeout = null;
                            return;
                        }
                        
                        // Double-check mouse is still not over overlay
                        try {
                            const checkPoint = screen.getCursorScreenPoint();
                            const checkBounds = this.overlayBounds;
                            const stillOver = checkPoint.x >= checkBounds.x - padding && 
                                             checkPoint.x <= checkBounds.x + checkBounds.width + padding &&
                                             checkPoint.y >= checkBounds.y - padding && 
                                             checkPoint.y <= checkBounds.y + checkBounds.height + padding;
                            
                            // Triple-check menu state before making click-through
                            if (this.isMenuOpen) {
                                lastState = true;
                                this.isMouseOverOverlay = true;
                                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                    this.mainWindow.setIgnoreMouseEvents(false);
                                    this.mainWindow.setFocusable(true);
                                }
                                leaveTimeout = null;
                                return;
                            }
                            
                            // Don't make click-through if menu is open (double-check)
                            if (!stillOver && this.mainWindow && !this.mainWindow.isDestroyed() && !this.isMenuOpen) {
                                lastState = false;
                                this.isMouseOverOverlay = false;
                                this.mainWindow.setIgnoreMouseEvents(true, { forward: true });
                                console.log('🖱️ Mouse left overlay - made click-through');
                            } else {
                                // Mouse came back, cancel the leave
                                lastState = true;
                                this.isMouseOverOverlay = true;
                                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                    this.mainWindow.setIgnoreMouseEvents(false);
                                    this.mainWindow.setFocusable(true);
                                }
                            }
                        } catch (e) {
                            // On error, keep interactive if menu is open
                            if (this.isMenuOpen) {
                                lastState = true;
                                this.isMouseOverOverlay = true;
                                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                    this.mainWindow.setIgnoreMouseEvents(false);
                                    this.mainWindow.setFocusable(true);
                                }
                            } else if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                                lastState = false;
                                this.isMouseOverOverlay = false;
                                this.mainWindow.setIgnoreMouseEvents(true, { forward: true });
                            }
                        }
                        leaveTimeout = null;
                    }, 300); // 300ms delay before going click-through
                }
            } catch (e) {
                // Ignore errors
            }
        }, 100); // Check every 100ms
    }
}

// Create the app instance
new JarvisApp();
