
const { app, BrowserWindow, ipcMain, screen, desktopCapturer, shell, globalShortcut } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const { POLAR_CONFIG, PolarClient, LicenseManager } = require('./polar-config');
const VoiceRecorder = require('./voice-recorder');
const PolarIntegration = require('./polar-integration');
const PolarSuccessHandler = require('./polar-success-handler');
const PolarWebhookHandler = require('./polar-webhook-handler');
// Removed Google OAuth - using simple payment system
const https = require('https');

class JarvisApp {
    constructor() {
        this.mainWindow = null;
        this.paywallWindow = null;
        this.isOverlayVisible = false;
        this.fullscreenMaintenanceInterval = null;
        this.licenseManager = new LicenseManager(new PolarClient(POLAR_CONFIG));
        // Load secure configuration first
        const SecureConfig = require('./config/secure-config');
        this.secureConfig = new SecureConfig();
        
        // Now create Polar integration with proper config
        this.polarIntegration = new PolarIntegration(this.secureConfig);
        this.polarIntegration.setMainAppInstance(this); // Allow webhooks to notify main app
        this.polarSuccessHandler = new PolarSuccessHandler(this.polarIntegration, this);
        this.polarWebhookHandler = new PolarWebhookHandler(this.secureConfig, this.polarIntegration);
        
        // Get API keys from secure configuration
        const exaConfig = this.secureConfig.getExaConfig();
        const openaiConfig = this.secureConfig.getOpenAIConfig();
        
        this.exaApiKey = exaConfig.apiKey;
        this.currentDocument = null;
        this.openaiApiKey = openaiConfig.apiKey;
        this.voiceRecorder = new VoiceRecorder(this.openaiApiKey);
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
    }

    setupApp() {
        // Handle app ready
        app.whenReady().then(() => {
            this.setupAuthHandlers();
            this.setupVoiceRecording();
            // Go directly to paywall (no sign-in required)
            this.createPaywallWindow();
            
            // Start Polar success handler
            this.polarSuccessHandler.start();
            
            // Start Polar webhook handler
            this.polarWebhookHandler.start();
            
            // Start periodic subscription validation
            this.startSubscriptionValidation();
            
            // Don't validate on startup - rely on webhooks for cancellation updates
            // This prevents false cancellations due to API delays
            console.log('✅ App started - relying on webhooks for subscription updates');
        });

        // Handle window closed
        app.on('window-all-closed', () => {
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
            
            // Register Option+Space for overlay toggle
            globalShortcut.register('Alt+Space', () => {
                this.toggleOverlay();
            });

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

    // Sign-in removed - using simple payment system

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
            if (!this.mainWindow) {
                app.quit();
            }
        });
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
            title: 'Jarvis Settings',
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


    setupAuthHandlers() {
        // Authentication removed - using simple payment system

        // Handle paywall events
        ipcMain.on('paywall-complete', async () => {
            if (this.paywallWindow) {
                this.paywallWindow.close();
                this.paywallWindow = null;
            }
            
            // Check if user has active subscription before proceeding
            try {
                const subscriptionResult = await this.checkSubscriptionStatus();
                
                if (subscriptionResult.hasActiveSubscription) {
                    this.createWindow();
                    this.setupIpcHandlers();
                    // Hide Dock icon on macOS
                    if (process.platform === 'darwin' && app.dock) {
                        app.dock.hide();
                    }
                } else {
                    // Proceed to main app with free tier (limited features)
                    this.createWindow();
                    this.setupIpcHandlers();
                    if (process.platform === 'darwin' && app.dock) {
                        app.dock.hide();
                    }
                }
            } catch (error) {
                console.error('Error checking subscription status:', error);
                // On error, proceed to main app
                this.createWindow();
                this.setupIpcHandlers();
                if (process.platform === 'darwin' && app.dock) {
                    app.dock.hide();
                }
            }
        });

        ipcMain.on('trial-started', async () => {
            // Trial is now active, proceed to main app
            if (this.paywallWindow) {
                this.paywallWindow.close();
                this.paywallWindow = null;
            }
            
            // Always proceed to main app when trial starts
            this.createWindow();
            this.setupIpcHandlers();
            if (process.platform === 'darwin' && app.dock) {
                app.dock.hide();
            }
        });

        ipcMain.on('paywall-skipped', async () => {
            // User chose to skip, proceed with limited features
            if (this.paywallWindow) {
                this.paywallWindow.close();
                this.paywallWindow = null;
            }
            
            // Always proceed to main app when user skips paywall (for free tier)
            this.createWindow();
            this.setupIpcHandlers();
            if (process.platform === 'darwin' && app.dock) {
                app.dock.hide();
            }
        });

        ipcMain.on('paywall-closed', () => {
            // User closed paywall, quit app
            app.quit();
        });

        // Handle open paywall request from main app
        ipcMain.on('open-paywall', () => {
            this.createPaywallWindow();
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

    // Authentication handlers removed - using simple payment system

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
            fullscreenable: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                enableRemoteModule: true
            },
            show: false, // Don't show until ready
            hasShadow: false,
            thickFrame: false
        });

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

        // CRITICAL: Configure fullscreen visibility immediately after window creation
        // This must be set before showing the window for fullscreen apps
        // Try multiple times to ensure it sticks
        this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        
        // Set window level to screen-saver immediately
        this.mainWindow.setAlwaysOnTop(true, 'screen-saver');
        
        // Re-apply after a tiny delay (some properties need a moment to stick)
        setTimeout(() => {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                this.mainWindow.setAlwaysOnTop(true, 'screen-saver');
            }
        }, 50);

