
const { app, BrowserWindow, ipcMain, screen, desktopCapturer, shell, globalShortcut, systemPreferences } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const { POLAR_CONFIG, PolarClient, LicenseManager } = require('./polar-config');
// const VoiceRecorder = require('./voice-recorder'); // Voice recording temporarily disabled
const PolarIntegration = require('./polar-integration');
const PolarSuccessHandler = require('./polar-success-handler');
const PolarWebhookHandler = require('./polar-webhook-handler');
const https = require('https');

class JarvisApp {
    constructor() {
        this.mainWindow = null;
        this.paywallWindow = null;
        this.onboardingWindow = null;
        this.isOverlayVisible = true;
        this.fullscreenMaintenanceInterval = null;
        this.fullscreenEnforcementInterval = null;
        this.isTransitioningOnboarding = false; // Track onboarding transitions
        this.licenseManager = new LicenseManager(new PolarClient(POLAR_CONFIG));
        // Load secure configuration first
        const SecureConfig = require('./config/secure-config');
        this.secureConfig = new SecureConfig();
        
        // Now create Polar integration with proper config
        this.polarIntegration = new PolarIntegration(this.secureConfig);
        this.polarIntegration.setMainAppInstance(this); // Allow webhooks to notify main app
        this.polarSuccessHandler = new PolarSuccessHandler(this.polarIntegration, this);
        this.polarWebhookHandler = new PolarWebhookHandler(this.secureConfig, this.polarIntegration, this);
        
        // Get API keys from secure configuration
        const exaConfig = this.secureConfig.getExaConfig();
        const openaiConfig = this.secureConfig.getOpenAIConfig();
        
        this.exaApiKey = exaConfig.apiKey;
        this.currentDocument = null;
        this.openaiApiKey = openaiConfig.apiKey;
        // this.voiceRecorder = new VoiceRecorder(this.openaiApiKey); // Voice recording temporarily disabled
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

        // Add global error handlers to prevent crashes
        process.on('uncaughtException', (error) => {
            console.error('Uncaught Exception:', error);
            // Don't crash the app, just log the error
            // On Windows/school computers, this might prevent the app from closing
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            console.error('Unhandled Rejection at:', promise, 'reason:', reason);
            // Don't crash the app, just log the error
        });

        this.setupApp();
    }

    setupApp() {
        // Handle app ready
        app.whenReady().then(async () => {
            this.setupAuthHandlers();
            // this.setupVoiceRecording(); // Voice recording temporarily disabled
            
            // Start Polar success handler
            this.polarSuccessHandler.start();
            
            // Start Polar webhook handler
            this.polarWebhookHandler.start();
            
            // Start periodic subscription validation
            this.startSubscriptionValidation();
            
            // Check subscription status before showing paywall
            try {
                const subscriptionResult = await this.checkSubscriptionStatus();
                
                if (subscriptionResult.hasActiveSubscription) {
                    console.log('✅ User has active subscription, skipping paywall');
                    // Skip paywall and go directly to main window
                    await this.proceedToMainWindow();
                } else {
                    console.log('ℹ️ No active subscription, showing paywall');
                    // Show paywall for non-subscribed users
                    this.createPaywallWindow();
                }
            } catch (error) {
                console.error('Error checking subscription status on startup:', error);
                // On error, show paywall as fallback
                this.createPaywallWindow();
            }
        });

        // Handle window closed
        app.on('window-all-closed', () => {
            // Don't quit if we're transitioning between onboarding screens
            if (this.isTransitioningOnboarding) {
                console.log('Preventing quit during onboarding transition');
                return;
            }
            // Don't quit if we have a main window (it might be hidden)
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                return;
            }
            if (process.platform !== 'darwin') {
                app.quit();
            }
        });

        app.on('before-quit', () => {
            globalShortcut.unregisterAll();
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
            
            // Register multiple toggles to avoid conflicts with macOS/Apps
            try { globalShortcut.register('Alt+Space', () => { this.toggleOverlay(); }); } catch (_) {}
            try { globalShortcut.register('CommandOrControl+Shift+Space', () => { this.toggleOverlay(); }); } catch (_) {}

            // Register Command+Shift+J for voice activation
            globalShortcut.register('CommandOrControl+Shift+J', () => {
                if (this.mainWindow) {
                    this.mainWindow.webContents.send('trigger-voice-activation');
                }
            });
        });

