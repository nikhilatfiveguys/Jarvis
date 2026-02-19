const { app, BrowserWindow, ipcMain, screen, desktopCapturer, shell, globalShortcut, systemPreferences, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, spawn, spawnSync } = require('child_process');

// Set process title to innocuous name so proctoring (Lockdown, etc.) doesn't detect by process name.
// "VoiceOver" = Apple's screen reader - accessibility tools are rarely blocklisted.
if (process.platform === 'darwin') {
  setImmediate(() => {
    try {
      let stealthOn = true;
      try {
        const { app } = require('electron');
        const userDataPath = app.getPath('userData');
        const stealthFile = path.join(userDataPath, 'stealth_mode.json');
        if (fs.existsSync(stealthFile)) {
          const data = JSON.parse(fs.readFileSync(stealthFile, 'utf8'));
          stealthOn = data.enabled !== false;
        }
      } catch (_) {}
      process.title = stealthOn ? 'VoiceOver' : 'Jarvis';
    } catch (_) {}
  });
}

// If startup fails with a connection/timeout error, the app is likely on iCloud/network storage.
// Show a clear message instead of a raw stack trace.
process.on('uncaughtException', (err) => {
    const msg = err && err.message ? String(err.message) : String(err);
    if (msg.includes('ETIMEDOUT') || msg.includes('connection timed out') || msg.includes('ENOTFOUND')) {
        const { dialog } = require('electron');
        dialog.showErrorBox(
            'Jarvis could not start',
            'This folder is on iCloud Drive, Desktop sync, or a network drive. Files are loading too slowly.\n\n' +
            'Fix for npm start:\n' +
            '• Right-click this project folder (Jarvis-5.0) in Finder → "Download Now" or "Keep on This Mac" so it’s fully local.\n' +
            '• Or move the folder to e.g. ~/Projects/Jarvis-5.0 (not Desktop) and run npm start from there.\n\n' +
            'Technical: ' + msg
        );
        process.exit(1);
    }
});

const OPENROUTER_ADDED_MODELS_FILE = 'jarvis_openrouter_added_models.json';