        // Load the HTML file
        this.mainWindow.loadFile('index.html').catch(err => {
            console.error('Failed to load index.html:', err);
        });

        // Setup IPC handlers for main window
        this.setupIpcHandlers();

        // Show window when ready
        this.mainWindow.once('ready-to-show', () => {
            this.showOverlay();
            // Start interactable so it's visible and focusable; renderer will enable click-through on mouse leave
            try { this.mainWindow.setIgnoreMouseEvents(false); } catch (_) {}
        });

        // Re-apply fullscreen visibility after page loads (ensures it sticks)
        this.mainWindow.webContents.on('did-finish-load', () => {
            if (this.isOverlayVisible && this.mainWindow) {
                this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                try {
                    this.mainWindow.setAlwaysOnTop(true, 'screen-saver');
                } catch (e) {
                    this.mainWindow.setAlwaysOnTop(true, 'floating');
                }
                this.mainWindow.moveTop();
            }
        });
        
        // Ensure fullscreen visibility when window is shown (critical for fullscreen apps)
        this.mainWindow.on('show', () => {
            if (this.mainWindow) {
                // CRITICAL: Re-apply fullscreen visibility every time window is shown
                this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                try {
                    this.mainWindow.setAlwaysOnTop(true, 'screen-saver');
                } catch (e) {
                    this.mainWindow.setAlwaysOnTop(true, 'floating');
                }
                this.mainWindow.moveTop();
            }
        });
        
        // Handle display changes (e.g., external monitor connected)
        screen.on('display-added', () => {
            if (this.mainWindow && this.isOverlayVisible) {
                this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                try {
                    this.mainWindow.setAlwaysOnTop(true, 'screen-saver');
                } catch (e) {
                    this.mainWindow.setAlwaysOnTop(true, 'floating');
                }
                this.mainWindow.moveTop();
            }
        });
        
        screen.on('display-removed', () => {
            if (this.mainWindow && this.isOverlayVisible) {
                this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                try {
                    this.mainWindow.setAlwaysOnTop(true, 'screen-saver');
                } catch (e) {
                    this.mainWindow.setAlwaysOnTop(true, 'floating');
                }
                this.mainWindow.moveTop();
            }
        });
        
