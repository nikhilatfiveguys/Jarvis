
const { app, BrowserWindow, ipcMain, screen, desktopCapturer } = require('electron');
const path = require('path');
const screenshot = require('screenshot-desktop');
const { exec } = require('child_process');

class JarvisApp {
    constructor() {
        this.mainWindow = null;
        this.isOverlayVisible = false;
        // Use default GPU hardware acceleration to ensure transparent windows render correctly on macOS
        // Ensure single instance
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
            this.createWindow();
            this.setupIpcHandlers();
            // Hide Dock icon on macOS to feel like a true overlay utility
            if (process.platform === 'darwin' && app.dock) {
                app.dock.hide();
            }
        });

        // Handle window closed
        app.on('window-all-closed', () => {
            if (process.platform !== 'darwin') {
                app.quit();
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
            
            // Register Command+Shift+Space for overlay toggle
            globalShortcut.register('CommandOrControl+Shift+Space', () => {
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

    createWindow() {
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

        // Make the window click-through by default
        this.mainWindow.setIgnoreMouseEvents(true);

        // Load the HTML file
        this.mainWindow.loadFile('index.html').catch(err => {
            console.error('Failed to load index.html:', err);
        });

        // Show window when ready
        this.mainWindow.once('ready-to-show', () => {
            console.log('Window ready to show');
            this.showOverlay();
            // Force window to be visible and on top
            this.mainWindow.setAlwaysOnTop(true, 'screen-saver');
            this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
            this.mainWindow.moveTop();
            // Start interactable so it's visible and focusable; renderer will enable click-through on mouse leave
            try { this.mainWindow.setIgnoreMouseEvents(false); } catch (_) {}
        });

        // Add debugging for page load
        this.mainWindow.webContents.on('did-finish-load', () => {
            console.log('Page finished loading');
        });

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

        // Enable dev tools in development
        if (process.argv.includes('--dev')) {
            this.mainWindow.webContents.openDevTools();
        }
    }

    setupIpcHandlers() {
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
                this.mainWindow.setIgnoreMouseEvents(true);
            }
        });

        // Handle overlay hide
        ipcMain.handle('hide-overlay', () => {
            this.hideOverlay();
        });

        // Handle screenshot capture
        ipcMain.handle('take-screenshot', async () => {
            try {
                console.log('Taking screenshot...');
                
                // Use screenshot-desktop for better compatibility
                const img = await screenshot({ format: 'png' });
                
                // Convert buffer to data URL
                const base64 = img.toString('base64');
                const dataUrl = `data:image/png;base64,${base64}`;
                
                console.log('Screenshot taken successfully');
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
        if (!this.mainWindow) return;
        
        this.mainWindow.show();
        this.mainWindow.setAlwaysOnTop(true, 'screen-saver');
        this.mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        this.isOverlayVisible = true;
    }

    hideOverlay() {
        if (!this.mainWindow) return;
        
        this.mainWindow.hide();
        this.isOverlayVisible = false;
    }
}

// Create the app instance
new JarvisApp();