// Default "More models" in overlay; IDs kept in sync with OpenRouter (openrouter.ai/models)
const DEFAULT_MORE_MODELS = [
    { id: 'anthropic/claude-opus-4.6', name: 'Claude Opus 4.6', description: "Anthropic's most capable" },
    { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', description: 'Best for coding' },
    { id: 'meta-llama/llama-4-maverick', name: 'Llama 4 Maverick', description: "Meta's latest" },
    { id: 'moonshotai/kimi-k2.5', name: 'Kimi K2.5', description: 'Moonshot AI' }
];

// Handle Squirrel events for macOS auto-updates
// This MUST be at the very top before anything else
if (process.platform === 'darwin') {
    const handleSquirrelEvent = () => {
        if (process.argv.length === 1) {
            return false;
        }

        const squirrelEvent = process.argv[1];
        switch (squirrelEvent) {
            case '--squirrel-install':
            case '--squirrel-updated':
                app.quit();
                return true;
            case '--squirrel-uninstall':
                app.quit();
                return true;
            case '--squirrel-obsolete':
                app.quit();
                return true;
        }
        return false;
    };

    if (handleSquirrelEvent()) {
        process.exit(0);
    }
}

// Delay loading electron-updater until app is ready (fail gracefully so app still opens)
let autoUpdater = null;
let autoUpdaterLoadError = null;
function getAutoUpdater() {
    if (autoUpdaterLoadError) return null;
    if (!autoUpdater) {
        try {
            autoUpdater = require('electron-updater').autoUpdater;
            autoUpdater.setFeedURL({
                provider: 'github',
                owner: 'nikhilatfiveguys',
                repo: 'Jarvis',
                releaseType: 'release'
            });
        } catch (e) {
            autoUpdaterLoadError = e;
            console.warn('[updater] Could not load electron-updater:', e.message);
            return null;
        }
    }
    return autoUpdater;
}
// Heavy modules are loaded lazily (in initializeIntegrations / constructor) so the app
// can start from iCloud/Desktop without ETIMEDOUT on first load.
const https = require('https');

let _uiohookCache = null;
function getUiohook() {
    if (_uiohookCache === null) {
        if (app.isPackaged) {
            console.log('⚠️ uiohook-napi skipped in packaged app (avoids launch crash)');
            _uiohookCache = { uIOhook: null, UiohookKey: null };
        } else {
            try {
                const m = require('uiohook-napi');
                _uiohookCache = { uIOhook: m.uIOhook, UiohookKey: m.UiohookKey };
                console.log('✅ uiohook-napi loaded for global push-to-talk');
            } catch (e) {
                console.log('⚠️ uiohook-napi not available - global push-to-talk disabled.');
                _uiohookCache = { uIOhook: null, UiohookKey: null };
            }
        }
    }
    return _uiohookCache;
}

class JarvisApp {
    constructor() {
        this.mainWindow = null;
        this.accountWindow = null;
        this.passwordResetWindow = null;
        this.openrouterModelsWindow = null;
        this.openrouterAddedModels = [];
        this.openrouterRemovedDefaults = [];
        this.hotkeysWindow = null;
        this.browserTabWindow = null;
        this.hudBlurWindow = null; // macOS: small window with vibrancy behind HUD for real blur
        this.isOverlayVisible = true;
        this.fullscreenMaintenanceInterval = null;
        this.fullscreenEnforcementInterval = null;
        this.overlayHoverActivateInterval = null; // when overlay is shown, poll until cursor enters then make interactive
        this.overlayScreenRect = null; // screen coords of overlay pill/UI for hover-to-activate (avoids blocking clicks elsewhere)
        this.lastRecreateAfterCloseAt = 0; // Throttle recreate when Lockdown closes our window
        this.lastRescueSpawnAt = 0; // When we last spawned a rescue process (relaunch if killed by Lockdown)
        this.quittingFromOverlayMenu = false; // Only allow quit when user clicks "Quit Jarvis" in overlay (or update)
        this.lowProfileMode = false; // When true: don't use overlay levels (avoid Lockdown detecting us)
        this.lastBlurredAt = 0;
        this.screenRecordingCheckInterval = null; // Track screen recording detection
        this.currentUserEmail = null; // Track current user for token usage
        this.wasVisibleBeforeRecording = false; // Track if window was visible before recording
        this.screenshotDetectionSetup = false; // Track screenshot detection setup
        this.nativeContentProtection = null;
        this._nativeContentProtectionLoaded = false;
        // Native module is loaded lazily in getNativeContentProtection() to avoid crash when run from DMG
        this.licenseManager = null;
        this.secureConfig = null;
        this.supabaseIntegration = null;
        this.polarIntegration = null;
        this.polarSuccessHandler = null;
        this.polarWebhookHandler = null;
        this.googleDocsIntegration = null;
        this.googleCalendarIntegration = null;
        this.gmailIntegration = null;
        this.currentDocument = null;
        this.openaiApiKey = '';
        this._integrationsInitialized = false;
        this._subscriptionCache = null; // { result, at } - skip Supabase for 60s when we have recent premium
        const gotLock = app.requestSingleInstanceLock();
        if (!gotLock) {
            app.whenReady().then(() => {
                const { dialog } = require('electron');
                dialog.showMessageBoxSync({
                    type: 'info',
                    title: 'Jarvis',
                    message: 'Jarvis is already running.',
                    detail: 'Check the menu bar or use Alt+Space to open the overlay. Quit the other instance from the overlay menu (Quit Jarvis) if you need to restart.'
                });
            }).finally(() => app.quit());
            return;
        }

        // Show existing window if a second instance is launched. On macOS never focus — Lockdown detects focus steal.
        app.on('second-instance', () => {
            if (!this.mainWindow) return;
            if (this.mainWindow.isMinimized()) this.mainWindow.restore();
            this.mainWindow.show();
            if (process.platform !== 'darwin') this.mainWindow.focus();
            // macOS: do NOT focus — keeps Lockdown Browser from detecting app switch
        });

        // Register IPC handlers immediately so they exist before any window loads (avoids "No handler registered" errors)
        this.setupIpcHandlers();
        this.setupApp();
        // Auto-updater will be set up after app is ready
    }

    getNativeContentProtection() {
        if (this._nativeContentProtectionLoaded) return this.nativeContentProtection;
        this._nativeContentProtectionLoaded = true;
        if (process.platform !== 'darwin') return null;
        if (process.env.ELECTRON_SKIP_NATIVE_CONTENT_PROTECTION === '1') {
            console.warn('⚠️ Native content protection skipped (env)');
            return null;
        }
        try {
            this.nativeContentProtection = require('./native/mac-content-protection');
            console.log('✅ Native content protection module loaded');
            return this.nativeContentProtection;
        } catch (error) {
            console.warn('⚠️ Native content protection module not available:', error.message);
            return null;
        }
    }

    getFallbackSecureConfig() {
        const prod = require('./config/production-config');
        return {
            getSupabaseConfig: () => prod.supabase,
            getSupabaseApiProxyUrl: () => prod.supabase?.apiProxyUrl || '',
            getPolarConfig: () => prod.polar,
            getOpenAIConfig: () => prod.openai,
            getExaConfig: () => prod.exa,
            getClaudeConfig: () => prod.claude || { apiKey: '' },
            getPerplexityConfig: () => prod.perplexity || { apiKey: '' },
            getOpenRouterConfig: () => prod.openrouter || { apiKey: '' },
            getGoogleConfig: () => prod.google || {},
            getComposioConfig: () => prod.composio || {},
            getResendConfig: () => prod.resend || {},
            isProduction: () => false
        };
    }

    initializeIntegrations() {
        if (this._integrationsInitialized) return;
        this._integrationsInitialized = true;
        try {
            const SecureConfig = require('./config/secure-config');
            const { getPOLAR_CONFIG, PolarClient, LicenseManager } = require('./polar-config');
            const SupabaseIntegration = require('./supabase-integration');
            const PolarIntegration = require('./polar-integration');
            const PolarSuccessHandler = require('./polar-success-handler');
            const PolarWebhookHandler = require('./polar-webhook-handler');
            const GoogleCalendarIntegration = require('./google-calendar-integration');
            const GmailIntegration = require('./gmail-integration');
            this.secureConfig = new SecureConfig();
            this.supabaseIntegration = new SupabaseIntegration(this.secureConfig);
            this.supabaseIntegration.setMainAppInstance(this);
            this.polarIntegration = new PolarIntegration(this.secureConfig);
            this.polarIntegration.setMainAppInstance(this);
            this.polarSuccessHandler = new PolarSuccessHandler(this.polarIntegration, this);
            this.polarWebhookHandler = new PolarWebhookHandler(this.secureConfig, this.polarIntegration, this);
            this.googleDocsIntegration = null; // Google Docs / Write to Docs removed from build
            this.googleCalendarIntegration = new GoogleCalendarIntegration(this.secureConfig);
            this.gmailIntegration = new GmailIntegration(this.secureConfig);
            const openaiConfig = this.secureConfig.getOpenAIConfig();
            this.openaiApiKey = (openaiConfig && openaiConfig.apiKey) ? openaiConfig.apiKey : '';
            this.licenseManager = new LicenseManager(new PolarClient(getPOLAR_CONFIG(this.secureConfig)));
        } catch (err) {
            console.error('initializeIntegrations failed, using fallback config:', err);
            this.secureConfig = this.getFallbackSecureConfig();
            this.polarIntegration = null;
            this.polarSuccessHandler = null;
            this.polarWebhookHandler = null;
            this.googleCalendarIntegration = null;
            this.gmailIntegration = null;
            const openaiConfig = this.secureConfig.getOpenAIConfig();
            this.openaiApiKey = (openaiConfig && openaiConfig.apiKey) ? openaiConfig.apiKey : '';
            this.licenseManager = null;
            // Still init Supabase so sign-in and subscription check work (config has default url/anonKey)
            try {
                const SupabaseIntegration = require('./supabase-integration');
                this.supabaseIntegration = new SupabaseIntegration(this.secureConfig);
                this.supabaseIntegration.setMainAppInstance(this);
                console.log('✅ Supabase initialized with fallback config (subscription/sign-in available)');
            } catch (supabaseErr) {
                console.warn('Supabase init failed with fallback config:', supabaseErr.message);
                this.supabaseIntegration = null;
            }
        }
    }

    setupAutoUpdater() {
        const updater = getAutoUpdater();
        if (!updater) return; // e.g. missing lazy-val or other dep - don't block startup
        console.log('[updater] Feed URL set: github nikhilatfiveguys/Jarvis, app version:', app.getVersion());
        updater.autoDownload = true; // Auto-download updates when available
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
            const u = getAutoUpdater();
            if (u) u.checkForUpdates().catch(() => {});
        }, 4 * 60 * 60 * 1000); // 4 hours

        // Check for updates on startup (after a LONG delay to not slow down startup)
        setTimeout(() => {
            const u = getAutoUpdater();
            if (u) u.checkForUpdates().catch(() => {});
        }, 30000); // 30 seconds after app ready
        
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
            const msg = err && err.message ? err.message : String(err);
            if (msg.includes('504') || msg.includes('timeout') || msg.includes('time-out') || msg.includes('Gateway')) {
                return; // Silently ignore network/timeout
            }
            console.error('[updater] Error:', msg);
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('update-check-error', msg);
            }
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
            if (process.platform === 'darwin') {
                try { fs.unlinkSync(path.join(app.getPath('userData'), '.jarvis-quitting')); } catch (_) {}
            }
            // One-time migration: copy subscription/data from AXRuntime or jarvis-6.0 if Jarvis folder is empty
            try {
                const userDataPath = app.getPath('userData');
                const toCopy = ['subscription_status.json', 'jarvis_user.json', 'stealth_mode.json', 'jarvis_openrouter_added_models.json', 'answer-screen-shortcut.json', 'onboarding_complete.json'];
                const appDir = path.dirname(userDataPath);
                for (const fromDir of ['AXRuntime', 'jarvis-6.0']) {
                    const srcPath = path.join(appDir, fromDir);
                    if (srcPath === userDataPath) continue;
                    if (!fs.existsSync(srcPath)) continue;
                    for (const f of toCopy) {
                        const src = path.join(srcPath, f);
                        const dst = path.join(userDataPath, f);
                        if (fs.existsSync(src) && !fs.existsSync(dst)) {
                            fs.copyFileSync(src, dst);
                            console.log('[migration] Copied', f, 'from', fromDir, 'to Jarvis');
                        }
                    }
                }
            } catch (_) {}
            try {
                this.initializeIntegrations();
            } catch (err) {
                console.error('initializeIntegrations failed:', err);
            }

            setImmediate(() => {
                this.setupAuthHandlers();
                this.loadCurrentUserEmail();
            });
            setImmediate(() => {
                this.setupAutoUpdater();
                this.requestScreenRecordingPermission();
                if (this.polarSuccessHandler) this.polarSuccessHandler.start();
                if (this.polarWebhookHandler) this.polarWebhookHandler.start();
                this.startSubscriptionValidation();
            });

            this.createWindow();
            if (app.isPackaged && process.platform === 'darwin' && app.dock) {
                app.dock.hide();
            }
            setImmediate(() => this.showOverlay());
        });

        // Handle window closed
        app.on('window-all-closed', () => {
            if (this.mainWindow) {
                return;
            }
            if (process.platform !== 'darwin') {
                app.quit();
            }
        });

        app.on('before-quit', (e) => {
            // Only allow quit when user clicked "Quit Jarvis" in overlay, or update install
            if (!this.quittingFromOverlayMenu) {
                e.preventDefault();
                return;
            }
            app.isQuitting = true;
            if (process.platform === 'darwin') {
                try { fs.writeFileSync(path.join(app.getPath('userData'), '.jarvis-quitting'), '1', 'utf8'); } catch (_) {}
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    try { this.mainWindow.setClosable(true); } catch (_) {}
                }
                // LSUIElement (agent) apps stay running when windows close - force exit
                setImmediate(() => process.exit(0));
            }
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

            // Load and register answer screen shortcut
            this.loadAnswerScreenShortcut();
            
            // Setup cleanup handlers
            this.setupAppCleanup();
        });
    }
    
    /**
     * Ensure Supabase is available for sign-in/subscription. If init failed at startup, try once with fallback config.
     * @returns {boolean} true if this.supabaseIntegration is now set
     */
    ensureSupabaseIntegration() {
        if (this.supabaseIntegration) return true;
        try {
            const config = this.secureConfig || this.getFallbackSecureConfig();
            if (!config) return false;
            const supabaseConfig = config.getSupabaseConfig && config.getSupabaseConfig();
            if (!supabaseConfig || !supabaseConfig.url || !supabaseConfig.anonKey) {
                console.warn('Supabase not available: missing url or anonKey in config');
                return false;
            }
            const SupabaseIntegration = require('./supabase-integration');
            this.secureConfig = this.secureConfig || config;
            this.supabaseIntegration = new SupabaseIntegration(this.secureConfig);
            this.supabaseIntegration.setMainAppInstance(this);
            console.log('✅ Supabase initialized (lazy) for sign-in/subscription');
            return true;
        } catch (e) {
            console.warn('Supabase lazy init failed:', e.message);
            return false;
        }
    }

    /** Default shortcut for Answer screen when user has not set one (everyone gets this to begin with). */
    getDefaultAnswerScreenShortcut() {
        return 'CommandOrControl+Shift+A';
    }

    loadAnswerScreenShortcut() {
        const userDataPath = app.getPath('userData');
        const shortcutFile = path.join(userDataPath, 'answer-screen-shortcut.json');
        try {
            if (fs.existsSync(shortcutFile)) {
                const data = JSON.parse(fs.readFileSync(shortcutFile, 'utf8'));
                if (data.shortcut) {
                    this.registerAnswerScreenShortcut(data.shortcut);
                }
                return;
            }
            // First run: no file — use default so Answer screen is bound for everyone from the start
            const defaultShortcut = this.getDefaultAnswerScreenShortcut();
            fs.writeFileSync(shortcutFile, JSON.stringify({ shortcut: defaultShortcut }, null, 2));
            this.registerAnswerScreenShortcut(defaultShortcut);
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

    setupAppCleanup() {
        // Cleanup shortcuts on quit
        app.on('will-quit', () => {
            const { globalShortcut } = require('electron');
            globalShortcut.unregisterAll();
        });
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
            // getMediaAccessStatus('screen') can return stale/wrong values on macOS.
            // Use desktopCapturer.getSources as the definitive test - if we get sources, we have permission.
            let hasPermission = false;
            try {
                const sources = await desktopCapturer.getSources({
                    types: ['screen'],
                    thumbnailSize: { width: 100, height: 100 }
                });
                hasPermission = sources && sources.length > 0;
            } catch (e) {
                console.log('🔐 Screen capture probe failed:', e.message);
            }
            if (hasPermission) {
                console.log('✅ Screen recording permission granted');
                this.screenRecordingPermissionGranted = true;
                return;
            }
            this.screenRecordingPermissionGranted = false;
            
            // Permission not granted - show banner
            console.log('🔐 Screen recording permission not granted');
            setTimeout(() => {
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.webContents.send('show-permission-in-output');
                }
            }, 500);
            
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
            // Restore main window level and make overlay interactive when account window closes
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                try {
                    this.mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
                } catch (_) {
                    this.mainWindow.setAlwaysOnTop(true, 'floating', 1);
                }
                // Overlay may have been switched to click-through when focus moved to account window; restore interactivity
                this.mainWindow.setIgnoreMouseEvents(false);
            }
        });

        this.accountWindow = accountWindow;
        return accountWindow;
    }

    getOpenRouterAddedModelsPath() {
        return path.join(app.getPath('userData'), OPENROUTER_ADDED_MODELS_FILE);
    }

    loadOpenRouterAddedModels() {
        try {
            const filePath = this.getOpenRouterAddedModelsPath();
            if (fs.existsSync(filePath)) {
                const raw = fs.readFileSync(filePath, 'utf8');
                const data = JSON.parse(raw);
                if (Array.isArray(data)) {
                    this.openrouterAddedModels = [...data];
                    this.openrouterRemovedDefaults = [];
                } else {
                    this.openrouterAddedModels = Array.isArray(data.added) ? [...data.added] : [];
                    this.openrouterRemovedDefaults = Array.isArray(data.removedDefaults) ? [...data.removedDefaults] : [];
                }
            } else {
                this.openrouterAddedModels = [];
                this.openrouterRemovedDefaults = [];
            }
        } catch (_) {
            this.openrouterAddedModels = [];
            this.openrouterRemovedDefaults = [];
        }
    }

    saveOpenRouterAddedModels() {
        try {
            const filePath = this.getOpenRouterAddedModelsPath();
            const data = {
                added: this.openrouterAddedModels || [],
                removedDefaults: this.openrouterRemovedDefaults || []
            };
            fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
        } catch (_) {}
    }

    /** Effective "More models" list: defaults (minus removed) + user-added; used in overlay and OpenRouter window */
    getEffectiveMoreModelsList() {
        this.loadOpenRouterAddedModels();
        const removedSet = new Set(this.openrouterRemovedDefaults || []);
        const defaults = (DEFAULT_MORE_MODELS || []).filter(m => m.id && !removedSet.has(m.id));
        const added = this.openrouterAddedModels || [];
        return [...defaults, ...added];
    }

    createOpenRouterModelsWindow() {
        if (this.openrouterModelsWindow && !this.openrouterModelsWindow.isDestroyed()) {
            this.openrouterModelsWindow.show();
            this.openrouterModelsWindow.focus();
            if (process.platform === 'darwin') app.focus({ steal: true });
            return this.openrouterModelsWindow;
        }
        const { screen } = require('electron');
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
        const winOpts = {
            width: 520,
            height: 640,
            x: Math.max(0, screenWidth - 540),
            y: 50,
            resizable: true,
            frame: true,
            title: 'Add models from OpenRouter',
            alwaysOnTop: false,
            modal: false,
            show: false,
            skipTaskbar: false,
            focusable: true,
            webPreferences: { nodeIntegration: true, contextIsolation: false }
        };
        if (process.platform === 'darwin') winOpts.contentProtection = true;
        const w = new BrowserWindow(winOpts);
        const stealthEnabled = this.getStealthModePreference();
        this.setWindowContentProtection(w, stealthEnabled);
        w.loadFile('openrouter-models-window.html');
        w.once('ready-to-show', () => {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) this.mainWindow.setAlwaysOnTop(true, 'floating', 0);
            w.show();
            w.focus();
            if (process.platform === 'darwin') app.focus({ steal: true });
        });
        w.on('closed', () => {
            this.openrouterModelsWindow = null;
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                try { this.mainWindow.setAlwaysOnTop(true, 'screen-saver', 1); } catch (_) { this.mainWindow.setAlwaysOnTop(true, 'floating', 1); }
            }
        });
        this.openrouterModelsWindow = w;
        return w;
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
            // Restore main window level and make overlay interactive when reset window closes
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                try {
                    this.mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);
                } catch (_) {
                    this.mainWindow.setAlwaysOnTop(true, 'floating', 1);
                }
                this.mainWindow.setIgnoreMouseEvents(false);
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

    createBrowserTabWindow(initialUrl) {
        const { screen } = require('electron');
        const primaryDisplay = screen.getPrimaryDisplay();
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
        const w = 900;
        const h = 700;
        const opts = {
            width: w,
            height: h,
            x: Math.max(0, Math.floor((screenWidth - w) / 2)),
            y: Math.max(0, Math.floor((screenHeight - h) / 2)),
            resizable: true,
            frame: true,
            title: 'Jarvis Browser',
            alwaysOnTop: false,
            modal: false,
            show: false,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false,
                webviewTag: true
            }
        };
        if (process.platform === 'darwin') opts.contentProtection = true;
        const win = new BrowserWindow(opts);
        const stealthEnabled = this.getStealthModePreference();
        this.setWindowContentProtection(win, stealthEnabled);
        win.loadFile('browser-tab.html', initialUrl ? { query: { url: initialUrl } } : {});
        win.once('ready-to-show', () => {
            win.show();
            win.focus();
            if (initialUrl && win.webContents) {
                win.webContents.send('browser-tab-load-url', initialUrl);
            }
        });
        win.on('closed', () => {
            if (this.browserTabWindow === win) this.browserTabWindow = null;
        });
        this.browserTabWindow = win;
        return win;
    }

    setupAuthHandlers() {

        // Handle password set notification
        ipcMain.on('password-set', (event, email) => {
            console.log('🔐 Password set for:', email);
            // Notify main window to hide password notification
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('password-set', email);
            }
        });

        // Open upgrade/payment page in browser when checkout session can't be created (e.g. not signed in)
        ipcMain.handle('open-upgrade-page', () => {
            const url = 'https://yesjarvis.com/account';
            shell.openExternal(url);
            return { opened: true };
        });

        ipcMain.handle('run-lockdown-launcher', () => {
            if (process.platform !== 'darwin') return { ok: false, error: 'macOS only' };
            try {
                const launcherPath = app.isPackaged
                    ? path.join(process.resourcesPath, 'lockdown-launcher.command')
                    : path.join(__dirname, 'scripts', 'lockdown-launcher.command');
                if (fs.existsSync(launcherPath)) {
                    require('child_process').exec(`open "${launcherPath}"`);
                    return { ok: true };
                }
                return { ok: false, error: 'Launcher not found' };
            } catch (e) {
                return { ok: false, error: String(e.message || e) };
            }
        });

        ipcMain.on('open-screen-recording-settings', () => {
            this.openScreenRecordingSettings();
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
            show: true, // Show immediately so app feels instant; content paints when ready
            hasShadow: false,
            thickFrame: false
        };
        
        // macOS-only: No vibrancy on main window – blur is only behind the pill via small hudBlurWindow
        if (process.platform === 'darwin') {
            if (app.isPackaged) {
                mainWindowOptions.contentProtection = true;
            }
            mainWindowOptions.type = 'panel'; // Makes it a floating panel on macOS
            mainWindowOptions.acceptFirstMouse = true; // Accept clicks without activating
        }
        
        this.mainWindow = new BrowserWindow(mainWindowOptions);

        // Cheat/stealth mode: low profile from startup if stealth was on (undetectable on Lockdown)
        this.lowProfileMode = this.getStealthModePreference();

        // Stealth mode: set window title to innocuous name when stealth is on (avoids detection by name)
        this.applyStealthWindowTitle();

        // macOS: Set window level above Lockdown only when NOT in cheat mode (avoid detection)
        if (!this.lowProfileMode && process.platform === 'darwin' && this.getNativeContentProtection() && this.nativeContentProtection.setWindowLevelAboveLockdown) {
            this.nativeContentProtection.setWindowLevelAboveLockdown(this.mainWindow);
        }

        // macOS-only: Enable content protection when packaged; skip in dev to prevent startup crashes
        if (app.isPackaged) {
            const stealthModeEnabled = this.getStealthModePreference();
            this.setWindowContentProtection(this.mainWindow, stealthModeEnabled);
            if (stealthModeEnabled) {
                setTimeout(() => {
                    this.setupScreenshotDetection();
                }, 500);
                // Stealth: hide from Dock + Cmd+Tab at startup so proctoring doesn't see the app
                if (process.platform === 'darwin' && this.getNativeContentProtection() && this.nativeContentProtection.setActivationPolicyAccessory) {
                    this.nativeContentProtection.setActivationPolicyAccessory(true);
                }
            }
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
        // Apply native level above Lockdown only when NOT in cheat mode (macOS)
        if (!this.lowProfileMode && process.platform === 'darwin' && this.getNativeContentProtection() && this.nativeContentProtection.setWindowLevelAboveLockdown) {
            this.nativeContentProtection.setWindowLevelAboveLockdown(this.mainWindow);
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
        

        // Hide Dock for overlay utility feel (macOS) - only when packaged so dev (npm start) keeps dock visible
        if (app.isPackaged && process.platform === 'darwin' && app.dock) { try { app.dock.hide(); } catch (_) {} }

        // Load the HTML file
        this.mainWindow.loadFile('index.html').catch(err => {
            console.error('Failed to load index.html:', err);
        });

        // If ready-to-show doesn't fire within 8s (e.g. load hang), force-show so the app doesn't appear broken
        const forceShowTimer = setTimeout(() => {
            if (this.mainWindow && !this.mainWindow.isDestroyed() && !this.mainWindow.isVisible()) {
                console.warn('[createWindow] ready-to-show did not fire in time, forcing window show');
                try {
                    this.mainWindow.show();
                    this.showOverlay();
                } catch (e) {
                    console.error('[createWindow] force-show failed:', e);
                }
            }
        }, 8000);

        // Window is ready; show overlay immediately
        this.mainWindow.once('ready-to-show', () => {
            clearTimeout(forceShowTimer);
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
            
            // Start click-through; showOverlay will reinforce; poll will make interactive when cursor over pill
            try { 
                this.mainWindow.setIgnoreMouseEvents(true, { forward: true }); 
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

        this.mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
            console.error('Page failed to load:', errorCode, errorDescription);
        });

        // On macOS when overlay is visible, prevent close (e.g. Lockdown) — hide instead. Cheat/stealth mode ON: no auto reshow (user brings back with Alt+Space). OFF: one reshow so overlay returns.
        this.mainWindow.on('close', (e) => {
            if (process.platform !== 'darwin' || app.isQuitting || !this.isOverlayVisible) return;
            e.preventDefault();
            this.mainWindow.hide();
            if (!this.getStealthModePreference()) {
                const reshow = () => {
                    if (!this.mainWindow || this.mainWindow.isDestroyed() || app.isQuitting) return;
                    try { this.mainWindow.showInactive(); } catch (_) {}
                    if (!this.lowProfileMode) this.forceFullscreenVisibility();
                };
                setTimeout(reshow, this.lowProfileMode ? 2000 : 500);
            }
        });

        // Handle window closed
        this.mainWindow.on('closed', () => {
            if (this.hudBlurWindow && !this.hudBlurWindow.isDestroyed()) {
                this.hudBlurWindow.close();
                this.hudBlurWindow = null;
            }
            const overlayWasVisible = this.isOverlayVisible;
            this.mainWindow = null;
            // When Lockdown Browser enters test it can close our window; recreate so overlay comes back (macOS only)
            if (process.platform === 'darwin' && !app.isQuitting) {
                const now = Date.now();
                if (now - this.lastRecreateAfterCloseAt > 4000) {
                    this.lastRecreateAfterCloseAt = now;
                    setTimeout(() => {
                        if (app.isQuitting || this.mainWindow) return;
                        this.createWindow();
                        if (overlayWasVisible) {
                            // New window's ready-to-show already calls showOverlay(); isOverlayVisible is still true
                        }
                    }, 600);
                }
            }
        });

        // IPC: position native blur window behind HUD (macOS only – real blur of desktop/IDE)
        ipcMain.on('set-hud-blur-bounds', (event, rect) => {
            if (process.platform !== 'darwin' || !this.mainWindow || this.mainWindow.isDestroyed()) return;
            if (!rect || rect.width <= 0 || rect.height <= 0) {
                if (this.hudBlurWindow && !this.hudBlurWindow.isDestroyed()) {
                    this.hudBlurWindow.hide();
                }
                return;
            }
            const win = this.mainWindow.getBounds();
            const x = Math.round(win.x + rect.left);
            const y = Math.round(win.y + rect.top);
            const w = Math.max(1, Math.round(rect.width));
            const h = Math.max(1, Math.round(rect.height));
            if (!this.hudBlurWindow || this.hudBlurWindow.isDestroyed()) {
                this.hudBlurWindow = new BrowserWindow({
                    width: w,
                    height: h,
                    x,
                    y,
                    frame: false,
                    transparent: true,
                    backgroundColor: '#00000000',
                    hasShadow: false,
                    skipTaskbar: true,
                    focusable: false,
                    vibrancy: 'hud',
                    visualEffectState: 'active',
                    webPreferences: { nodeIntegration: false, backgroundThrottling: false }
                });
                this.hudBlurWindow.setIgnoreMouseEvents(true);
                this.hudBlurWindow.setAlwaysOnTop(false);
                this.hudBlurWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                this.hudBlurWindow.loadFile(path.join(__dirname, 'blur-window.html')).catch(() => {});
                this.hudBlurWindow.on('closed', () => { this.hudBlurWindow = null; });
            }
            this.hudBlurWindow.setBounds({ x, y, width: w, height: h });
            this.hudBlurWindow.show();
            // Skip mainWindow.moveTop - steals focus
        });

        // On blur (e.g. user clicked a text box in another app): do NOT go low profile so the overlay stays on top and visible.
        // User can still interact with the other app because overlay becomes click-through after mouseleave; overlay just stays visible.
        this.mainWindow.on('blur', () => {
            if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.isOverlayVisible) return;
            if (this.accountWindow && !this.accountWindow.isDestroyed() && this.accountWindow.isFocused()) return;
            if (this.passwordResetWindow && !this.passwordResetWindow.isDestroyed() && this.passwordResetWindow.isFocused()) return;
            this.lastBlurredAt = Date.now();
            // No longer set lowProfileMode on blur – overlay stays on top when user is in another window
        });

        // When we get hidden: cheat mode ON = no auto reshow (user brings back with Alt+Space). Cheat mode OFF = one reshow so overlay returns.
        this.mainWindow.on('hide', () => {
            if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.isOverlayVisible) return;
            if (this.accountWindow && !this.accountWindow.isDestroyed() && this.accountWindow.isFocused()) return;
            if (this.passwordResetWindow && !this.passwordResetWindow.isDestroyed() && this.passwordResetWindow.isFocused()) return;
            if (!this.getStealthModePreference()) {
                const showQuiet = () => {
                    if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.isOverlayVisible) return;
                    try { this.mainWindow.showInactive(); } catch (_) {}
                    if (!this.lowProfileMode) this.forceFullscreenVisibility();
                };
                setTimeout(showQuiet, this.lowProfileMode ? 2000 : 500);
            }
        });

        // When minimized: cheat mode ON = no auto restore. Cheat mode OFF = restore once so overlay returns.
        this.mainWindow.on('minimize', () => {
            if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.isOverlayVisible) return;
            if (!this.getStealthModePreference()) {
                setTimeout(() => {
                    if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.isOverlayVisible) return;
                    try {
                        this.mainWindow.restore();
                        this.mainWindow.showInactive();
                        if (!this.lowProfileMode) this.forceFullscreenVisibility();
                    } catch (_) {}
                }, 300);
            }
        });

        // Do NOT exit low profile on focus — it caused glitching. Only Alt+Space (showOverlay) brings overlay on top.
        this.mainWindow.on('focus', () => {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                if (process.platform === 'win32') {
                    try { this.mainWindow.setFocusable(true); } catch (_) {}
                }
                // Re-assert level above Lockdown when we get focus (user clicked overlay - helps stay on top)
                if (process.platform === 'darwin' && !this.lowProfileMode && this.getNativeContentProtection() && this.nativeContentProtection.setWindowLevelAboveLockdown) {
                    this.nativeContentProtection.setWindowLevelAboveLockdown(this.mainWindow);
                }
            }
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

        ipcMain.handle('check-screen-permission', () => {
            if (process.platform !== 'darwin') return true;
            const screenStatus = systemPreferences.getMediaAccessStatus('screen');
            return screenStatus === 'granted';
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
                    // DO NOT call focus() or moveTop() - both can steal focus from other apps
                    // Click will naturally focus the window when user interacts
                    this.mainWindow.setIgnoreMouseEvents(false);
                    return true;
                } catch (_) {
                    return false;
                }
            }
            return false;
        });

        // Overlay bounds (viewport coords) from renderer - used to only activate when cursor is over the pill, not full screen
        ipcMain.handle('report-overlay-rect', (_e, rect) => {
            if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
            const b = this.mainWindow.getBounds();
            this.overlayScreenRect = rect && typeof rect.x === 'number' && typeof rect.width === 'number'
                ? { x: b.x + rect.x, y: b.y + rect.y, width: rect.width, height: rect.height }
                : null;
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
                
                // Use display resolution for retina
                const display = screen.getPrimaryDisplay();
                const size = display.size;
                const scale = display.scaleFactor || 1;
                const thumbnailSize = { width: Math.min(Math.round(size.width * scale), 3840), height: Math.min(Math.round(size.height * scale), 2160) };
                
                let source = sources.find(s => s.id.startsWith('screen:'));
                if (!source) source = sources[0];
                let dataUrl = source.thumbnail.toDataURL();
                
                // Use full display resolution for retina
                if (thumbnailSize.width > 1920 || thumbnailSize.height > 1080) {
                    const allSources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize });
                    const screenSrc = allSources.find(s => s.id.startsWith('screen:'));
                    if (screenSrc) dataUrl = screenSrc.thumbnail.toDataURL();
                }
                
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

        // Window-only capture (fallback when screen capture returns black/protected content)
        ipcMain.handle('take-screenshot-window', async () => {
            try {
                const screenStatus = systemPreferences.getMediaAccessStatus('screen');
                if (screenStatus !== 'granted') return null;
                const display = screen.getPrimaryDisplay();
                const ts = { width: Math.min(Math.round(display.size.width * (display.scaleFactor || 1)), 3840), height: Math.min(Math.round(display.size.height * (display.scaleFactor || 1)), 2160) };
                const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: ts });
                const win = sources.find(s => s.id.startsWith('window:'));
                return win ? win.thumbnail.toDataURL() : null;
            } catch (e) {
                console.error('Window screenshot failed:', e);
                return null;
            }
        });

        // Return all window thumbnails so renderer can try each when screen/window capture is black (e.g. Lockdown)
        ipcMain.handle('take-screenshot-all-windows', async () => {
            try {
                const screenStatus = systemPreferences.getMediaAccessStatus('screen');
                if (screenStatus !== 'granted') return [];
                const display = screen.getPrimaryDisplay();
                const ts = { width: Math.min(Math.round(display.size.width * (display.scaleFactor || 1)), 3840), height: Math.min(Math.round(display.size.height * (display.scaleFactor || 1)), 2160) };
                const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: ts });
                return (sources || []).filter(s => s.id.startsWith('window:')).map(s => ({ id: s.id, name: s.name || '', dataUrl: s.thumbnail.toDataURL() }));
            } catch (e) {
                console.error('All-windows screenshot failed:', e);
                return [];
            }
        });

        // Capture screen for HUD blur background (overlay excluded via content protection)
        ipcMain.handle('get-blur-background', async () => {
            try {
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.setContentProtection(true);
                }
                const screenStatus = systemPreferences.getMediaAccessStatus('screen');
                if (screenStatus !== 'granted') {
                    return null;
                }
                const sources = await desktopCapturer.getSources({
                    types: ['screen'],
                    thumbnailSize: { width: 1920, height: 1080 }
                });
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    const stealthEnabled = this.getStealthModePreference();
                    if (!stealthEnabled) this.mainWindow.setContentProtection(false);
                }
                if (!sources?.length) return null;
                return sources[0].thumbnail.toDataURL();
            } catch (e) {
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    const stealthEnabled = this.getStealthModePreference();
                    if (!stealthEnabled) this.mainWindow.setContentProtection(false);
                }
                return null;
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

        // Handle opening URL in in-app browser tab (custom UI)
        ipcMain.on('open-in-app-browser', (event, url) => {
            if (typeof url === 'string' && url.startsWith('http')) {
                this.createBrowserTabWindow(url);
            }
        });

        ipcMain.on('browser-tab-close', (event) => {
            const win = event.sender.getOwnerBrowserWindow();
            if (win && !win.isDestroyed()) win.close();
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

        // OpenRouter models window (like Account window)
        ipcMain.handle('open-openrouter-models-window', () => {
            if (this.openrouterModelsWindow && !this.openrouterModelsWindow.isDestroyed()) {
                this.openrouterModelsWindow.show();
                this.openrouterModelsWindow.focus();
                return;
            }
            this.createOpenRouterModelsWindow();
        });
        ipcMain.handle('close-openrouter-models-window', () => {
            if (this.openrouterModelsWindow && !this.openrouterModelsWindow.isDestroyed()) {
                this.openrouterModelsWindow.close();
            }
        });

        // Always read from disk so overlay gets latest (single source of truth). Returns effective list: defaults (minus removed) + user-added.
        ipcMain.handle('get-openrouter-added-models', () => {
            return this.getEffectiveMoreModelsList();
        });
        ipcMain.handle('add-openrouter-model-to-overlay', (_e, model) => {
            if (model && model.id) {
                this.loadOpenRouterAddedModels(); // ensure we have latest from disk
                const existing = this.openrouterAddedModels || [];
                const alreadyAdded = existing.some(m => m.id === model.id);
                if (!alreadyAdded) {
                    // Append to a new array so we never overwrite or mutate shared refs
                    this.openrouterAddedModels = [...existing, { id: model.id, name: model.name || model.id, description: model.description || '' }];
                    this.saveOpenRouterAddedModels(); // persist to disk immediately
                }
                const effectiveList = this.getEffectiveMoreModelsList();
                // Tell overlay to add the model (IPC) and inject full effective list so "More models" stays in sync
                if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                    this.mainWindow.webContents.send('openrouter-model-added', model);
                    this.mainWindow.webContents.send('openrouter-added-models-sync', effectiveList);
                    const listJson = JSON.stringify(effectiveList);
                    this.mainWindow.webContents.executeJavaScript(
                        `(function(){ try { var list = ${listJson}; if (window.jarvisOverlay && typeof window.jarvisOverlay.injectAddedOpenRouterModelsFromList === 'function') { window.jarvisOverlay.injectAddedOpenRouterModelsFromList(list); } } catch(e) {} })()`
                    ).catch(() => {});
                }
                if (this.openrouterModelsWindow && !this.openrouterModelsWindow.isDestroyed()) {
                    this.openrouterModelsWindow.webContents.send('openrouter-added-models-sync', effectiveList);
                }
            }
        });

        ipcMain.handle('remove-openrouter-model-from-overlay', (_e, modelId) => {
            if (!modelId || typeof modelId !== 'string') return;
            this.loadOpenRouterAddedModels();
            const isDefault = (DEFAULT_MORE_MODELS || []).some(m => m.id === modelId);
            if (isDefault) {
                if (!(this.openrouterRemovedDefaults || []).includes(modelId)) {
                    this.openrouterRemovedDefaults = [...(this.openrouterRemovedDefaults || []), modelId];
                }
            } else {
                this.openrouterAddedModels = (this.openrouterAddedModels || []).filter(m => m.id !== modelId);
            }
            this.saveOpenRouterAddedModels();
            const effectiveList = this.getEffectiveMoreModelsList();
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('openrouter-added-models-sync', effectiveList);
                const listJson = JSON.stringify(effectiveList);
                this.mainWindow.webContents.executeJavaScript(
                    `(function(){ try { var list = ${listJson}; if (window.jarvisOverlay && typeof window.jarvisOverlay.injectAddedOpenRouterModelsFromList === 'function') { window.jarvisOverlay.injectAddedOpenRouterModelsFromList(list); } } catch(e) {} })()`
                ).catch(() => {});
            }
            if (this.openrouterModelsWindow && !this.openrouterModelsWindow.isDestroyed()) {
                this.openrouterModelsWindow.webContents.send('openrouter-added-models-sync', effectiveList);
            }
        });

        // Sync overlay's added OpenRouter models to main (so OpenRouter window can show "Added" state)
        ipcMain.on('sync-openrouter-added-models', (_e, list) => {
            this.openrouterAddedModels = Array.isArray(list) ? list : [];
            this.saveOpenRouterAddedModels();
            if (this.openrouterModelsWindow && !this.openrouterModelsWindow.isDestroyed()) {
                this.openrouterModelsWindow.webContents.send('openrouter-added-models-sync', this.openrouterAddedModels);
            }
        });

        // When account window shows premium (sign-in/sign-up success), tell overlay to refresh so 5/5 goes away
        ipcMain.on('refresh-overlay-subscription', () => {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('refresh-overlay-subscription');
            }
        });
        
        // Handle opening account in browser
        ipcMain.handle('open-account-in-browser', async () => {
            const { shell } = require('electron');
            
            // Get user email if available
            let email = '';
            try {
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

        // Handle unbinding answer screen shortcut (store null so we don't re-apply default on next launch)
        ipcMain.handle('unbind-answer-screen-shortcut', async () => {
            const userDataPath = app.getPath('userData');
            const shortcutFile = path.join(userDataPath, 'answer-screen-shortcut.json');
            try {
                fs.writeFileSync(shortcutFile, JSON.stringify({ shortcut: null }, null, 2));
                if (this.currentAnswerScreenShortcut) {
                    globalShortcut.unregister(this.currentAnswerScreenShortcut);
                    this.currentAnswerScreenShortcut = null;
                }
                console.log('Answer screen shortcut unbound');
            } catch (e) {
                console.error('Failed to unbind answer screen shortcut:', e);
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
                const licenseStatus = this.licenseManager ? await this.licenseManager.checkLicense(userEmail) : { valid: false };
                
                const hasAccess = isFreeAccess || licenseStatus.valid;
                
                return {
                    email: userEmail || 'Not signed in',
                    premiumStatus: isFreeAccess ? 'Free Access (aaron2)' : 
                                  licenseStatus.valid ? 'Premium' : 'Free',
                    features: {
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
                // Cheat mode: low profile so we don't use level 3000 or aggressive reinforce (undetectable on Lockdown)
                this.lowProfileMode = enabled;
                
                // Apply to all windows (including future ones)
                const windows = BrowserWindow.getAllWindows();
                let protectedCount = 0;
                windows.forEach(window => {
                    if (window && !window.isDestroyed()) {
                        this.setWindowContentProtection(window, enabled);
                        protectedCount++;
                    }
                });
                
                // Stealth: hide from Dock and Cmd+Tab (proctoring often enumerates these)
                if (process.platform === 'darwin') {
                    if (this.getNativeContentProtection() && this.nativeContentProtection.setActivationPolicyAccessory) {
                        this.nativeContentProtection.setActivationPolicyAccessory(enabled);
                    }
                    if (app.dock) {
                        try {
                            if (enabled) app.dock.hide(); else app.dock.show();
                        } catch (_) {}
                    }
                }
                
                // Store preference in file (for persistence across restarts)
                const userDataPath = app.getPath('userData');
                const stealthFile = path.join(userDataPath, 'stealth_mode.json');
                fs.writeFileSync(stealthFile, JSON.stringify({ enabled: enabled }, null, 2));
                
                // Stealth mode: update window title and process title to innocuous names
                this.applyStealthWindowTitle();
                if (process.platform === 'darwin') {
                    try { process.title = enabled ? 'VoiceOver' : 'Jarvis'; } catch (_) {}
                }
                
                console.log(`✅ Stealth mode ${enabled ? 'ENABLED' : 'DISABLED'} - Protected ${protectedCount} windows`);
                console.log(`   Windows will be ${enabled ? 'HIDDEN' : 'VISIBLE'} in screen sharing`);
                if (enabled && process.platform === 'darwin') console.log(`   App hidden from Dock + Cmd+Tab`);
                
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

        // Google Docs / Write to Docs removed from build - IPC handlers no-op
        ipcMain.handle('write-to-docs', async () => ({ success: false, error: 'Write to Docs is not available in this build' }));
        ipcMain.handle('write-to-docs-realistic', async () => ({ success: false, error: 'Write to Docs is not available in this build' }));
        ipcMain.handle('google-account-email', async () => ({ email: null, error: 'Google Docs is not available in this build' }));
        // Quit app handler (only way to quit besides update)
        ipcMain.handle('quit-app', () => {
            this.quittingFromOverlayMenu = true;
            app.quit();
        });

        ipcMain.handle('get-is-darwin', () => process.platform === 'darwin');

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
            const currentVersion = app.getVersion();
            console.log('[updater] Check for updates, current version:', currentVersion);
            const updater = getAutoUpdater();
            if (!updater) return { success: false, error: 'Updater not available' };
            try {
                const result = await updater.checkForUpdates();
                if (!result || !result.updateInfo) {
                    console.log('[updater] No update info in result');
                    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                        this.mainWindow.webContents.send('update-not-available');
                    }
                    return { success: true, updateAvailable: false };
                }
                const availableVersion = result.updateInfo.version;
                console.log('[updater] Available version:', availableVersion);
                if (availableVersion === currentVersion) {
                    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                        this.mainWindow.webContents.send('update-not-available');
                    }
                    return { success: true, updateAvailable: false };
                }
                console.log('[updater] Update available:', availableVersion);
                return { success: true, updateAvailable: true, version: availableVersion };
            } catch (error) {
                const msg = error.message || String(error);
                console.error('[updater] Check failed:', msg);
                if (error.stack) console.error('[updater] Stack:', error.stack);
                if (error.message && error.message.includes('no published versions')) {
                    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                        this.mainWindow.webContents.send('update-not-available');
                    }
                    return { success: true, updateAvailable: false };
                }
                return { success: false, error: msg };
            }
        });

        ipcMain.handle('download-update', async () => {
            try {
                const updater = getAutoUpdater();
                if (!updater) return { success: false, error: 'Updater not available' };
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
                app.isQuitting = true;
                this.quittingFromOverlayMenu = true;
                // Squirrel.Mac pulls the zip from our local proxy (~100MB). 45s is enough on most Macs.
                const delayMs = process.platform === 'darwin' ? 45000 : 500;
                setTimeout(() => {
                    try {
                        const u = getAutoUpdater();
                        if (u) u.quitAndInstall(false, true);
                        else app.quit();
                    } catch (e) {
                        console.error('quitAndInstall failed:', e);
                        app.quit();
                    }
                }, delayMs);
                return { success: true };
            } catch (error) {
                console.error('Error installing update:', error);
                return { success: false, error: error.message };
            }
        });

        ipcMain.handle('get-app-version', () => {
            return app.getVersion();
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

        // Google Drive/Sheets auth (removed with Docs)
        ipcMain.handle('google-drive-auth-status', async () => ({ authenticated: false }));

        // Handle getting API configuration for renderer process
        // NOTE: API keys are NOT returned - they must be stored in Supabase Edge Function Secrets
        ipcMain.handle('get-api-keys', () => {
            try {
                const config = this.secureConfig || this.getFallbackSecureConfig();
                const supabaseConfig = config.getSupabaseConfig();
                const apiProxyUrl = config.getSupabaseApiProxyUrl() || supabaseConfig?.apiProxyUrl || '';
                
                console.log('🔗 API Proxy URL:', apiProxyUrl || 'NOT CONFIGURED');
                console.log('🔒 API keys are stored securely in Supabase Edge Function Secrets');
                
                // Return only proxy URL and anon key - NO actual API keys
                return {
                    openai: '', // Keys stored in Supabase Secrets
                    exa: '', // Keys stored in Supabase Secrets
                    perplexity: '', // Keys stored in Supabase Secrets
                    claude: '', // Keys stored in Supabase Secrets
                    openrouter: '', // Keys stored in Supabase Secrets
                    apiProxyUrl: apiProxyUrl,
                    supabaseAnonKey: supabaseConfig?.anonKey || ''
                };
            } catch (error) {
                console.error('Error getting API configuration:', error);
                return {
                    openai: '',
                    exa: '',
                    perplexity: '',
                    claude: '',
                    openrouter: '',
                    apiProxyUrl: '',
                    supabaseAnonKey: ''
                };
            }
        });

        // Handle OpenAI API call via main process (to avoid Electron fetch issues)
        // All API calls go through Supabase Edge Function proxy
        ipcMain.handle('call-openai-api', async (_event, requestPayload, isLowModel = false) => {
            try {
                const email = this.currentUserEmail;
                if (!isLowModel && email && this.supabaseIntegration) {
                    const limitCheck = await this.supabaseIntegration.checkUserLimits(email);
                    if (!limitCheck.allowed) {
                        console.log(`🚫 User ${email} blocked: ${limitCheck.reason}`);
                        return { ok: false, status: 429, statusText: 'Limit Exceeded', data: limitCheck };
                    }
                } else if (isLowModel) {
                    console.log('🆓 Low model (OpenAI) - skipping cost limit check');
                }

                const config = this.secureConfig || this.getFallbackSecureConfig();
                const supabaseConfig = config.getSupabaseConfig();
                const SUPABASE_URL = supabaseConfig?.url || 'https://nbmnbgouiammxpkbyaxj.supabase.co';
                const SUPABASE_ANON_KEY = supabaseConfig?.anonKey || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibW5iZ291aWFtbXhwa2J5YXhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI1MjEwODcsImV4cCI6MjA3ODA5NzA4N30.ppFaxEFUyBWjwkgdszbvP2HUdXXKjC0Bu-afCQr0YxE';
                const PROXY_URL = `${SUPABASE_URL}/functions/v1/jarvis-api-proxy`;

                return new Promise((resolve) => {
                    const parsedUrl = new URL(PROXY_URL);
                    const postData = JSON.stringify({ provider: 'openai', endpoint: 'responses', payload: requestPayload });
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
                        res.on('end', () => {
                            if (res.statusCode >= 200 && res.statusCode < 300) {
                                try {
                                    const responseData = JSON.parse(data);
                                    if (!isLowModel && email && this.supabaseIntegration && responseData.usage) {
                                        const tokensInput = responseData.usage.input_tokens || responseData.usage.prompt_tokens || 0;
                                        const tokensOutput = responseData.usage.output_tokens || responseData.usage.completion_tokens || 0;
                                        this.supabaseIntegration.recordTokenUsage(email, tokensInput, tokensOutput, requestPayload.model || 'gpt-4', 'openai', 'chat').catch(() => {});
                                    }
                                    resolve({ ok: true, status: res.statusCode, statusText: res.statusMessage, data: responseData });
                                } catch (e) {
                                    resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: { error: 'Parse error' } });
                                }
                            } else {
                                try {
                                    resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: JSON.parse(data) });
                                } catch {
                                    resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: { error: data.substring(0, 500) } });
                                }
                            }
                        });
                    });
                    req.on('error', (err) => resolve({ ok: false, status: 500, statusText: 'Network Error', data: { error: err.message } }));
                    req.setTimeout(60000, () => { req.destroy(); resolve({ ok: false, status: 408, data: { error: 'Request timed out' } }); });
                    req.write(postData);
                    req.end();
                });
            } catch (error) {
                console.error('❌ Main process OpenAI: API call failed:', error);
                return { ok: false, status: 500, statusText: 'Internal Error', data: { error: error.message } };
            }
        });

        // Fetch OpenRouter models list (for Browse more models window)
        // OpenRouter requires auth for GET /api/v1/models. Try with key first; on 401/404 retry with key; else try proxy.
        ipcMain.handle('fetch-openrouter-models', async () => {
            const openrouterConfig = this.secureConfig.getOpenRouterConfig();
            const apiKey = openrouterConfig?.apiKey?.trim?.();

            const doDirectRequest = (authHeader) => {
                return new Promise((resolve) => {
                    const options = {
                        hostname: 'openrouter.ai',
                        path: '/api/v1/models',
                        method: 'GET',
                        headers: {
                            'Accept': 'application/json',
                            'Content-Type': 'application/json',
                            ...(authHeader ? { 'Authorization': authHeader } : {})
                        }
                    };
                    const req = https.request(options, (res) => {
                        let data = '';
                        res.on('data', (chunk) => { data += chunk; });
                        res.on('end', () => {
                            if (res.statusCode >= 200 && res.statusCode < 300) {
                                try {
                                    const parsed = JSON.parse(data);
                                    resolve({ data: parsed.data || [], error: null });
                                } catch (e) {
                                    resolve({ data: [], error: 'Failed to parse models response' });
                                }
                                return;
                            }
                            const needAuth = (res.statusCode === 401 || res.statusCode === 404) && !authHeader && apiKey;
                            if (needAuth) {
                                doDirectRequest(`Bearer ${apiKey}`).then(resolve);
                                return;
                            }
                            if (res.statusCode === 401) {
                                resolve({ data: [], error: 'OpenRouter requires an API key. Add OPENROUTER_API_KEY in Supabase Edge Function Secrets or .env. Or browse openrouter.ai/models.' });
                            } else if (res.statusCode === 404) {
                                resolve({ data: [], error: 'OpenRouter returned 404. Add OPENROUTER_API_KEY in Supabase Secrets, or browse openrouter.ai/models.' });
                            } else {
                                resolve({ data: [], error: `OpenRouter returned ${res.statusCode}. Try openrouter.ai/models in your browser.` });
                            }
                        });
                    });
                    req.on('error', (err) => resolve({ data: [], error: err.message }));
                    req.setTimeout(15000, () => {
                        req.destroy();
                        resolve({ data: [], error: 'Request timed out' });
                    });
                    req.end();
                });
            };

            let result = await doDirectRequest(apiKey ? `Bearer ${apiKey}` : null);
            if (result.data && result.data.length > 0) return result;

            const supabaseConfig = this.secureConfig.getSupabaseConfig();
            const SUPABASE_ANON_KEY = supabaseConfig?.anonKey;
            const PROXY_URL = `${supabaseConfig?.url || 'https://nbmnbgouiammxpkbyaxj.supabase.co'}/functions/v1/jarvis-api-proxy`;
            if (SUPABASE_ANON_KEY) {
                try {
                    const postData = JSON.stringify({ provider: 'openrouter', endpoint: 'models', method: 'GET' });
                    const parsedUrl = new URL(PROXY_URL);
                    const proxyResult = await new Promise((resolve) => {
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
                            res.on('end', () => {
                                if (res.statusCode >= 200 && res.statusCode < 300) {
                                    try {
                                        const parsed = JSON.parse(data);
                                        const list = parsed.data || parsed.models || (Array.isArray(parsed) ? parsed : []);
                                        resolve({ data: list, error: null });
                                    } catch (_) {
                                        resolve({ data: [], error: result.error || 'Proxy response invalid' });
                                    }
                                } else {
                                    resolve({ data: [], error: result.error || `Proxy returned ${res.statusCode}` });
                                }
                            });
                        });
                        req.on('error', () => resolve({ data: [], error: result.error || 'Proxy request failed' }));
                        req.setTimeout(15000, () => { req.destroy(); resolve({ data: [], error: result.error || 'Proxy timed out' }); });
                        req.write(postData);
                        req.end();
                    });
                    if (proxyResult.data && proxyResult.data.length > 0) return proxyResult;
                } catch (_) {}
            }
            return result;
        });

        // Handle OpenRouter API call via main process (for token tracking and limit enforcement)
        // All calls go through Supabase Edge Function proxy
        ipcMain.handle('call-openrouter-api', async (_event, requestPayload, isLowModel = false) => {
            try {
                const email = this.currentUserEmail;
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

                const recordUsage = (responseData) => {
                    if (isLowModel || !email || !this.supabaseIntegration || !responseData.usage) return;
                    const tokensInput = responseData.usage.prompt_tokens || 0;
                    const tokensOutput = responseData.usage.completion_tokens || 0;
                    const model = requestPayload.model || 'openrouter';
                    const apiCost = responseData.usage.total_cost || responseData.usage.cost || null;
                    this.supabaseIntegration.recordTokenUsage(email, tokensInput, tokensOutput, model, 'openrouter', 'chat', apiCost)
                        .then(() => console.log('✅ OpenRouter usage recorded')).catch(err => console.error('❌ Record usage:', err));
                };

                const supabaseConfig = this.secureConfig.getSupabaseConfig();
                const SUPABASE_ANON_KEY = supabaseConfig?.anonKey;
                const PROXY_URL = `${supabaseConfig?.url || 'https://nbmnbgouiammxpkbyaxj.supabase.co'}/functions/v1/jarvis-api-proxy`;

                const tryProxy = () => new Promise((resolve) => {
                    if (!SUPABASE_ANON_KEY) {
                        resolve({ ok: false, status: 401, data: { error: 'Supabase proxy not configured.' } });
                        return;
                    }
                    const parsedUrl = new URL(PROXY_URL);
                    const postData = JSON.stringify({
                        provider: 'openrouter',
                        endpoint: 'chat/completions',
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
                        res.on('end', () => {
                            if (res.statusCode >= 200 && res.statusCode < 300) {
                                try {
                                    const responseData = JSON.parse(data);
                                    recordUsage(responseData);
                                    resolve({ ok: true, status: res.statusCode, statusText: res.statusMessage, data: responseData });
                                } catch (e) {
                                    resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: { error: data.substring(0, 300) } });
                                }
                            } else {
                                try {
                                    resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: JSON.parse(data) });
                                } catch {
                                    resolve({ ok: false, status: res.statusCode, statusText: res.statusMessage, data: { error: data.substring(0, 500) } });
                                }
                            }
                        });
                    });
                    req.on('error', (err) => resolve({ ok: false, status: 500, data: { error: err.message } }));
                    req.setTimeout(60000, () => { req.destroy(); resolve({ ok: false, status: 408, data: { error: 'Request timed out' } }); });
                    req.write(postData);
                    req.end();
                });

                return await tryProxy();
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
                console.log('📤 Payload:', JSON.stringify({ provider: 'perplexity', endpoint: 'chat/completions', payload: requestPayload }, null, 2));
                
                // Use Node.js https module (more reliable than fetch in older Node versions)
                return new Promise((resolve, reject) => {
                    const parsedUrl = new URL(PROXY_URL);
                    const postData = JSON.stringify({
                        provider: 'perplexity',
                        endpoint: 'chat/completions',
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
                
                // Always use Supabase Edge Function (API keys stored securely in Supabase Secrets)
                const supabaseConfig = this.secureConfig.getSupabaseConfig();
                const SUPABASE_URL = supabaseConfig?.url || 'https://nbmnbgouiammxpkbyaxj.supabase.co';
                const SUPABASE_ANON_KEY = supabaseConfig?.anonKey;
                
                if (!SUPABASE_ANON_KEY) {
                    return { ok: false, status: 401, statusText: 'Unauthorized', data: { error: 'Supabase proxy not configured. API keys must be stored in Supabase Edge Function Secrets.' } };
                }
                
                const PROXY_URL = `${SUPABASE_URL}/functions/v1/jarvis-api-proxy`;
                console.log('🔒 Main process: Calling Claude API via Supabase Edge Function (keys in Secrets)');
                
                return new Promise((resolve, reject) => {
                        const parsedUrl = new URL(PROXY_URL);
                        const postData = JSON.stringify({
                            provider: 'claude',
                            endpoint: 'messages',
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
            } catch (error) {
                console.error('❌ Main process Claude: API call failed:', error);
                return { ok: false, status: 500, statusText: 'Internal Error', data: { error: error.message } };
            }
        });

        // Handle manual subscription check (Simple API Call)
        ipcMain.handle('check-subscription-manual', async (event, userEmail) => {
            try {
                this.ensureSupabaseIntegration();
                if (!this.supabaseIntegration) {
                    console.warn('Supabase not available for subscription check (run with console open to see init errors)');
                    return { hasActiveSubscription: false, error: 'Subscription service not available. Check your connection and restart the app.' };
                }
                // Use Supabase to check subscription
                const subscriptionResult = await this.supabaseIntegration.checkSubscriptionByEmail(userEmail);
                
                if (subscriptionResult.hasSubscription && subscriptionResult.subscription) {
                    const subscriptionData = {
                        email: userEmail,
                        subscriptionId: subscriptionResult.subscription.id,
                        status: subscriptionResult.subscription.status,
                        nextBilling: subscriptionResult.subscription.currentPeriodEnd,
                        features: ['unlimited_messages', 'screenshot_analysis'],
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

                this.ensureSupabaseIntegration();
                if (!this.supabaseIntegration) {
                    console.warn('Supabase not available for sign-in (run app from terminal to see init errors)');
                    return {
                        success: false,
                        error: 'Subscription service not available. Restart the app or run from terminal (npm start) to see connection errors.'
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
                        features: ['unlimited_messages', 'screenshot_analysis'],
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
                    // No active subscription, or Supabase error (RLS/network)
                    const msg = subscriptionResult.isError
                        ? (subscriptionResult.error || 'Subscription check failed. Check Supabase RLS and connection.')
                        : 'No active subscription found for this email';
                    console.log('ℹ️ Subscription result:', subscriptionResult.isError ? 'error' : 'no subscription', msg);
                    return {
                        success: true,
                        hasSubscription: false,
                        error: msg
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
                this._subscriptionCache = null;
                console.log('🔐 Signing out user...');

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
                this.ensureSupabaseIntegration();
                if (!this.supabaseIntegration) {
                    return { success: false, error: 'Subscription service not available. Restart the app.' };
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
                this.ensureSupabaseIntegration();
                if (!this.supabaseIntegration) {
                    return { success: false, error: 'Subscription service not available. Restart the app.' };
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
                this.ensureSupabaseIntegration();
                if (!this.supabaseIntegration) {
                    return { success: false, hasPassword: false, error: 'Subscription service not available. Restart the app.' };
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
                this.ensureSupabaseIntegration();
                if (!this.supabaseIntegration) {
                    return { success: false, error: 'Subscription service not available. Restart the app.' };
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

                const axios = require('axios/dist/node/axios.cjs');
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
                this.ensureSupabaseIntegration();
                if (!this.supabaseIntegration) {
                    return { success: false, error: 'Subscription service not available. Restart the app.' };
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
                this.ensureSupabaseIntegration();
                if (!this.supabaseIntegration) {
                    return { success: false, error: 'Subscription service not available. Restart the app.' };
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

        // Handle immediate subscription check for premium features
        ipcMain.handle('check-subscription-before-premium-action', async () => {
            try {
                const userEmail = this.getUserEmail();
                if (!userEmail) {
                    return { hasActiveSubscription: false };
                }
                if (!this.supabaseIntegration) {
                    const userDataPath = app.getPath('userData');
                    const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
                    if (fs.existsSync(subscriptionFile)) {
                        try {
                            const localData = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
                            if (localData.email === userEmail) {
                                return { hasActiveSubscription: true };
                            }
                        } catch (_) {}
                    }
                    return { hasActiveSubscription: false };
                }
                // Check Supabase for subscription (includes expiration date check)
                const subscriptionResult = await this.supabaseIntegration.checkSubscriptionByEmail(userEmail);
                
                if (subscriptionResult.hasSubscription && subscriptionResult.subscription) {
                    return { hasActiveSubscription: true };
                } else {
                    // No active subscription - remove local file if it exists
                    const userDataPath = app.getPath('userData');
                    const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
                    if (fs.existsSync(subscriptionFile)) {
                        fs.unlinkSync(subscriptionFile);
                    }
                    return { hasActiveSubscription: false };
                }
            } catch (error) {
                console.error('Error checking subscription before premium action:', error);
                return { hasActiveSubscription: false };
            }
        });

        // Handle subscription validation with Polar API
        ipcMain.handle('validate-subscription-status', async () => {
            try {
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

        // Handle checking subscription status
        // NOTE: This only reads local file - does NOT validate with API
        // Validation happens via webhooks (immediate) and periodic checks (daily)
        ipcMain.removeHandler('check-subscription-status');
        ipcMain.handle('check-subscription-status', async () => {
            const t0 = Date.now();
            try {
                // Cache: if we have recent premium result (< 60s), skip Supabase to avoid blocking every message
                if (this._subscriptionCache && this._subscriptionCache.result?.hasActiveSubscription) {
                    const age = Date.now() - this._subscriptionCache.at;
                    if (age < 60000) {
                        return this._subscriptionCache.result;
                    }
                }
                // Free access (jarvis-free-access.json) bypasses subscription check
                const hasFreeAccess = await this.checkFreeAccess();
                if (hasFreeAccess) {
                    const userEmail = this.getUserEmail();
                    const result = { status: 'premium', hasActiveSubscription: true, subscriptionData: { email: userEmail || 'Free Access', source: 'jarvis-free-access' } };
                    this._subscriptionCache = { result, at: Date.now() };
                    return result;
                }
                // Get user email
                const userEmail = this.getUserEmail();
                
                if (!userEmail) {
                    console.log('No user email found, returning free status');
                    this._subscriptionCache = null;
                    return { status: 'free', hasActiveSubscription: false, subscriptionData: null };
                }
                
                if (!this.supabaseIntegration) {
                    console.warn('Supabase not available - subscription check skipped. Using local cache or free.');
                    const userDataPath = app.getPath('userData');
                    const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
                    if (fs.existsSync(subscriptionFile)) {
                        try {
                            const localData = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
                            const result = { status: 'premium', hasActiveSubscription: true, subscriptionData: localData };
                            this._subscriptionCache = { result, at: Date.now() };
                            return result;
                        } catch (_) {}
                    }
                    this._subscriptionCache = null;
                    return { status: 'free', hasActiveSubscription: false, subscriptionData: null };
                }
                
                // Check Supabase for subscription (this includes expiration date check)
                const subscriptionResult = await this.supabaseIntegration.checkSubscriptionByEmail(userEmail);
                const emailPreview = userEmail ? userEmail.replace(/(.{2}).*@(.*)/, '$1***@$2') : 'none';
                console.log('Subscription check result for', emailPreview, ':', subscriptionResult.hasSubscription ? 'premium' : 'free', subscriptionResult.isError ? '(Supabase error: ' + (subscriptionResult.error || '') + ')' : '');
                
                if (subscriptionResult.hasSubscription && subscriptionResult.subscription) {
                    const subscriptionData = {
                        email: userEmail,
                        subscriptionId: subscriptionResult.subscription.id,
                        status: subscriptionResult.subscription.status,
                        nextBilling: subscriptionResult.subscription.currentPeriodEnd,
                        features: ['unlimited_messages', 'screenshot_analysis'],
                        createdAt: new Date().toISOString()
                    };
                    
                    // Store locally for faster access (but Supabase is source of truth)
                    await this.storeSubscriptionData(subscriptionData);
                    
                    const result = { status: 'premium', hasActiveSubscription: true, subscriptionData };
                    this._subscriptionCache = { result, at: Date.now() };
                    const ms = Date.now() - t0;
                    if (ms > 2000) console.log(`[subscription] Supabase check took ${ms}ms`);
                    return result;
                } else {
                    // Supabase error (isError) = don't remove local file; network/config may be temporary
                    if (subscriptionResult.isError) {
                        console.warn('Supabase subscription check failed:', subscriptionResult.error, '- keeping local cache if any');
                        const userDataPath = app.getPath('userData');
                        const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
                        if (fs.existsSync(subscriptionFile)) {
                            try {
                                const localData = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
                                const result = { status: 'premium', hasActiveSubscription: true, subscriptionData: localData };
                                this._subscriptionCache = { result, at: Date.now() };
                                const ms = Date.now() - t0;
                                if (ms > 2000) console.log(`[subscription] Supabase failed, used local cache (Supabase took ${ms}ms)`);
                                return result;
                            } catch (_) {}
                        }
                    }
                    // No active subscription in Supabase - prefer local file if it exists (don't delete)
                    // Deleting could wipe valid subscription when Supabase has sync delay or email mismatch
                    const userDataPath = app.getPath('userData');
                    const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
                    if (fs.existsSync(subscriptionFile)) {
                        try {
                            const localData = JSON.parse(fs.readFileSync(subscriptionFile, 'utf8'));
                            if (localData.status === 'active' || localData.email) {
                                console.log('Using local subscription cache (Supabase returned no match)');
                                const result = { status: 'premium', hasActiveSubscription: true, subscriptionData: localData };
                                this._subscriptionCache = { result, at: Date.now() };
                                const ms = Date.now() - t0;
                                if (ms > 2000) console.log(`[subscription] Used local cache (Supabase took ${ms}ms)`);
                                return result;
                            }
                        } catch (_) {}
                    }
                    
                    this._subscriptionCache = null;
                    return {
                        status: 'free',
                        hasActiveSubscription: false,
                        subscriptionData: null,
                        checkError: subscriptionResult.isError ? (subscriptionResult.error || 'Subscription check failed') : null
                    };
                }
            } catch (error) {
                this._subscriptionCache = null;
                const ms = Date.now() - t0;
                console.error('Error checking subscription status:', error.message, `(${ms}ms)`);
                return {
                    status: 'free',
                    hasActiveSubscription: false,
                    subscriptionData: null,
                    checkError: error.message
                };
            }
        });
    }

    // Helper method to check subscription status
    async checkSubscriptionStatus() {
        try {
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
            
            if (!this.supabaseIntegration) {
                console.warn('Supabase not available - cannot validate subscription');
                return false;
            }
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
        // When in low profile never force on-top (avoids glitching and Lockdown detecting us)
        if (this.lowProfileMode) return;
        // Only apply if overlay is marked as visible
        if (!this.isOverlayVisible) return;
        
        // Skip if account or password reset window is focused - don't interfere with them
        if (this.accountWindow && !this.accountWindow.isDestroyed() && this.accountWindow.isFocused()) {
            return;
        }
        if (this.passwordResetWindow && !this.passwordResetWindow.isDestroyed() && this.passwordResetWindow.isFocused()) {
            return;
        }
        
        // Ensure window is visible first - use showInactive so we never steal focus (invisible-tab behavior)
        if (!this.mainWindow.isVisible()) {
            try { this.mainWindow.showInactive(); } catch (_) { try { this.mainWindow.show(); } catch (__) {} }
        }
        
        try {
            // CRITICAL: Must set these in order
            try {
                this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
            } catch (_) {
                this.mainWindow.setVisibleOnAllWorkspaces(true);
            }
            
            // CRITICAL: Use screen-saver level for maximum fullscreen visibility (highest level = 1000)
            // This is the key to appearing over fullscreen apps (e.g. Respondus LockDown Browser test)
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
            
            // Skip moveTop here - it steals focus. setAlwaysOnTop keeps z-order.
            const stealthEnabled = this.getStealthModePreference();
            this.setWindowContentProtection(this.mainWindow, stealthEnabled);
            // Always set native window level above Lockdown Browser so overlay appears on top (even when stealth is off)
            if (process.platform === 'darwin' && this.getNativeContentProtection() && this.nativeContentProtection.setWindowLevelAboveLockdown) {
                this.nativeContentProtection.setWindowLevelAboveLockdown(this.mainWindow);
            }
            
            // Reinforce so we win against LockDown Browser. Skip moveTop - it steals focus.
            const reinforce = () => {
                if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.isOverlayVisible) return;
                try { this.mainWindow.showInactive(); } catch (_) { try { this.mainWindow.show(); } catch (__) {} }
                try { this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) { try { this.mainWindow.setVisibleOnAllWorkspaces(true); } catch (__) {} }
                try { this.mainWindow.setAlwaysOnTop(true, 'screen-saver'); } catch (_) { try { this.mainWindow.setAlwaysOnTop(true, 'pop-up-menu'); } catch (__) { try { this.mainWindow.setAlwaysOnTop(true, 'floating'); } catch (___) {} } }
                if (app.isPackaged && process.platform === 'darwin') {
                    this.setWindowContentProtection(this.mainWindow, this.getStealthModePreference());
                    if (this.getNativeContentProtection() && this.nativeContentProtection.setWindowLevelAboveLockdown) {
                        this.nativeContentProtection.setWindowLevelAboveLockdown(this.mainWindow);
                    }
                }
            };
            [10, 25, 50, 100, 200, 350, 500, 700, 1000, 1500, 2000, 3000, 4000].forEach(ms => setTimeout(reinforce, ms));
        } catch (error) {
            // If everything fails, at least try to keep the window visible without stealing focus
            console.error('Error forcing fullscreen visibility:', error);
            try {
                try { this.mainWindow.showInactive(); } catch (_) { this.mainWindow.show(); }
                this.mainWindow.setAlwaysOnTop(true);
            } catch (e) {
                console.error('Critical error keeping window visible:', e);
            }
        }
    }

    toggleOverlay() {
        // If overlay window doesn't exist yet, create it now
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
        // Cheat/stealth mode: low profile so we don't use level 3000 or aggressive reinforce (avoids Lockdown detection)
        this.lowProfileMode = this.getStealthModePreference();
        this.lastBlurredAt = 0;
        
        // Set visibility properties BEFORE showing
        try {
            this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        } catch (_) {
            try {
                this.mainWindow.setVisibleOnAllWorkspaces(true);
            } catch (__) {}
        }
        
        // In cheat mode on macOS use screen-saver (1000) so we stay above Lockdown fullscreen; native 1001 is re-applied in loop. Else use screen-saver.
        if (this.lowProfileMode && process.platform === 'darwin') {
            this.setWindowContentProtection(this.mainWindow, true); // native level above Lockdown
            try {
                this.mainWindow.setAlwaysOnTop(true, 'screen-saver'); // fallback 1000 so we stay above fullscreen
            } catch (_) {
                try { this.mainWindow.setAlwaysOnTop(true, 'pop-up-menu'); } catch (__) { this.mainWindow.setAlwaysOnTop(true); }
            }
        } else if (this.lowProfileMode) {
            try {
                this.mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
            } catch (_) {
                try { this.mainWindow.setAlwaysOnTop(true); } catch (__) {}
            }
        } else {
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
        }
        
        // Start INTERACTIVE so user can click/type immediately. Switch to click-through when cursor leaves.
        try {
            this.mainWindow.setIgnoreMouseEvents(false);
            try { if (process.platform !== 'win32') this.mainWindow.setFocusable(true); } catch (_) {}
            try { this.mainWindow.webContents.send('overlay-now-interactive'); } catch (_) {}
        } catch (_) {}
        
        this.isOverlayVisible = true; // Set before poll so immediate check works
        
        // Poll: when cursor is over the overlay pill/UI, make interactive; otherwise keep click-through so user can click other apps.
        // Uses overlayScreenRect from renderer (not full window bounds) so we don't block the entire screen.
        if (this.overlayHoverActivateInterval) clearInterval(this.overlayHoverActivateInterval);
        let lastCursorWasInside = false;
        let pollCount = 0;
        const PADDING = 40; // px padding around overlay rect for easier activation
        const checkAndActivate = () => {
            if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.isOverlayVisible) return true;
            try {
                const pos = screen.getCursorScreenPoint();
                const r = this.overlayScreenRect;
                let bounds;
                if (r && r.width > 0 && r.height > 0) {
                    bounds = { x: r.x - PADDING, y: r.y - PADDING, width: r.width + 2 * PADDING, height: r.height + 2 * PADDING };
                } else {
                    // No rect yet (or zero size) - use full window bounds so overlay is clickable
                    const b = this.mainWindow.getBounds();
                    bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
                }
                const inside = pos.x >= bounds.x && pos.x < bounds.x + bounds.width && pos.y >= bounds.y && pos.y < bounds.y + bounds.height;
                pollCount++;
                if (inside && !lastCursorWasInside) {
                    this.mainWindow.setIgnoreMouseEvents(false);
                    try { if (process.platform !== 'win32') this.mainWindow.setFocusable(true); } catch (_) {}
                    try { this.mainWindow.webContents.send('overlay-now-interactive'); } catch (_) {}
                    return true;
                } else if (inside && pollCount >= 2) {
                    this.mainWindow.setIgnoreMouseEvents(false);
                    try { if (process.platform !== 'win32') this.mainWindow.setFocusable(true); } catch (_) {}
                    try { this.mainWindow.webContents.send('overlay-now-interactive'); } catch (_) {}
                    return true;
                }
                lastCursorWasInside = inside;
            } catch (_) {}
            return false;
        };
        this.overlayHoverActivateInterval = setInterval(() => {
            if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.isOverlayVisible) {
                if (this.overlayHoverActivateInterval) {
                    clearInterval(this.overlayHoverActivateInterval);
                    this.overlayHoverActivateInterval = null;
                }
                return;
            }
            checkAndActivate();
        }, 100);
        
        // Ensure window is focusable
        try {
            this.mainWindow.setFocusable(true);
        } catch (_) {}
        
        // macOS: prevent window from being closed (red button / Cmd+W) so Lockdown can't close us
        if (process.platform === 'darwin') {
            try { this.mainWindow.setClosable(false); } catch (_) {}
        }
        
        // macOS-only: Reinforce content protection when showing (use stealth mode preference)
        const stealthEnabled = this.getStealthModePreference();
        this.setWindowContentProtection(this.mainWindow, stealthEnabled);
        // Always set native window level above Lockdown Browser so overlay works with Respondus Lockdown Browser
        if (process.platform === 'darwin' && this.getNativeContentProtection() && this.nativeContentProtection.setWindowLevelAboveLockdown) {
            this.nativeContentProtection.setWindowLevelAboveLockdown(this.mainWindow);
        }

        // Show the window WITHOUT stealing focus (prevents browser blur events)
        try {
            this.mainWindow.showInactive(); // Show without activating/focusing
        } catch (_) {
            this.mainWindow.show(); // Fallback if showInactive not available
        }
        // Skip moveTop - steals focus on macOS. setAlwaysOnTop keeps overlay on top.
        
        // Stealth: keep window title as innocuous name when stealth is on
        this.applyStealthWindowTitle();
        
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
        
        // Enforce overlay on top. Avoid moveTop in tight loop - it steals focus on macOS.
        // setAlwaysOnTop + setVisibleOnAllWorkspaces keep z-order; moveTop only when our window is focused.
        this._lastMoveTopAt = 0;
        this._lastLevelAboveLockdownAt = 0; // Throttle native level calls - they can steal focus if too frequent
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
            
            try {
                // Cheat/stealth mode ON: do NOT auto re-show when hidden (avoids hide/show loop). OFF: re-show so overlay stays available.
                if (!this.mainWindow.isVisible() && !this.getStealthModePreference()) {
                    try { this.mainWindow.showInactive(); } catch (_) { try { this.mainWindow.show(); } catch (__) {} }
                }
                try {
                    this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
                } catch (_) {
                    this.mainWindow.setVisibleOnAllWorkspaces(true);
                }
                
                if (this.lowProfileMode) {
                    // Cheat mode: use native max level so overlay stays above Lockdown fullscreen
                    if (process.platform === 'darwin') {
                        try {
                            this.mainWindow.setAlwaysOnTop(true, 'screen-saver');
                        } catch (_) {
                            try { this.mainWindow.setAlwaysOnTop(true, 'pop-up-menu'); } catch (__) { this.mainWindow.setAlwaysOnTop(true); }
                        }
                        // Apply native max level every tick - max aggression
                        if (this.getNativeContentProtection() && this.nativeContentProtection.setWindowLevelAboveLockdown) {
                            this.nativeContentProtection.setWindowLevelAboveLockdown(this.mainWindow);
                        }
                        // Re-apply full stealth (all methods) every 200ms
                        const now = Date.now();
                        if (!this._lastStealthLevelReapply) this._lastStealthLevelReapply = 0;
                        if (now - this._lastStealthLevelReapply > 200 && this.getNativeContentProtection() && this.nativeContentProtection.applyComprehensiveStealthUndetectable) {
                            this._lastStealthLevelReapply = now;
                            this.setWindowContentProtection(this.mainWindow, true);
                        }
                    } else {
                        try {
                            this.mainWindow.setAlwaysOnTop(true, 'pop-up-menu');
                        } catch (_) {
                            try { this.mainWindow.setAlwaysOnTop(true); } catch (__) {}
                        }
                    }
                    // moveTop every tick in cheat mode - max aggression
                    this.mainWindow.moveTop();
                } else {
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
                    // Skip moveTop in normal mode - it steals focus. Cheat mode only above.
                }
                
                if (!this.lowProfileMode && app.isPackaged && process.platform === 'darwin') {
                    const stealthEnabled = this.getStealthModePreference();
                    this.setWindowContentProtection(this.mainWindow, stealthEnabled);
                    // Re-assert level above Lockdown every tick - max frequency
                    if (this.getNativeContentProtection() && this.nativeContentProtection.setWindowLevelAboveLockdown) {
                        this.nativeContentProtection.setWindowLevelAboveLockdown(this.mainWindow);
                    }
                }
                // Rescue: when Lockdown kills us, relaunch. Spawn grandchild that reparents to launchd so it survives our death.
                if (app.isPackaged && process.platform === 'darwin') {
                    const now = Date.now();
                    if (now - this.lastRescueSpawnAt > 1500) {
                        this.lastRescueSpawnAt = now;
                        try {
                            const quitFile = path.join(app.getPath('userData'), '.jarvis-quitting');
                            // Outer sh spawns inner sh in background and exits immediately; inner sh reparents to launchd
                            const q = quitFile.replace(/'/g, "'\"'\"'");
                            const cmd = `( export JQ='${q}'; sh -c 'sleep 2; [ -f "$JQ" ] && exit 0; pgrep -x Jarvis >/dev/null || open -a "Jarvis"' & ); exit 0`;
                            const child = spawn('sh', ['-c', cmd], { detached: true, stdio: 'ignore', env: {} });
                            child.unref();
                        } catch (_) {}
                    }
                }
            } catch (e) {}
        }, 10);  // 100fps enforcement - max aggression
    }
    
    stopFullscreenEnforcement() {
        if (this.fullscreenEnforcementInterval) {
            clearInterval(this.fullscreenEnforcementInterval);
            this.fullscreenEnforcementInterval = null;
        }
    }

    hideOverlay() {
        if (!this.mainWindow) return;
        
        if (this.overlayHoverActivateInterval) {
            clearInterval(this.overlayHoverActivateInterval);
            this.overlayHoverActivateInterval = null;
        }
        if (process.platform === 'darwin') {
            try { this.mainWindow.setClosable(true); } catch (_) {}
        }
        this.mainWindow.hide();
        this.isOverlayVisible = false;
        
        // Stop fullscreen enforcement when hidden
        this.stopFullscreenEnforcement();
    }

    async checkFreeAccess() {
        try {
            const userDataPath = app.getPath('userData');
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
            // Always use Supabase Edge Function - API keys stored in Supabase Secrets
            const supabaseConfig = this.secureConfig.getSupabaseConfig();
            const SUPABASE_URL = supabaseConfig?.url || 'https://nbmnbgouiammxpkbyaxj.supabase.co';
            const SUPABASE_ANON_KEY = supabaseConfig?.anonKey;
            
            if (!SUPABASE_ANON_KEY) {
                resolve({ error: 'Supabase proxy not configured. API keys must be stored in Supabase Edge Function Secrets.' });
                return;
            }
            
            const PROXY_URL = `${SUPABASE_URL}/functions/v1/jarvis-api-proxy`;
            const parsedUrl = new URL(PROXY_URL);
            const postData = JSON.stringify({
                provider: 'exa',
                endpoint: 'contents',
                payload: {
                    urls: [url],
                    type: "text"
                }
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

    getUserEmail() {
        try {
            const userDataPath = app.getPath('userData');
            const userFile = path.join(userDataPath, 'jarvis_user.json');
            
            if (fs.existsSync(userFile)) {
                const userData = JSON.parse(fs.readFileSync(userFile, 'utf8'));
                if (userData.email) return userData.email;
            }
            // Fallback: email may be in subscription_status.json (e.g. if jarvis_user was cleared)
            const subFile = path.join(userDataPath, 'subscription_status.json');
            if (fs.existsSync(subFile)) {
                const subData = JSON.parse(fs.readFileSync(subFile, 'utf8'));
                if (subData.email) return subData.email;
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

    // Stealth mode: use an innocuous window title so proctoring software is less likely to flag by name.
    // VoiceOver = Apple's built-in screen reader; exam software rarely blocks it (accessibility/ADA).
    getStealthWindowTitle() {
        return this.getStealthModePreference() ? 'VoiceOver' : 'Jarvis';
    }

    applyStealthWindowTitle() {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            try {
                const title = this.getStealthWindowTitle();
                this.mainWindow.setTitle(title);
            } catch (_) {}
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
            if (this.getNativeContentProtection() && this.nativeContentProtection.isAvailable()) {
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
                
                // Cheat/stealth mode: use undetectable stealth (level 1000) so Lockdown doesn't flag the window
                if (enable && this.getNativeContentProtection() && this.nativeContentProtection.applyComprehensiveStealthUndetectable) {
                    this.nativeContentProtection.applyComprehensiveStealthUndetectable(window, enable);
                } else if (this.getNativeContentProtection() && this.nativeContentProtection.applyComprehensiveStealth) {
                    this.nativeContentProtection.applyComprehensiveStealth(window, enable);
                } else if (this.nativeContentProtection && this.nativeContentProtection.setContentProtection) {
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
                                this.mainWindow.setOpacity(1.0); // Always restore so overlay is never stuck transparent
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
                // Stealth: when losing focus (e.g. user clicked Lockdown), briefly hide overlay so any screenshot in that moment is less likely to capture it
                if (this.getStealthModePreference() && this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isVisible()) {
                    this.mainWindow.setOpacity(0.001);
                    setTimeout(() => {
                        if (this.mainWindow && !this.mainWindow.isDestroyed()) this.mainWindow.setOpacity(1.0);
                    }, 40);
                    // If frontmost app is Lockdown/Respondus, stay hidden a bit longer (proctor may screenshot when switching)
                    if (process.platform === 'darwin') {
                        exec('osascript -e \'tell application "System Events" to get name of first process whose frontmost is true\'', { encoding: 'utf8', timeout: 500 }, (err, stdout) => {
                            if (err || !stdout) return;
                            const name = (stdout || '').trim().toLowerCase();
                            if (name.includes('lockdown') || name.includes('respondus')) {
                                if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isVisible()) {
                                    this.mainWindow.setOpacity(0.001);
                                    setTimeout(() => {
                                        if (this.mainWindow && !this.mainWindow.isDestroyed()) this.mainWindow.setOpacity(1.0);
                                    }, 150);
                                }
                            }
                        });
                    }
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
                        features: ['unlimited_messages', 'screenshot_analysis'],
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
            if (!this.supabaseIntegration) {
                console.warn('Supabase not available for subscription API check');
                return { hasSubscription: false };
            }
            // Use Supabase to check subscription
            const subscriptionResult = await this.supabaseIntegration.checkSubscriptionByEmail(userEmail);
            
            if (subscriptionResult.hasSubscription && subscriptionResult.subscription) {
                const subscriptionData = {
                    email: userEmail,
                    nextBilling: subscriptionResult.subscription.currentPeriodEnd,
                    features: ['unlimited_messages', 'screenshot_analysis'],
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
