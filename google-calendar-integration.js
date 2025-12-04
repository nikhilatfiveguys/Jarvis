const { google } = require('googleapis');
const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

class GoogleCalendarIntegration {
    constructor(secureConfig = null) {
        // Google OAuth2 credentials - can come from:
        // 1. Environment variables (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET)
        // 2. .env file (loaded by secureConfig)
        // 3. secureConfig.getGoogleConfig() if implemented
        
        // Try to get from secureConfig first, then fall back to process.env
        let googleConfig = null;
        if (secureConfig && typeof secureConfig.getGoogleConfig === 'function') {
            googleConfig = secureConfig.getGoogleConfig();
        }
        
        this.clientId = googleConfig?.clientId || 
                       process.env.GOOGLE_CLIENT_ID || 
                       '';
        this.clientSecret = googleConfig?.clientSecret || 
                           process.env.GOOGLE_CLIENT_SECRET || 
                           '';
        
        // Use a custom protocol handler for Electron (more reliable than localhost)
        this.redirectUri = 'http://localhost:8080/oauth2callback';
        
        // OAuth2 client
        this.oAuth2Client = null;
        
        // Token storage path (shared with Google Docs for convenience)
        this.tokenPath = path.join(os.homedir(), '.jarvis-google-tokens.json');
        
        // Load existing tokens if available
        this.loadTokens();
    }

    /**
     * Load stored OAuth tokens from disk
     */
    loadTokens() {
        try {
            if (fs.existsSync(this.tokenPath)) {
                const tokenData = fs.readFileSync(this.tokenPath, 'utf8');
                const tokens = JSON.parse(tokenData);
                
                this.oAuth2Client = new google.auth.OAuth2(
                    this.clientId,
                    this.clientSecret,
                    this.redirectUri
                );
                
                this.oAuth2Client.setCredentials(tokens);
                
                // Refresh token if expired
                if (this.oAuth2Client.isTokenExpiring()) {
                    this.refreshAccessToken();
                }
                
                return true;
            }
        } catch (error) {
            console.error('Error loading Google tokens:', error);
        }
        return false;
    }

    /**
     * Save OAuth tokens to disk
     */
    saveTokens(tokens) {
        try {
            fs.writeFileSync(this.tokenPath, JSON.stringify(tokens, null, 2), 'utf8');
            console.log('✅ Google tokens saved successfully');
            return true;
        } catch (error) {
            console.error('Error saving Google tokens:', error);
            return false;
        }
    }

    /**
     * Refresh access token using refresh token
     */
    async refreshAccessToken() {
        try {
            if (!this.oAuth2Client) {
                throw new Error('OAuth2 client not initialized');
            }
            
            const { credentials } = await this.oAuth2Client.refreshAccessToken();
            this.oAuth2Client.setCredentials(credentials);
            this.saveTokens(credentials);
            
            return credentials;
        } catch (error) {
            console.error('Error refreshing access token:', error);
            throw error;
        }
    }