        // Cleanup shortcuts on quit
        app.on('will-quit', () => {
            const { globalShortcut } = require('electron');
            globalShortcut.unregisterAll();
        });
    }


    createPaywallWindow() {
        this.paywallWindow = new BrowserWindow({
            width: 480,
            height: 600,
            center: true,
            resizable: false,
            frame: false,
            transparent: true,
            backgroundColor: '#00000000',
            hasShadow: true,
            titleBarStyle: 'hidden',
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

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

        this.onboardingWindow = new BrowserWindow({
            width: 520,
            height: 750,
            center: true,
            resizable: false,
            frame: false,
            transparent: true,
            backgroundColor: '#00000000',
            hasShadow: true,
            titleBarStyle: 'hidden',
            alwaysOnTop: true,
            show: true,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

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
            this.onboardingWindow = null;
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
        try {
            console.log('showFeaturesOnboarding called');
            // Set flag to prevent app from quitting during transition
            this.isTransitioningOnboarding = true;
            console.log('Transition flag set to true');
            
            // On Windows, skip features screen and go directly to main window
            // This prevents window transition issues
            if (process.platform === 'win32') {
                console.log('Windows detected - skipping features screen, going directly to main window');
                this.isTransitioningOnboarding = false;
                this.markOnboardingComplete();
                this.proceedToMainWindow().catch(err => {
                    console.error('Failed to proceed to main window:', err);
                });
                return;
            }
            
            // For macOS, create new window FIRST, then close old one
            let newWindowCreated = false;
            try {
                console.log('Creating features onboarding window...');
                // Create the features window first
                const oldWindow = this.onboardingWindow;
                this.createOnboardingWindow('features');
                newWindowCreated = true;
                console.log('Features window created successfully');
                
                // Close old window after new one is created
                if (oldWindow && !oldWindow.isDestroyed()) {
                    // Wait a bit for new window to be ready
                    setTimeout(() => {
                        console.log('Closing old onboarding window');
                        if (oldWindow && !oldWindow.isDestroyed()) {
                            oldWindow.close();
                        }
                        // Clear transition flag after a delay
                        setTimeout(() => {
                            this.isTransitioningOnboarding = false;
                            console.log('Transition flag cleared');
                        }, 500);
                    }, 200);
                } else {
                    this.isTransitioningOnboarding = false;
                }
            } catch (error) {
                console.error('Failed to create features onboarding window:', error);
                this.isTransitioningOnboarding = false;
                
                // If features window fails, skip it and go directly to main window
                if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
                    // Keep the current window open
                    console.log('Keeping current window open');
                    return;
                }
                
                // If no window exists, try to proceed to main window
                console.log('No window exists, proceeding to main window');
                this.markOnboardingComplete();
                this.proceedToMainWindow().catch(err => {
                    console.error('Failed to proceed to main window:', err);
                });
            }
        } catch (error) {
            console.error('Error in showFeaturesOnboarding:', error);
            this.isTransitioningOnboarding = false;
            
            // Fallback: Skip features and go directly to main window
            try {
                console.log('Fallback: Skipping features, going to main window');
                this.markOnboardingComplete();
                this.proceedToMainWindow().catch(err => {
                    console.error('Failed to proceed to main window:', err);
                });
            } catch (fallbackError) {
                console.error('Fallback also failed:', fallbackError);
            }
        }
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
            // Windows: Open Privacy settings for screen recording
            // Try multiple methods to ensure it works
            console.log('Attempting to open Windows Privacy settings...');
            
            // Method 1: Try screen capture privacy (Windows 10/11)
            shell.openExternal('ms-settings:privacy-screen').catch(() => {
                console.log('Method 1 failed, trying method 2...');
                // Method 2: Try camera privacy (often includes screen capture)
                shell.openExternal('ms-settings:privacy-webcam').catch(() => {
                    console.log('Method 2 failed, trying method 3...');
                    // Method 3: Open general privacy settings
                    shell.openExternal('ms-settings:privacy').catch(() => {
                        console.log('Method 3 failed, trying method 4...');
                        // Method 4: Use start command as fallback
                        exec('start ms-settings:privacy', (error) => {
                            if (error) {
                                console.error('All methods failed to open Windows Privacy settings:', error);
                                // Last resort: Try opening Settings app directly
                                exec('start ms-settings:', (err) => {
                                    if (err) {
                                        console.error('Failed to open Windows Settings:', err);
                                    }
                                });
                            }
                        });
                    });
                });
            });
        }
    }

    createAccountWindow() {
        // Create a proper window with native controls, positioned at screen edge
        const { screen } = require('electron');
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
        
        const accountWindow = new BrowserWindow({
            width: 480,
            height: 600,
            x: screenWidth - 480, // Position at right edge
            y: 0, // Top of screen
            resizable: true,
            frame: true,
            title: 'Account',
            alwaysOnTop: false,
            modal: false,
            parent: this.mainWindow,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        accountWindow.loadFile('account-window.html');
        
        accountWindow.on('closed', () => {
            this.accountWindow = null;
        });

        this.accountWindow = accountWindow;
        return accountWindow;
    }

    /* Voice recording temporarily disabled
    setupVoiceRecording() {
        // Set up global shortcuts for voice recording
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
                this.mainWindow.webContents.send('voice-recording-error', error.message);
            }
        }
    }


    async stopVoiceRecording() {
        if (!this.isVoiceRecording) return;
        
        this.isVoiceRecording = false;
        
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
                this.mainWindow.webContents.send('voice-recording-error', error.message);
            }
        } finally {
            if (this.mainWindow) {
                this.mainWindow.webContents.send('voice-recording-stopped');
            }
        }
    }
    */


    setupAuthHandlers() {

        // Handle paywall events
        ipcMain.on('paywall-complete', async () => {
            console.log('Paywall complete event received');
            if (this.paywallWindow) {
                this.paywallWindow.close();
                this.paywallWindow = null;
            }
            
            // Proceed to main window
            await this.proceedToMainWindow();
        });

        ipcMain.on('trial-started', async () => {
            // Trial is now active, proceed to main app
            if (this.paywallWindow) {
                this.paywallWindow.close();
                this.paywallWindow = null;
            }
            
            // Check if onboarding is needed
            if (!this.isOnboardingComplete()) {
                this.createOnboardingWindow();
                return;
            }
            
            // Only create window if it doesn't exist
            if (!this.mainWindow || this.mainWindow.isDestroyed()) {
                this.createWindow();
                this.setupIpcHandlers();
                if (process.platform === 'darwin' && app.dock) {
                    app.dock.hide();
                }
            }
        });

        ipcMain.on('paywall-skipped', async () => {
            // User chose to skip, proceed with limited features
            if (this.paywallWindow) {
                this.paywallWindow.close();
                this.paywallWindow = null;
            }
            
            // Proceed to main window
            await this.proceedToMainWindow();
        });

        ipcMain.on('paywall-closed', () => {
            // User closed paywall, quit app
            app.quit();
        });

        // Handle open paywall request from main app
        ipcMain.on('open-paywall', () => {
            this.createPaywallWindow();
        });

        // Handle onboarding events
        ipcMain.on('open-screen-recording-settings', () => {
            try {
                console.log('Opening screen recording settings for platform:', process.platform);
                this.openScreenRecordingSettings();
            } catch (error) {
                console.error('Failed to open screen recording settings:', error);
                // Try to show error to user if onboarding window exists
                if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
                    this.onboardingWindow.webContents.send('settings-error', 'Failed to open settings. Please manually go to Windows Settings > Privacy > Camera.');
                }
            }
        });

        ipcMain.on('onboarding-complete', async () => {
            try {
                console.log('Onboarding complete - showing features screen');
                // Set transition flag
                this.isTransitioningOnboarding = true;
                
                // Permissions screen completed - now show features screen
                // Don't mark onboarding as complete yet, wait for features screen
                this.showFeaturesOnboarding();
            } catch (error) {
                console.error('Error during onboarding completion:', error);
                this.isTransitioningOnboarding = false;
                
                // If features onboarding fails, try to proceed directly to main window
                try {
                    this.markOnboardingComplete();
                    await this.proceedToMainWindow();
                } catch (fallbackError) {
                    console.error('Failed to proceed to main window:', fallbackError);
                    // Show error to user
                    if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
                        this.onboardingWindow.webContents.send('onboarding-error', 'Failed to start application. Please try restarting.');
                    }
                }
            }
        });

        ipcMain.on('onboarding-features-complete', async () => {
            // Clear transition flag since we're moving to main window
            this.isTransitioningOnboarding = false;
            
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
        
        // Get primary display info with error handling
        let width = 1920;
        let height = 1080;
        try {
            const primaryDisplay = screen.getPrimaryDisplay();
            width = primaryDisplay.bounds.width;
            height = primaryDisplay.bounds.height;
        } catch (error) {
            console.error('Failed to get screen dimensions, using defaults:', error);
        }

        // Create a true overlay window
        this.mainWindow = new BrowserWindow({
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
        });

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

        // Add error handlers to prevent crashes
        this.mainWindow.webContents.on('crashed', (event, killed) => {
            console.error('Window crashed:', killed);
            // Try to reload the window
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.reload();
            }
        });

        this.mainWindow.on('unresponsive', () => {
            console.warn('Window became unresponsive');
        });

        // Load the HTML file
        this.mainWindow.loadFile('index.html').catch(err => {
            console.error('Failed to load index.html:', err);
            // Show error to user instead of crashing
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('app-error', 'Failed to load application. Please try restarting.');
            }
        });

        // Setup IPC handlers for main window
        this.setupIpcHandlers();

        // Window is ready; show overlay immediately
        this.mainWindow.once('ready-to-show', () => {
            try { this.mainWindow.setIgnoreMouseEvents(false); } catch (_) {}
            
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
        });

        // Minimal: no repeated reassertions; rely on initial setup and showOverlay()
        

        this.mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
            console.error('Page failed to load:', errorCode, errorDescription);
        });

        // Handle window closed
        this.mainWindow.on('closed', () => {
            this.mainWindow = null;
        });


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

        // Handle overlay toggle
        ipcMain.handle('toggle-overlay', () => {
            this.toggleOverlay();
        });

        // Handle making overlay interactive
        ipcMain.handle('make-interactive', () => {
            if (this.mainWindow) {
                this.mainWindow.setIgnoreMouseEvents(false);
                try { this.mainWindow.setFocusable(true); this.mainWindow.focus(); } catch (_) {}
            }
        });

        // Handle making overlay click-through
        ipcMain.handle('make-click-through', () => {
            if (this.mainWindow) {
                this.mainWindow.setIgnoreMouseEvents(true, { forward: true });
                try { this.mainWindow.setFocusable(false); } catch (_) {}
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

                
                // Use Electron's built-in desktopCapturer with proper error handling
                let sources;
                try {
                    sources = await desktopCapturer.getSources({
                        types: ['screen'],
                        thumbnailSize: { width: 1920, height: 1080 }
                    });
                } catch (capturerError) {
                    console.error('DesktopCapturer error:', capturerError);
                    const platformMessage = process.platform === 'darwin' 
                        ? 'Please check screen recording permissions in System Preferences > Security & Privacy > Privacy > Screen Recording.'
                        : process.platform === 'win32'
                        ? 'Please check screen recording permissions in Windows Settings > Privacy > Camera/Microphone.'
                        : 'Please check screen recording permissions in your system settings.';
                    throw new Error(`Failed to access screen capture. ${platformMessage}`);
                }
                
                if (!sources || sources.length === 0) {
                    const platformMessage = process.platform === 'darwin' 
                        ? 'Please check screen recording permissions in System Preferences.'
                        : process.platform === 'win32'
                        ? 'Please check screen recording permissions in Windows Settings.'
                        : 'Please check screen recording permissions.';
                    throw new Error(`No screen sources available. ${platformMessage}`);
                }
                
                // Get the first screen source
                const source = sources[0];
                if (!source || !source.thumbnail) {
                    throw new Error('Screen source is invalid.');
                }
                const dataUrl = source.thumbnail.toDataURL();
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
                const summary = await summarizeWebsite(url, fullMessage);
                return summary;
            } catch (error) {
                console.error('Error summarizing website:', error);
                return `Error: ${error.message}`;
            }
        });

        // Handle opening account window
        ipcMain.handle('open-account-window', () => {
            this.createAccountWindow();
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


        // Handle manual subscription check (Simple API Call)
        ipcMain.handle('check-subscription-manual', async (event, userEmail) => {
            try {
                // Real API call to Polar using new integration
                const customer = await this.polarIntegration.getCustomerByEmail(userEmail);
                
                if (!customer) {
                    return {
                        hasActiveSubscription: false,
                        error: 'Customer not found'
                    };
                }
                
                const subscriptionResult = await this.polarIntegration.getSubscriptionStatus(customer.id);
                
                if (subscriptionResult.success && subscriptionResult.hasActiveSubscription) {
                    const subscriptionData = {
                        email: userEmail,
                        customerId: customer.id,
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
                const fs = require('fs');
                const path = require('path');
                
                const userDataPath = app.getPath('userData');
                const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
                
                if (!fs.existsSync(subscriptionFile)) {
                    return { hasActiveSubscription: false, shouldShowPaywall: true };
                }
                
                const localData = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
                
                // Perform immediate validation
                const isValid = await this.validateSubscriptionWithPolar(localData);
                
                if (!isValid) {
                    // Remove local subscription data
                    fs.unlinkSync(subscriptionFile);
                    
                    return { hasActiveSubscription: false, shouldShowPaywall: true };
                } else {
                    return { hasActiveSubscription: true, shouldShowPaywall: false };
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
                const polarConfig = this.secureConfig.getPolarConfig();
                const productId = polarConfig.productId;
                const checkoutResult = await this.polarIntegration.createCheckoutSession(productId);
                
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

        // Handle checking subscription status
        // NOTE: This only reads local file - does NOT validate with API
        // Validation happens via webhooks (immediate) and periodic checks (daily)
        ipcMain.removeHandler('check-subscription-status');
        ipcMain.handle('check-subscription-status', async () => {
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

    // Helper method to proceed directly to main window (skipping paywall)
    async proceedToMainWindow() {
        try {
            // Check if onboarding is needed
            const onboardingNeeded = !this.isOnboardingComplete();
            console.log('Onboarding needed?', onboardingNeeded);
            
            if (onboardingNeeded) {
                console.log('Creating onboarding window (skipping paywall)');
                this.createOnboardingWindow();
                return;
            }
            
            // Only create window if it doesn't exist
            if (!this.mainWindow || this.mainWindow.isDestroyed()) {
                console.log('Creating main window...');
                try {
                    this.createWindow();
                    this.setupIpcHandlers();
                    // Hide Dock icon on macOS
                    if (process.platform === 'darwin' && app.dock) {
                        app.dock.hide();
                    }
                    console.log('Main window created successfully');
                } catch (windowError) {
                    console.error('Failed to create main window:', windowError);
                    // Try to show error to user if onboarding window still exists
                    if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
                        this.onboardingWindow.webContents.send('onboarding-error', 'Failed to start application. Please try restarting.');
                    }
                    throw windowError;
                }
            }
        } catch (error) {
            console.error('Error in proceedToMainWindow:', error);
            // Don't crash - log and try to show error
            if (this.onboardingWindow && !this.onboardingWindow.isDestroyed()) {
                this.onboardingWindow.webContents.send('onboarding-error', 'Failed to start application. Please try restarting.');
            }
            throw error;
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
            
            while (retryCount <= maxRetries) {
                try {
                    customer = await this.polarIntegration.getCustomerByEmail(localData.email);
                    break;
                } catch (error) {
                    lastError = error;
                    retryCount++;
                    if (retryCount > maxRetries) {
                        console.error('❌ Customer lookup failed after all retries');
                        break; // Don't throw, just break and handle below
                    }
                    const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
            
            if (!customer) {
                return false;
            }

            // Add retry logic for subscription check
            let hasActiveSubscriptions = false;
            retryCount = 0;
            lastError = null;
            
            while (retryCount <= maxRetries) {
                try {
                    hasActiveSubscriptions = await this.polarIntegration.getSubscriptionStatusByCustomerId(customer.id);
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
            
            if (hasActiveSubscriptions) {
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
            // One reinforcement after a short delay
            setTimeout(() => {
                if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.isOverlayVisible) return;
                try { this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) { this.mainWindow.setVisibleOnAllWorkspaces(true); }
                try { this.mainWindow.setAlwaysOnTop(true, 'screen-saver'); } catch (_) { try { this.mainWindow.setAlwaysOnTop(true, 'pop-up-menu'); } catch (_) { try { this.mainWindow.setAlwaysOnTop(true, 'floating'); } catch (_) {} } }
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
        
        // Show the window
        this.mainWindow.show();
        this.mainWindow.moveTop();
        this.isOverlayVisible = true;
        
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
            
            const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
            fs.writeFileSync(subscriptionFile, JSON.stringify(subscriptionData, null, 2));
        } catch (error) {
            console.error('Error storing subscription data:', error);
        }
    }

    async checkUserSubscriptionViaAPI(userEmail) {
        try {
            
            const polarClient = new PolarClient(POLAR_CONFIG);
            
            // Get customer by email
            const customers = await polarClient.getCustomerByEmail(userEmail);
            
            if (customers && customers.length > 0) {
                const customer = customers[0];
                
                // Get their subscriptions
                const subscriptions = await polarClient.getSubscriptionStatus(customer.id);
                
                if (subscriptions && subscriptions.length > 0) {
                    const activeSubscription = subscriptions.find(sub => 
                        sub.status === 'active' || sub.status === 'trialing'
                    );
                    
                    if (activeSubscription) {
                        
                        const subscriptionData = {
                            email: userEmail,
                            nextBilling: activeSubscription.currentPeriodEnd,
                            features: ['unlimited_messages', 'screenshot_analysis', 'voice_activation'],
                            status: activeSubscription.status,
                            subscriptionId: activeSubscription.id
                        };
                        
                        // Store the subscription data
                        await this.storeSubscriptionData(subscriptionData);
                        
                        return {
                            hasSubscription: true,
                            subscriptionData: subscriptionData
                        };
                    }
                }
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