        // Periodically re-apply fullscreen settings (workaround for apps that reset window properties)
        // Clear any existing interval first
        if (this.fullscreenMaintenanceInterval) {
            clearInterval(this.fullscreenMaintenanceInterval);
        }
        this.fullscreenMaintenanceInterval = setInterval(() => {
            // Only run if overlay is supposed to be visible
            if (this.isOverlayVisible && this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.forceFullscreenVisibility();
            }
        }, 250); // Every 250ms
        
        // Monitor app focus changes - when other apps gain focus (e.g., go fullscreen), refresh our window
        app.on('browser-window-focus', (event, window) => {
            // Small delay to let the other app settle, then refresh our window
            setTimeout(() => this.forceFullscreenVisibility(), 100);
        });
        
        app.on('browser-window-blur', (event, window) => {
            // When our window loses focus (another app went fullscreen), aggressively refresh
            if (window === this.mainWindow) {
                setTimeout(() => {
                    this.forceFullscreenVisibility();
                    // Multiple rapid refreshes to catch timing issues
                    setTimeout(() => this.forceFullscreenVisibility(), 50);
                    setTimeout(() => this.forceFullscreenVisibility(), 150);
                }, 50);
            }
        });
        
        // Monitor when window loses/gains focus
        // Note: Don't be too aggressive here as it might interfere with normal operation
        this.mainWindow.on('blur', () => {
            // Another app took focus - could be fullscreen, refresh but don't spam
            if (this.isOverlayVisible) {
                setTimeout(() => {
                    if (this.isOverlayVisible) {
                        this.forceFullscreenVisibility();
                    }
                }, 200);
            }
        });
        
        this.mainWindow.on('focus', () => {
            // We gained focus - refresh settings
            if (this.isOverlayVisible) {
                this.forceFullscreenVisibility();
            }
        });

