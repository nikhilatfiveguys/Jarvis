const { gmail } = require('@googleapis/gmail');
const { OAuth2Client } = require('google-auth-library');
const axios = require('axios');
const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

class GmailIntegration {
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
        
        // Token storage path (shared with Google Docs/Calendar for convenience)
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
                
                this.oAuth2Client = new OAuth2Client(
                    this.clientId,
                    this.clientSecret,
                    this.redirectUri
                );
                
                this.oAuth2Client.setCredentials(tokens);
                
                // Refresh token if expired
                if (this.oAuth2Client.isTokenExpiring && this.oAuth2Client.isTokenExpiring()) {
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

        this.oAuth2Client = new OAuth2Client(
            this.clientId,
            this.clientSecret,
            this.redirectUri
        );

        const scopes = [
            'https://www.googleapis.com/auth/gmail.readonly',
            'https://www.googleapis.com/auth/gmail.modify',
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
                                        console.log('✅ Gmail authentication successful');
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
                this.oAuth2Client = new OAuth2Client(
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
            if (!this.oAuth2Client || !this.oAuth2Client.credentials.access_token) {
                return null;
            }
            const { data } = await axios.get('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${this.oAuth2Client.credentials.access_token}` }
            });
            return data.email || null;
        } catch (error) {
            console.error('Error getting user email:', error);
            return null;
        }
    }

    /**
     * Search emails
     * @param {string} query - Gmail search query (e.g., "is:important", "from:example@gmail.com", "subject:meeting")
     * @param {number} maxResults - Maximum number of results (default: 10)
     * @returns {Promise<Object>} Search results with email list
     */
    async searchEmails(query, maxResults = 10) {
        try {
            if (!this.isAuthenticated()) {
                throw new Error('Not authenticated. Please authenticate first.');
            }

            const gmailClient = gmail({ version: 'v1', auth: this.oAuth2Client });

            const response = await gmailClient.users.messages.list({
                userId: 'me',
                q: query,
                maxResults: maxResults
            });

            const messages = response.data.messages || [];
            const emailDetails = [];

            // Get details for each message
            for (const message of messages) {
                try {
                    const messageDetail = await gmailClient.users.messages.get({
                        userId: 'me',
                        id: message.id,
                        format: 'full'
                    });

                    const headers = messageDetail.data.payload.headers;
                    const getHeader = (name) => {
                        const header = headers.find(h => h.name.toLowerCase() === name.toLowerCase());
                        return header ? header.value : '';
                    };

                    const email = {
                        id: message.id,
                        threadId: messageDetail.data.threadId,
                        snippet: messageDetail.data.snippet,
                        subject: getHeader('Subject'),
                        from: getHeader('From'),
                        to: getHeader('To'),
                        date: getHeader('Date'),
                        labels: messageDetail.data.labelIds || [],
                        isImportant: messageDetail.data.labelIds?.includes('IMPORTANT') || false,
                        isUnread: messageDetail.data.labelIds?.includes('UNREAD') || false
                    };

                    emailDetails.push(email);
                } catch (error) {
                    console.error(`Error fetching message ${message.id}:`, error);
                }
            }

            return {
                success: true,
                emails: emailDetails,
                totalResults: response.data.resultSizeEstimate || 0
            };
        } catch (error) {
            console.error('Error searching emails:', error);
            throw error;
        }
    }

    /**
     * Get emails from today
     * @param {number} maxResults - Maximum number of results (default: 20)
     * @returns {Promise<Object>} Today's emails
     */
    async getTodaysEmails(maxResults = 20) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayStr = today.toISOString().split('T')[0].replace(/-/g, '/');
        
        return this.searchEmails(`after:${todayStr}`, maxResults);
    }

    /**
     * Get important emails
     * @param {number} maxResults - Maximum number of results (default: 10)
     * @returns {Promise<Object>} Important emails
     */
    async getImportantEmails(maxResults = 10) {
        return this.searchEmails('is:important', maxResults);
    }

    /**
     * Get unread emails
     * @param {number} maxResults - Maximum number of results (default: 20)
     * @returns {Promise<Object>} Unread emails
     */
    async getUnreadEmails(maxResults = 20) {
        return this.searchEmails('is:unread', maxResults);
    }

}

module.exports = GmailIntegration;