    /**
     * Get authorization URL for OAuth flow
     */
    getAuthUrl() {
        if (!this.clientId || !this.clientSecret) {
            throw new Error('Google OAuth credentials not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.');
        }

        this.oAuth2Client = new google.auth.OAuth2(
            this.clientId,
            this.clientSecret,
            this.redirectUri
        );

        const scopes = [
            'https://www.googleapis.com/auth/calendar',
            'https://www.googleapis.com/auth/calendar.events',
            'https://www.googleapis.com/auth/userinfo.email'
        ];

        return this.oAuth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: scopes,
            prompt: 'consent'
        });
    }

    /**
     * Authenticate user and get tokens
     */
    async authenticate() {
        return new Promise((resolve, reject) => {
            try {
                if (this.isAuthenticated()) {
                    resolve(true);
                    return;
                }

                const authUrl = this.getAuthUrl();
                
                // Create authentication window
                const authWindow = new BrowserWindow({
                    width: 500,
                    height: 600,
                    show: false,
                    webPreferences: {
                        nodeIntegration: false,
                        contextIsolation: true
                    }
                });

                authWindow.loadURL(authUrl);
                authWindow.show();

                let codeReceived = false;

                // Handle OAuth callback - check both redirect and navigation events
                const handleCallback = (url) => {
                    if (codeReceived) return;
                    
                    try {
                        const urlObj = new URL(url);
                        if (urlObj.hostname === 'localhost' && urlObj.pathname === '/oauth2callback') {
                            const code = urlObj.searchParams.get('code');
                            const error = urlObj.searchParams.get('error');
                            
                            if (error) {
                                codeReceived = true;
                                authWindow.close();
                                reject(new Error(`OAuth error: ${error}`));
                                return;
                            }
                            
                            if (code) {
                                codeReceived = true;
                                authWindow.close();
                                this.getTokensFromCode(code)
                                    .then(tokens => {
                                        console.log('✅ Google Calendar authentication successful');
                                        resolve(true);
                                    })
                                    .catch(error => {
                                        reject(error);
                                    });
                            }
                        }
                    } catch (e) {
                        // URL parsing failed, ignore
                    }
                };

                // Listen for redirects
                authWindow.webContents.on('will-redirect', (event, navigationUrl) => {
                    handleCallback(navigationUrl);
                });

                // Also listen for navigation (in case redirect doesn't fire)
                authWindow.webContents.on('did-navigate', (event, url) => {
                    handleCallback(url);
                });

                // Listen for navigation within the page
                authWindow.webContents.on('did-navigate-in-page', (event, url) => {
                    handleCallback(url);
                });

                authWindow.on('closed', () => {
                    if (!codeReceived) {
                        reject(new Error('Authentication window closed by user'));
                    }
                });
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Exchange authorization code for tokens
     */
    async getTokensFromCode(code) {
        try {
            if (!this.oAuth2Client) {
                this.oAuth2Client = new google.auth.OAuth2(
                    this.clientId,
                    this.clientSecret,
                    this.redirectUri
                );
            }

            const { tokens } = await this.oAuth2Client.getToken(code);
            this.oAuth2Client.setCredentials(tokens);
            this.saveTokens(tokens);
            return tokens;
        } catch (error) {
            console.error('Error getting token:', error);
            throw error;
        }
    }

    /**
     * Check if user is authenticated
     */
    isAuthenticated() {
        return this.oAuth2Client !== null && this.oAuth2Client.credentials !== null;
    }

    /**
     * Get user's email address from Google
     */
    async getUserEmail() {
        try {
            if (!this.oAuth2Client) {
                return null;
            }

            const oauth2 = google.oauth2({
                auth: this.oAuth2Client,
                version: 'v2'
            });

            const userInfo = await oauth2.userinfo.get();
            return userInfo.data.email || null;
        } catch (error) {
            console.error('Error getting user email:', error);
            return null;
        }
    }

    /**
     * Create a calendar event
     * @param {Object} eventData - Event details
     * @param {string} eventData.summary - Event title
     * @param {string} eventData.description - Event description (optional)
     * @param {string} eventData.startDateTime - Start date/time in ISO 8601 format (e.g., '2024-01-15T10:00:00')
     * @param {string} eventData.endDateTime - End date/time in ISO 8601 format (e.g., '2024-01-15T11:00:00')
     * @param {string} eventData.timeZone - Timezone (default: 'America/New_York')
     * @param {string} eventData.location - Event location (optional)
     * @param {Array<string>} eventData.attendees - Array of email addresses (optional)
     * @returns {Promise<Object>} Created event object
     */
    async createEvent(eventData) {
        try {
            if (!this.isAuthenticated()) {
                throw new Error('Not authenticated. Please authenticate first.');
            }

            const calendar = google.calendar({ version: 'v3', auth: this.oAuth2Client });

            const event = {
                summary: eventData.summary,
                description: eventData.description || '',
                location: eventData.location || '',
                start: {
                    dateTime: eventData.startDateTime,
                    timeZone: eventData.timeZone || 'America/New_York'
                },
                end: {
                    dateTime: eventData.endDateTime,
                    timeZone: eventData.timeZone || 'America/New_York'
                },
                attendees: eventData.attendees ? eventData.attendees.map(email => ({ email })) : []
            };

            const response = await calendar.events.insert({
                calendarId: 'primary',
                resource: event
            });

            console.log('✅ Calendar event created:', response.data.id);
            return {
                success: true,
                eventId: response.data.id,
                htmlLink: response.data.htmlLink,
                summary: response.data.summary,
                start: response.data.start,
                end: response.data.end
            };
        } catch (error) {
            console.error('Error creating calendar event:', error);
            throw error;
        }
    }

    /**
     * List upcoming events
     * @param {number} maxResults - Maximum number of events to return (default: 10)
     * @returns {Promise<Array>} Array of upcoming events
     */
    async listUpcomingEvents(maxResults = 10) {
        try {
            if (!this.isAuthenticated()) {
                throw new Error('Not authenticated. Please authenticate first.');
            }

            const calendar = google.calendar({ version: 'v3', auth: this.oAuth2Client });
            const now = new Date().toISOString();

            const response = await calendar.events.list({
                calendarId: 'primary',
                timeMin: now,
                maxResults: maxResults,
                singleEvents: true,
                orderBy: 'startTime'
            });

            return {
                success: true,
                events: response.data.items || []
            };
        } catch (error) {
            console.error('Error listing calendar events:', error);
            throw error;
        }
    }
}

module.exports = GoogleCalendarIntegration;