        this.mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
            console.error('Page failed to load:', errorCode, errorDescription);
        });

        // Handle window closed
        this.mainWindow.on('closed', () => {
            // Clean up the fullscreen maintenance interval
            if (this.fullscreenMaintenanceInterval) {
                clearInterval(this.fullscreenMaintenanceInterval);
                this.fullscreenMaintenanceInterval = null;
            }
            this.mainWindow = null;
        });

        // Note: Removed focus validation to prevent aggressive checking

        // Prevent navigation away from the app
        this.mainWindow.webContents.on('will-navigate', (event) => {
            event.preventDefault();
        });

        // Enable dev tools in development
        if (process.argv.includes('--dev')) {
            this.mainWindow.webContents.openDevTools();
        }
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
            }
        });

        // Handle making overlay click-through
        ipcMain.handle('make-click-through', () => {
            if (this.mainWindow) {
                this.mainWindow.setIgnoreMouseEvents(true, { forward: true });
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
                    throw new Error('Failed to access screen capture. Please check screen recording permissions in System Preferences > Security & Privacy > Privacy > Screen Recording.');
                }
                
                if (!sources || sources.length === 0) {
                    throw new Error('No screen sources available. Please check screen recording permissions.');
                }
                
                // Get the first screen source
                const source = sources[0];
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

        // Open a macOS application by name (whitelisted command via IPC)
        ipcMain.handle('open-application', async (_event, appName) => {
            return new Promise((resolve, reject) => {
                if (!appName || typeof appName !== 'string') {
                    return reject(new Error('Invalid application name'));
                }
                // macOS only implementation
                if (process.platform !== 'darwin') {
                    return reject(new Error('Opening apps is only supported on macOS in this build'));
                }

                // Use `open -a` which searches standard app locations
                const safeName = appName.replace(/"/g, '');
                exec(`open -a "${safeName}"`, (error) => {
                    if (error) {
                        // Fallback: try Applications folder directly
                        exec(`open "/Applications/${safeName}.app"`, (fallbackErr) => {
                            if (fallbackErr) {
                                return reject(new Error(`Failed to open ${safeName}`));
                            }
                            return resolve(`Opened ${safeName}`);
                        });
                    } else {
                        return resolve(`Opened ${safeName}`);
                    }
                });
            });
        });

        // Perform simple actions inside common apps (macOS via AppleScript)
        ipcMain.handle('app-action', async (_event, payload) => {
            return new Promise((resolve, reject) => {
                try {
                    if (process.platform !== 'darwin') {
                        return reject(new Error('App actions supported on macOS only'));
                    }
                    const { appName = '', action = '', query = '' } = payload || {};
                    const appLower = String(appName || '').toLowerCase();
                    const safeQuery = String(query || '').replace(/"/g, '\\"');

                    let script = '';
                    if (appLower.includes('safari')) {
                        if (action === 'new_tab') {
                            script = `tell application "Safari"\nactivate\nif (count of windows) is 0 then\n\tmake new document\nend if\ntell window 1 to make new tab\nend tell`;
                        } else if (action === 'search') {
                            script = `tell application "Safari"\nactivate\nif (count of windows) is 0 then\n\tmake new document\nend if\ntell window 1\n\tset current tab to (make new tab at end of tabs with properties {URL:"https://www.google.com/search?q=${safeQuery}"})\nend tell\nend tell`;
                        } else if (action === 'open_url') {
                            script = `tell application "Safari"\nactivate\nif (count of windows) is 0 then\n\tmake new document\nend if\ntell window 1\n\tset current tab to (make new tab at end of tabs with properties {URL:"${safeQuery}"})\nend tell\nend tell`;
                        } else if (action === 'open_url_background') {
                            // Open URL without focusing Safari
                            return exec(`open -g -a "Safari" "${safeQuery}"`, (err) => {
                                if (err) return reject(err);
                                return resolve('ok');
                            });
                        } else if (action === 'new_google_doc') {
                            return exec(`open -g -a "Safari" "https://docs.new"`, (err) => {
                                if (err) return reject(err);
                                return resolve('ok');
                            });
                        }
                    } else if (appLower.includes('chrome')) {
                        if (action === 'new_tab') {
                            script = `tell application "Google Chrome"\nactivate\nif (count of windows) is 0 then\n\tmake new window\nend if\ntell window 1 to make new tab\nend tell`;
                        } else if (action === 'search') {
                            script = `tell application "Google Chrome"\nactivate\nif (count of windows) is 0 then\n\tmake new window\nend if\ntell window 1\n\tset URL of (make new tab at end of tabs) to "https://www.google.com/search?q=${safeQuery}"\nend tell\nend tell`;
                        } else if (action === 'open_url') {
                            script = `tell application "Google Chrome"\nactivate\nif (count of windows) is 0 then\n\tmake new window\nend if\ntell window 1\n\tset URL of (make new tab at end of tabs) to "${safeQuery}"\nend tell\nend tell`;
                        } else if (action === 'open_url_background') {
                            return exec(`open -g -a "Google Chrome" "${safeQuery}"`, (err) => {
                                if (err) return reject(err);
                                return resolve('ok');
                            });
                        } else if (action === 'new_google_doc') {
                            return exec(`open -g -a "Google Chrome" "https://docs.new"`, (err) => {
                                if (err) return reject(err);
                                return resolve('ok');
                            });
                        }
                    } else if (appLower.includes('notes')) {
                        if (action === 'new_note') {
                            script = `tell application "Notes"\nactivate\nmake new note at folder "Notes" of default account with properties {name:"New Note", body:"${safeQuery}"}\nend tell`;
                        }
                    }

                    if (!script) {
                        return reject(new Error('Unsupported app/action'));
                    }

                    exec(`osascript -e '${script}'`, (error) => {
                        if (error) return reject(error);
                        resolve('ok');
                    });
                } catch (err) {
                    reject(err);
                }
            });
        });

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



        // Handle adding content to Notes app
        ipcMain.handle('add-to-notes', async (event, content) => {
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
                const isFreeAccess = this.checkFreeAccess();
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

        // Removed license activation - using direct subscription checking

        // Moved to setupIpcHandlers() method

        // Handle checking subscription status - REMOVED DUPLICATE

        // Test handler removed - real subscription cancellation now works

        // Handle manual subscription check (Simple API Call)
        ipcMain.handle('check-subscription-manual', async (event, userEmail) => {
            try {
                console.log('Checking subscription via Polar API for:', userEmail);
                
                // Demo mode: Simulate subscription check for testing
                if (userEmail === 'demo@jarvis.com' || userEmail.includes('demo')) {
                    console.log('🎭 Demo mode: Simulating active subscription');
                    const demoSubscriptionData = {
                        email: userEmail,
                        nextBilling: '2024-12-23',
                        features: ['unlimited_messages', 'screenshot_analysis', 'voice_activation'],
                        status: 'active',
                        subscriptionId: 'demo_subscription_123'
                    };
                    
                    await this.storeSubscriptionData(demoSubscriptionData);
                    
                    return {
                        hasActiveSubscription: true,
                        subscriptionData: demoSubscriptionData
                    };
                }
                
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
                console.log('Redirecting to Polar customer portal for subscription management...');
                
                // Read the current subscription data to get the customer email
                const fs = require('fs');
                const path = require('path');
                const userDataPath = path.join(process.env.HOME || process.env.USERPROFILE, 'Library', 'Application Support', 'Jarvis 5.0');
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
                            console.log('Using correct customer portal URL:', customerPortalUrl);
                        }
                    } catch (error) {
                        console.log('Could not read subscription data, using default portal');
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

        // Moved to setupIpcHandlers() method

        // Handle clear subscription data
        ipcMain.handle('clear-subscription-data', async () => {
            try {
                const fs = require('fs');
                const path = require('path');
                
                const userDataPath = path.join(process.env.HOME || process.env.USERPROFILE, 'Library', 'Application Support', 'Jarvis 5.0');
                const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
                
                // Delete the subscription file
                if (fs.existsSync(subscriptionFile)) {
                    fs.unlinkSync(subscriptionFile);
                    console.log('✅ Subscription data cleared');
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
                
                const userDataPath = path.join(process.env.HOME || process.env.USERPROFILE, 'Library', 'Application Support', 'Jarvis 5.0');
                const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
                
                if (!fs.existsSync(subscriptionFile)) {
                    return { success: false, message: 'No subscription file found' };
                }
                
                const localData = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
                console.log('🔄 Manual subscription validation triggered...');
                
                const isValid = await this.validateSubscriptionWithPolar(localData);
                
                if (!isValid) {
                    console.log('❌ Subscription cancelled, removing premium access');
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

        // Test endpoint to manually trigger validation
        ipcMain.handle('test-subscription-validation', async () => {
            console.log('🧪 Manual test of subscription validation triggered');
            await this.performSubscriptionValidation();
            return { success: true, message: 'Validation test completed' };
        });

        // Test endpoint to simulate subscription cancellation
        ipcMain.handle('simulate-subscription-cancellation', async () => {
            console.log('🧪 Simulating subscription cancellation for testing');
            try {
                const fs = require('fs');
                const path = require('path');
                
                const userDataPath = path.join(process.env.HOME || process.env.USERPROFILE, 'Library', 'Application Support', 'Jarvis 5.0');
                const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
                
                if (fs.existsSync(subscriptionFile)) {
                    console.log('🗑️ Removing subscription file to simulate cancellation');
                    fs.unlinkSync(subscriptionFile);
                    
                    // Notify the main window if it's open
                    if (this.mainWindow) {
                        this.mainWindow.webContents.send('subscription-cancelled');
                    }
                    
                    // If the main window is visible, show the paywall
                    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                        this.mainWindow.webContents.send('show-paywall');
                    }
                    
                    return { success: true, message: 'Subscription cancelled (simulated)' };
                } else {
                    return { success: false, message: 'No subscription file found' };
                }
            } catch (error) {
                console.error('Error simulating cancellation:', error);
                return { success: false, error: error.message };
            }
        });

        // Handle immediate subscription check for premium features
        ipcMain.handle('check-subscription-before-premium-action', async () => {
            try {
                const fs = require('fs');
                const path = require('path');
                
                const userDataPath = path.join(process.env.HOME || process.env.USERPROFILE, 'Library', 'Application Support', 'Jarvis 5.0');
                const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
                
                if (!fs.existsSync(subscriptionFile)) {
                    return { hasActiveSubscription: false, shouldShowPaywall: true };
                }
                
                const localData = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
                
                // Perform immediate validation
                const isValid = await this.validateSubscriptionWithPolar(localData);
                
                if (!isValid) {
                    console.log('❌ Subscription invalid, removing premium access');
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
                
                const userDataPath = path.join(process.env.HOME || process.env.USERPROFILE, 'Library', 'Application Support', 'Jarvis 5.0');
                const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
                
                if (!fs.existsSync(subscriptionFile)) {
                    return { 
                        hasActiveSubscription: false, 
                        subscriptionData: null,
                        status: 'free'
                    };
                }
                
                const localData = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
                console.log('🔍 Validating subscription with Polar API...');
                
                // Check with Polar API if subscription is still active
                const isValid = await this.validateSubscriptionWithPolar(localData);
                
                if (!isValid) {
                    console.log('❌ Subscription no longer valid, clearing local data');
                    // Remove local subscription data
                    fs.unlinkSync(subscriptionFile);
                    return { 
                        hasActiveSubscription: false, 
                        subscriptionData: null,
                        status: 'free'
                    };
                }
                
                console.log('✅ Subscription still valid');
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
                console.log('🎯 CREATE CHECKOUT SESSION REQUESTED');
                
                // Use the hardcoded product ID from config
                const polarConfig = this.secureConfig.getPolarConfig();
                console.log('📋 Polar config:', polarConfig);
                
                const productId = polarConfig.productId;
                console.log('🛒 Product ID:', productId);
                
                // Create checkout session
                console.log('🚀 Creating checkout session...');
                const checkoutResult = await this.polarIntegration.createCheckoutSession(productId);
                console.log('✅ Checkout result:', checkoutResult);
                
                if (!checkoutResult.success) {
                    throw new Error(checkoutResult.error || 'Failed to create checkout session');
                }
                
                console.log('🌐 Opening Polar checkout:', checkoutResult.checkoutUrl);
                shell.openExternal(checkoutResult.checkoutUrl);
                
                return { success: true, checkoutUrl: checkoutResult.checkoutUrl };
            } catch (error) {
                console.error('❌ Error creating checkout session:', error);
                return { success: false, error: error.message };
            }
        });

        // Handle checking subscription status
        ipcMain.removeHandler('check-subscription-status');
        ipcMain.handle('check-subscription-status', async () => {
            try {
                const fs = require('fs');
                const path = require('path');
                
                // Use the same path as storeSubscriptionData - user's data directory
                const userDataPath = path.join(process.env.HOME || process.env.USERPROFILE, 'Library', 'Application Support', 'Jarvis 5.0');
                const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
                
                if (fs.existsSync(subscriptionFile)) {
                    const subscriptionData = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
                    console.log('📋 Found subscription data:', subscriptionData);
                    
                    return {
                        status: 'premium',
                        hasActiveSubscription: true,
                        subscriptionData: subscriptionData
                    };
                } else {
                    console.log('ℹ️ No subscription file found');
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
            const userDataPath = path.join(process.env.HOME || process.env.USERPROFILE, 'Library', 'Application Support', 'Jarvis 5.0');
            const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
            
            if (fs.existsSync(subscriptionFile)) {
                const subscriptionData = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
                console.log('📋 Found subscription data:', subscriptionData);
                
                return {
                    status: 'premium',
                    hasActiveSubscription: true,
                    subscriptionData: subscriptionData
                };
            } else {
                console.log('ℹ️ No subscription file found');
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
            console.log('🔍 Starting validation with local data:', localData);
            
            if (!localData || !localData.email) {
                console.log('❌ No email in local data');
                return false;
            }

            console.log(`🔍 Checking subscription status for ${localData.email} with Polar API...`);
            
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
                    const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 5000); // Exponential backoff, max 5s
                    console.log(`🔄 Retry ${retryCount}/${maxRetries} for customer lookup (waiting ${delay}ms)...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
            
            console.log('👤 Customer lookup result:', customer);
            
            if (!customer) {
                console.log('❌ Customer not found in Polar');
                return false;
            }

            console.log(`📋 Found customer with ID: ${customer.id}`);

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
                    const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 5000); // Exponential backoff, max 5s
                    console.log(`🔄 Retry ${retryCount}/${maxRetries} for subscription check (waiting ${delay}ms)...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }
            
            // If we got an error during subscription check, be lenient
            if (lastError) {
                console.log('⚠️ Error during subscription check, keeping access to avoid false cancellation');
                return true;
            }
            
            console.log('📊 Active subscriptions check result:', hasActiveSubscriptions);
            
            if (hasActiveSubscriptions) {
                console.log('✅ Customer has active subscriptions');
                return true;
            } else {
                console.log('❌ Customer has no active subscriptions');
                return false;
            }
            
        } catch (error) {
            console.error('Error validating subscription with Polar:', error);
            // On error, be more lenient - don't remove access due to API issues
            console.log('⚠️ API error - keeping existing access to avoid false cancellations');
            return true; // Keep access on API errors to prevent false cancellations
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
            
            const userDataPath = path.join(process.env.HOME || process.env.USERPROFILE, 'Library', 'Application Support', 'Jarvis 5.0');
            const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
            
            console.log('🔍 Daily subscription validation check...');
            console.log('📁 File exists:', fs.existsSync(subscriptionFile));
            
            if (!fs.existsSync(subscriptionFile)) {
                console.log('ℹ️ No subscription file found');
                return;
            }
            
            const localData = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
            console.log('📋 Local subscription data:', localData);
            
            // Only validate subscriptions older than 24 hours to avoid false cancellations
            const minAgeForValidation = 24 * 60 * 60 * 1000; // 24 hours
            const subscriptionAge = localData.createdAt 
                ? Date.now() - new Date(localData.createdAt).getTime() 
                : Infinity;
            
            if (subscriptionAge < minAgeForValidation) {
                console.log('⏰ Subscription is too new - skipping validation');
                return;
            }
            
            console.log('🔄 Validating subscription (this only runs once per day)...');
            
            const isValid = await this.validateSubscriptionWithPolar(localData);
            console.log('✅ Validation result:', isValid);
            
            if (!isValid) {
                console.log('❌ Subscription no longer active - removing premium access');
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
            } else {
                console.log('✅ Subscription is still valid');
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
            this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
            
            // Try levels in order: screen-saver (best for fullscreen) -> floating (most compatible) -> normal (fallback)
            let levelSet = false;
            
            // Try screen-saver first (best for fullscreen apps)
            try {
                this.mainWindow.setAlwaysOnTop(true, 'screen-saver');
                levelSet = true;
            } catch (screenSaverError) {
                // Try floating next (more compatible)
                try {
                    this.mainWindow.setAlwaysOnTop(true, 'floating');
                    levelSet = true;
                } catch (floatingError) {
                    // Fallback to normal
                    try {
                        this.mainWindow.setAlwaysOnTop(true, 'normal');
                        levelSet = true;
                    } catch (normalError) {
                        console.error('Could not set any window level:', normalError);
                    }
                }
            }
            
            this.mainWindow.moveTop();
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
        if (!this.mainWindow) return;

        if (this.isOverlayVisible) {
            this.hideOverlay();
        } else {
            this.showOverlay();
        }
    }

    showOverlay() {
        if (!this.mainWindow) {
            console.error('Cannot show overlay: mainWindow is null');
            return;
        }
        
        console.log('Showing overlay...');
        
        // Mark as visible FIRST
        this.isOverlayVisible = true;
        
        // Show the window FIRST - this is the most important!
        this.mainWindow.show();
        
        // Immediately apply fullscreen settings using the helper method
        // This ensures consistent window level ordering (screen-saver -> floating -> normal)
        this.forceFullscreenVisibility();
        
        // Bring to front and focus
        this.mainWindow.moveTop();
        this.mainWindow.focus();
        
        // Reinforce fullscreen settings after a short delay (helps catch timing issues)
        setTimeout(() => {
            if (this.mainWindow && !this.mainWindow.isDestroyed() && this.isOverlayVisible) {
                this.forceFullscreenVisibility();
            }
        }, 200);
        
        // Another reinforcement after a longer delay (helps with apps that reset window properties)
        setTimeout(() => {
            if (this.mainWindow && !this.mainWindow.isDestroyed() && this.isOverlayVisible) {
                this.forceFullscreenVisibility();
            }
        }, 1000);
    }

    hideOverlay() {
        if (!this.mainWindow) return;
        
        this.mainWindow.hide();
        this.isOverlayVisible = false;
    }

    async checkFreeAccess() {
        try {
            // Check if free access has been granted in localStorage
            const userDataPath = app.getPath('userData');
            const fs = require('fs');
            const path = require('path');
            
            // Check for free access flag in userData directory
            const freeAccessFile = path.join(userDataPath, 'jarvis-free-access.json');
            if (fs.existsSync(freeAccessFile)) {
                const data = JSON.parse(fs.readFileSync(freeAccessFile, 'utf8'));
                return data.hasFreeAccess === true;
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
            console.log('Free access granted and saved to file');
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
                        console.log('Exa API response:', JSON.stringify(response, null, 2));
                        
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
            const userDataPath = path.join(process.env.HOME || process.env.USERPROFILE, 'Library', 'Application Support', 'Jarvis 5.0');
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

    checkFreeAccess() {
        try {
            const fs = require('fs');
            const path = require('path');
            const userDataPath = path.join(process.env.HOME || process.env.USERPROFILE, 'Library', 'Application Support', 'Jarvis 5.0');
            const freeAccessFile = path.join(userDataPath, 'jarvis-free-access.json');
            
            if (fs.existsSync(freeAccessFile)) {
                const freeAccessData = JSON.parse(fs.readFileSync(freeAccessFile, 'utf8'));
                return freeAccessData.granted === true;
            }
            return false;
        } catch (error) {
            console.error('Error checking free access:', error);
            return false;
        }
    }

    // User data storage removed - using simple payment system

    // Removed old subscription check - using new API-based approach

    // Removed license validation - using direct subscription checking

    async checkActiveSubscription() {
        try {
            const fs = require('fs');
            const path = require('path');
            const userDataPath = path.join(process.env.HOME || process.env.USERPROFILE, 'Library', 'Application Support', 'Jarvis 5.0');
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
            const userDataPath = path.join(process.env.HOME || process.env.USERPROFILE, 'Library', 'Application Support', 'Jarvis 5.0');
            
            if (!fs.existsSync(userDataPath)) {
                fs.mkdirSync(userDataPath, { recursive: true });
            }
            
            const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
            fs.writeFileSync(subscriptionFile, JSON.stringify(subscriptionData, null, 2));
            console.log('Subscription data stored successfully');
        } catch (error) {
            console.error('Error storing subscription data:', error);
        }
    }

    async checkUserSubscriptionViaAPI(userEmail) {
        try {
            console.log('Checking subscription for:', userEmail);
            
            const polarClient = new PolarClient(POLAR_CONFIG);
            
            // Get customer by email
            const customers = await polarClient.getCustomerByEmail(userEmail);
            
            if (customers && customers.length > 0) {
                const customer = customers[0];
                console.log('Customer found:', customer.id);
                
                // Get their subscriptions
                const subscriptions = await polarClient.getSubscriptionStatus(customer.id);
                
                if (subscriptions && subscriptions.length > 0) {
                    const activeSubscription = subscriptions.find(sub => 
                        sub.status === 'active' || sub.status === 'trialing'
                    );
                    
                    if (activeSubscription) {
                        console.log('✅ Active subscription found!');
                        
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
            
            console.log('❌ No active subscription found');
            return { hasSubscription: false };
            
        } catch (error) {
            console.error('Error checking subscription via API:', error);
            return { hasSubscription: false, error: error.message };
        }
    }
}

// Create the app instance
new JarvisApp();
