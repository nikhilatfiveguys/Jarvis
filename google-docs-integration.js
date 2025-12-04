const { google } = require('googleapis');
const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

class GoogleDocsIntegration {
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
        
        // Token storage path
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
                
                // Check if we have valid credentials
                if (!this.clientId || !this.clientSecret) {
                    console.warn('⚠️ Google OAuth credentials not configured. Cannot load tokens.');
                    return false;
                }
                
                this.oAuth2Client = new google.auth.OAuth2(
                    this.clientId,
                    this.clientSecret,
                    this.redirectUri
                );
                
                this.oAuth2Client.setCredentials(tokens);
                
                // Check if we have a refresh token (required for persistent auth)
                if (tokens.refresh_token) {
                    console.log('✅ Google Docs tokens loaded successfully (has refresh token)');
                    
                    // Proactively refresh if token is expiring
                    if (this.oAuth2Client.isTokenExpiring()) {
                        console.log('🔄 Token expiring, will refresh on next request...');
                    }
                } else {
                    console.log('✅ Google Docs tokens loaded (access token only, may expire)');
                }
                
                return true;
            } else {
                console.log('ℹ️ No Google Docs tokens found at:', this.tokenPath);
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
            'https://www.googleapis.com/auth/documents',  // Read/write access to Google Docs
            'https://www.googleapis.com/auth/drive',     // Full access to Google Drive (needed for existing docs)
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
                // Check if credentials are configured
                if (!this.clientId || !this.clientSecret || 
                    this.clientId.includes('your-google') || 
                    this.clientSecret.includes('your-google')) {
                    reject(new Error('Google OAuth credentials not configured. Please add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to your .env file. See GOOGLE_DOCS_SETUP.md for instructions.'));
                    return;
                }
                
                const authUrl = this.getAuthUrl();
                
                // Create authentication window
                const authWindow = new BrowserWindow({
                    width: 500,
                    height: 700,
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
                                        console.log('✅ Google Docs authentication successful!');
                                        resolve(tokens);
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

                // Listen for redirects (primary method)
                authWindow.webContents.on('will-redirect', (event, navigationUrl) => {
                    handleCallback(navigationUrl);
                });

                // Also listen for navigation (backup method)
                authWindow.webContents.on('did-navigate', (event, url) => {
                    handleCallback(url);
                });

                // Listen for navigation within the page
                authWindow.webContents.on('did-navigate-in-page', (event, url) => {
                    handleCallback(url);
                });
                
                // Handle failed loads (when localhost:8080 connection is refused)
                // This catches the URL before the error is shown
                authWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
                    // Check if this is our OAuth callback URL
                    if (validatedURL && validatedURL.includes('localhost') && validatedURL.includes('oauth2callback')) {
                        handleCallback(validatedURL);
                    }
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
            console.error('Error getting tokens from code:', error);
            throw error;
        }
    }

    /**
     * Check if user is authenticated
     * Returns true if we have valid credentials (even if token needs refresh)
     */
    isAuthenticated() {
        if (!this.oAuth2Client) return false;
        
        const credentials = this.oAuth2Client.credentials;
        if (!credentials) return false;
        
        // If we have a refresh token, we can always get a new access token
        if (credentials.refresh_token) return true;
        
        // If we only have an access token, check if it's still valid
        if (credentials.access_token) {
            // Check if token is expired
            if (credentials.expiry_date && credentials.expiry_date < Date.now()) {
                return false;
            }
            return true;
        }
        
        return false;
    }
    
    /**
     * Ensure we have valid (non-expired) credentials, refreshing if needed
     */
    async ensureValidCredentials() {
        if (!this.oAuth2Client) {
            throw new Error('Not authenticated. Please authenticate first.');
        }
        
        // Check if token needs refresh
        if (this.oAuth2Client.isTokenExpiring()) {
            console.log('🔄 Token expiring, refreshing...');
            await this.refreshAccessToken();
        }
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
     * Create a new Google Doc and return its ID
     */
    async createDocument(title = 'Jarvis Output') {
        try {
            if (!this.isAuthenticated()) {
                throw new Error('Not authenticated. Please authenticate first.');
            }
            
            await this.ensureValidCredentials();

            const docs = google.docs({ version: 'v1', auth: this.oAuth2Client });
            const drive = google.drive({ version: 'v3', auth: this.oAuth2Client });

            // Create document
            const doc = await docs.documents.create({
                requestBody: {
                    title: title
                }
            });

            const documentId = doc.data.documentId;
            console.log(`✅ Created Google Doc: ${documentId}`);
            
            return documentId;
        } catch (error) {
            console.error('Error creating document:', error);
            throw error;
        }
    }

    /**
     * Write text to a Google Doc
     */
    async writeToDocument(documentId, text) {
        try {
            if (!this.isAuthenticated()) {
                throw new Error('Not authenticated. Please authenticate first.');
            }
            
            await this.ensureValidCredentials();

            const docs = google.docs({ version: 'v1', auth: this.oAuth2Client });

            // Get the document to find the end index
            const document = await docs.documents.get({
                documentId: documentId
            });

            // Find the end index (after all content)
            let endIndex = document.data.body.content 
                ? document.data.body.content[document.data.body.content.length - 1].endIndex - 1
                : 1;

            // Check if text contains HTML tables
            const hasTableTag = text.includes('<table') && text.includes('</table>');
            
            const requests = [];
            
            if (hasTableTag) {
                // Parse HTML table using regex
                const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
                let lastIndex = 0;
                let match;
                
                while ((match = tableRegex.exec(text)) !== null) {
                    // Add text before table
                    const textBefore = text.substring(lastIndex, match.index).trim();
                    if (textBefore) {
                        const cleanBefore = this.stripHtmlTags(textBefore);
                        if (cleanBefore) {
                            requests.push({
                                insertText: {
                                    location: { index: endIndex },
                                    text: cleanBefore + '\n\n'
                                }
                            });
                            endIndex += cleanBefore.length + 2;
                        }
                    }
                    
                    // Parse table HTML to extract rows and cells
                    const tableHtml = match[1];
                    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
                    const rows = [];
                    let rowMatch;
                    
                    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
                        const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
                        const cells = [];
                        let cellMatch;
                        
                        while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
                            cells.push(this.stripHtmlTags(cellMatch[1]).trim());
                        }
                        
                        if (cells.length > 0) {
                            rows.push(cells);
                        }
                    }
                    
                    if (rows.length > 0) {
                        const numRows = rows.length;
                        const numColumns = Math.max(...rows.map(r => r.length), 1);
                        
                        // Insert table structure
                        requests.push({
                            insertTable: {
                                location: { index: endIndex },
                                rows: numRows,
                                columns: numColumns
                            }
                        });
                        
                        // After inserting table, we need to get the table element to populate cells
                        // For now, we'll insert the table and let the user manually populate or use paste mode
                        // The table structure will be created, cells can be populated separately
                        endIndex += 1; // Will be updated after table insertion
                    }
                    
                    lastIndex = match.index + match[0].length;
                }
                
                // Add remaining text after last table
                if (lastIndex < text.length) {
                    const textAfter = text.substring(lastIndex).trim();
                    if (textAfter) {
                        const cleanAfter = this.stripHtmlTags(textAfter);
                        if (cleanAfter) {
                            requests.push({
                                insertText: {
                                    location: { index: endIndex },
                                    text: '\n\n' + cleanAfter
                                }
                            });
                        }
                    }
                }
            }
            
            // If no tables found or no requests created, insert as plain text
            if (requests.length === 0) {
                requests.push({
                    insertText: {
                        location: { index: endIndex },
                        text: this.stripHtmlTags(text)
                    }
                });
            }

            await docs.documents.batchUpdate({
                documentId: documentId,
                requestBody: {
                    requests: requests
                }
            });

            console.log(`✅ Text written to document: ${documentId}`);
            return true;
        } catch (error) {
            console.error('Error writing to document:', error);
            // Check if error is due to insufficient scopes
            if (error.message && (
                error.message.includes('insufficient authentication scopes') ||
                error.message.includes('Insufficient Permission') ||
                error.message.includes('insufficient authentication')
            )) {
                // Clear tokens to force re-authentication with correct scopes
                console.warn('⚠️ Insufficient scopes detected. Clearing tokens for re-authentication...');
                this.oAuth2Client = null;
                if (fs.existsSync(this.tokenPath)) {
                    fs.unlinkSync(this.tokenPath);
                }
                throw new Error('Insufficient authentication scopes. Please re-authenticate with Google Docs to grant write permissions.');
            }
            throw error;
        }
    }

    /**
     * Write text to Google Docs (creates new doc or uses existing)
     */
    async writeText(text, options = {}) {
        try {
            // Ensure authenticated
            if (!this.isAuthenticated()) {
                await this.authenticate();
            }

            // Ensure we have valid credentials
            await this.ensureValidCredentials();

            let documentId = options.documentId;

            // Create new document if no ID provided
            if (!documentId) {
                const title = options.title || `Jarvis Output - ${new Date().toLocaleString()}`;
                documentId = await this.createDocument(title);
            }

            // Write text to document
            await this.writeToDocument(documentId, text);

            // Get document URL
            const documentUrl = `https://docs.google.com/document/d/${documentId}`;

            return {
                success: true,
                documentId: documentId,
                documentUrl: documentUrl,
                message: 'Text written to Google Docs successfully!'
            };
        } catch (error) {
            console.error('Error in writeText:', error);
            // Check if error is due to insufficient scopes
            if (error.message && (
                error.message.includes('insufficient authentication scopes') ||
                error.message.includes('Insufficient Permission') ||
                error.message.includes('insufficient authentication')
            )) {
                // Clear tokens to force re-authentication with correct scopes
                console.warn('⚠️ Insufficient scopes detected. Clearing tokens for re-authentication...');
                this.oAuth2Client = null;
                if (fs.existsSync(this.tokenPath)) {
                    fs.unlinkSync(this.tokenPath);
                }
                return {
                    success: false,
                    error: 'Insufficient authentication scopes. Please re-authenticate with Google Docs to grant write permissions.',
                    message: 'Please re-authenticate: Your current Google Docs permissions are insufficient. Click "Write to Docs" again to re-authenticate with the correct permissions.',
                    requiresReauth: true
                };
            }
            
            return {
                success: false,
                error: error.message,
                message: `Failed to write to Google Docs: ${error.message}`
            };
        }
    }

    /**
     * Write text with realistic typing simulation (character by character)
     * Mimics human typing at ~40 WPM with pauses, backspaces, and corrections
     */
    async writeTextRealistic(text, options = {}) {
        try {
            // Ensure authenticated
            if (!this.isAuthenticated()) {
                await this.authenticate();
            }

            // Ensure we have valid credentials
            await this.ensureValidCredentials();

            let documentId = options.documentId;

            // Create new document if no ID provided
            if (!documentId) {
                const title = options.title || `Jarvis Output - ${new Date().toLocaleString()}`;
                documentId = await this.createDocument(title);
            }

            // Type text character by character with realistic delays
            await this.typeTextRealistic(documentId, text);

            // Get document URL
            const documentUrl = `https://docs.google.com/document/d/${documentId}`;

            return {
                success: true,
                documentId: documentId,
                documentUrl: documentUrl,
                message: 'Text typed to Google Docs successfully!'
            };
        } catch (error) {
            console.error('Error in writeTextRealistic:', error);
            // Check if error is due to insufficient scopes
            if (error.message && (
                error.message.includes('insufficient authentication scopes') ||
                error.message.includes('Insufficient Permission') ||
                error.message.includes('insufficient authentication')
            )) {
                // Clear tokens to force re-authentication with correct scopes
                console.warn('⚠️ Insufficient scopes detected. Clearing tokens for re-authentication...');
                this.oAuth2Client = null;
                if (fs.existsSync(this.tokenPath)) {
                    fs.unlinkSync(this.tokenPath);
                }
                return {
                    success: false,
                    error: 'Insufficient authentication scopes. Please re-authenticate with Google Docs to grant write permissions.',
                    message: 'Please re-authenticate: Your current Google Docs permissions are insufficient. Click "Write to Docs" again to re-authenticate with the correct permissions.',
                    requiresReauth: true
                };
            }
            
            return {
                success: false,
                error: error.message,
                message: `Failed to type to Google Docs: ${error.message}`
            };
        }
    }

    /**
     * Type text character by character with realistic human-like behavior
     * Optimized to batch characters and respect API rate limits
     * Varies typing speed between 20-35 WPM and spreads over multiple minutes
     */
    async typeTextRealistic(documentId, text) {
        const docs = google.docs({ version: 'v1', auth: this.oAuth2Client });
        
        // Rate limiting: Google Docs API allows 60 write requests per minute per user
        // We'll stay well under this by spreading typing over multiple minutes
        // Target: ~30 calls/minute maximum to leave plenty of buffer
        const BATCH_SIZE = 25; // Type 25 characters per API call
        const MIN_DELAY_BETWEEN_CALLS = 2000; // Minimum 2 seconds between API calls (max 30 calls/min)
        
        // Typing speed: 20-35 WPM (varies throughout)
        // Average word = 5 characters, so:
        // 20 WPM = 100 chars/min = 600ms per char
        // 35 WPM = 175 chars/min = 343ms per char
        const MIN_WPM = 20;
        const MAX_WPM = 35;
        
        // Calculate total time needed based on document length
        const avgCharsPerWord = 5;
        const totalWords = text.split(/\s+/).length;
        const avgWPM = (MIN_WPM + MAX_WPM) / 2; // ~27.5 WPM average
        const estimatedMinutes = Math.ceil(totalWords / avgWPM);
        const estimatedSeconds = estimatedMinutes * 60;
        
        console.log(`📝 Document stats: ${totalWords} words, ~${estimatedMinutes} minutes estimated typing time`);
        
        // Helper function to sleep
        const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        
        // Helper function to get current WPM (varies between 20-35)
        const getCurrentWPM = () => {
            return MIN_WPM + Math.random() * (MAX_WPM - MIN_WPM);
        };
        
        // Helper function to get delay per character based on WPM
        const getCharDelay = (wpm) => {
            const charsPerMinute = wpm * avgCharsPerWord;
            const msPerChar = (60 * 1000) / charsPerMinute;
            // Add some variation (±20%)
            return msPerChar * (0.8 + Math.random() * 0.4);
        };
        
        // Track last API call time for rate limiting
        let lastApiCallTime = 0;
        
        // Helper function to get current document end index
        const getEndIndex = async () => {
            const now = Date.now();
            const timeSinceLastCall = now - lastApiCallTime;
            if (timeSinceLastCall < MIN_DELAY_BETWEEN_CALLS) {
                await sleep(MIN_DELAY_BETWEEN_CALLS - timeSinceLastCall);
            }
            
            const document = await docs.documents.get({ documentId });
            lastApiCallTime = Date.now();
            return document.data.body.content 
                ? document.data.body.content[document.data.body.content.length - 1].endIndex - 1
                : 1;
        };

        // Helper function to insert text at index (with rate limiting)
        // Always refreshes the index before inserting to ensure it's valid
        const insertText = async (textToInsert, index = null) => {
            const now = Date.now();
            const timeSinceLastCall = now - lastApiCallTime;
            if (timeSinceLastCall < MIN_DELAY_BETWEEN_CALLS) {
                const waitTime = MIN_DELAY_BETWEEN_CALLS - timeSinceLastCall;
                console.log(`Rate limiting: waiting ${waitTime}ms before next API call...`);
                await sleep(waitTime);
            }
            
            // Always get the current document state to get accurate end index
            const document = await docs.documents.get({ documentId });
            lastApiCallTime = Date.now();
            
            const actualEndIndex = document.data.body.content 
                ? document.data.body.content[document.data.body.content.length - 1].endIndex - 1
                : 1;
            
            // Use provided index if it's valid (not beyond document length)
            // Otherwise use the actual end index to be safe
            let safeIndex;
            if (index !== null && index <= actualEndIndex) {
                // Provided index is valid
                safeIndex = index;
            } else {
                // Use actual end index for safety
                safeIndex = actualEndIndex;
                if (index !== null && index !== safeIndex) {
                    console.log(`⚠️ Index ${index} invalid (doc length: ${actualEndIndex}), using ${safeIndex} instead`);
                }
            }
            
            await docs.documents.batchUpdate({
                documentId: documentId,
                requestBody: {
                    requests: [{
                        insertText: {
                            location: { index: safeIndex },
                            text: textToInsert
                        }
                    }]
                }
            });
            lastApiCallTime = Date.now();
            return safeIndex + textToInsert.length; // Return the new end index
        };

        // Helper function to delete character (backspace) with rate limiting
        const deleteChar = async (index) => {
            if (index <= 1) return; // Can't delete before start
            
            const now = Date.now();
            const timeSinceLastCall = now - lastApiCallTime;
            if (timeSinceLastCall < MIN_DELAY_BETWEEN_CALLS) {
                await sleep(MIN_DELAY_BETWEEN_CALLS - timeSinceLastCall);
            }
            
            await docs.documents.batchUpdate({
                documentId: documentId,
                requestBody: {
                    requests: [{
                        deleteContentRange: {
                            range: {
                                startIndex: index - 1,
                                endIndex: index
                            }
                        }
                    }]
                }
            });
            lastApiCallTime = Date.now();
        };

        // Split text into paragraphs first
        const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
        let currentIndex = await getEndIndex();
        
        // Track progress
        const totalChars = text.length;
        let charsTyped = 0;
        let apiCallCount = 0;
        const startTime = Date.now();
        
        // Buffer to batch characters (declared at function scope so it's accessible in final flush)
        let charBuffer = '';
        let bufferIndex = 0;

        for (let paraIdx = 0; paraIdx < paragraphs.length; paraIdx++) {
            const paragraph = paragraphs[paraIdx];
            
            // Split paragraph into sentences
            const sentences = paragraph.match(/[^.!?]+[.!?]*/g) || [paragraph];
            
            for (let sentenceIdx = 0; sentenceIdx < sentences.length; sentenceIdx++) {
                const sentence = sentences[sentenceIdx].trim();
                if (!sentence) continue;
                
                // Split sentence into words
                const words = sentence.split(/(\s+)/);
                
                // Reset buffer for each sentence (but keep it in function scope)
                charBuffer = '';
                bufferIndex = 0;
                
                // Get current typing speed (varies between 20-35 WPM)
                let currentWPM = getCurrentWPM();
                
                for (let wordIdx = 0; wordIdx < words.length; wordIdx++) {
                    const word = words[wordIdx];
                    if (!word) continue;

                    // Occasionally change typing speed (every 5-10 words)
                    if (wordIdx > 0 && wordIdx % (5 + Math.floor(Math.random() * 6)) === 0) {
                        currentWPM = getCurrentWPM();
                    }

                    // Process each character in the word
                    for (let charIdx = 0; charIdx < word.length; charIdx++) {
                        const char = word[charIdx];
                        
                        // Add character to buffer
                        charBuffer += char;
                        bufferIndex++;
                        
                        // Calculate delay based on current WPM
                        let baseDelay = getCharDelay(currentWPM);
                        
                        // Adjust for punctuation and spaces
                        if (char.match(/[.,!?;:]/)) {
                            baseDelay *= 1.5; // Slower for punctuation
                        } else if (char === ' ') {
                            baseDelay *= 1.2; // Slightly slower for spaces
                        }
                        
                        // Add natural variation (±15%)
                        baseDelay = baseDelay * (0.85 + Math.random() * 0.3);
                        
                        // When buffer is full, flush it
                        const shouldFlush = bufferIndex >= BATCH_SIZE;
                        
                        if (shouldFlush && charBuffer.length > 0) {
                            try {
                                // Insert batched characters - insertText will refresh index automatically
                                currentIndex = await insertText(charBuffer, currentIndex);
                                charsTyped += charBuffer.length;
                                apiCallCount++;
                                charBuffer = '';
                                bufferIndex = 0;
                                
                                // Log progress every 10 API calls with WPM info
                                if (apiCallCount % 10 === 0) {
                                    const progress = ((charsTyped / totalChars) * 100).toFixed(1);
                                    const elapsedMinutes = ((Date.now() - startTime) / 60000).toFixed(1);
                                    const currentRate = charsTyped / (elapsedMinutes * avgCharsPerWord);
                                    console.log(`Typing progress: ${progress}% | ${charsTyped}/${totalChars} chars | ${apiCallCount} API calls | ~${currentRate.toFixed(1)} WPM | ${elapsedMinutes} min elapsed`);
                                }
                            } catch (error) {
                                console.error('Error inserting text:', error);
                                
                                // Check if it's an index error
                                if (error.message && (error.message.includes('Index') || error.message.includes('end index'))) {
                                    // Refresh index and retry
                                    currentIndex = await getEndIndex();
                                    try {
                                        currentIndex = await insertText(charBuffer, currentIndex);
                                        charsTyped += charBuffer.length;
                                        apiCallCount++;
                                        charBuffer = '';
                                        bufferIndex = 0;
                                    } catch (retryError) {
                                        console.error('Retry failed:', retryError);
                                        // If retry fails, refresh index and continue
                                        currentIndex = await getEndIndex();
                                        charBuffer = '';
                                        bufferIndex = 0;
                                    }
                                } else if (error.message && (error.message.includes('Quota exceeded') || error.message.includes('quota') || error.message.includes('429'))) {
                                    // Wait longer and retry with exponential backoff
                                    const waitTime = 15000; // Wait 15 seconds (longer to let quota reset)
                                    console.log(`⚠️ Quota exceeded (${apiCallCount} calls made). Waiting ${waitTime/1000} seconds for quota to reset...`);
                                    await sleep(waitTime);
                                    
                                    // Refresh index and retry
                                    currentIndex = await getEndIndex();
                                    currentIndex = await insertText(charBuffer, currentIndex);
                                    charsTyped += charBuffer.length;
                                    apiCallCount++;
                                    charBuffer = '';
                                    bufferIndex = 0;
                                } else {
                                    // Other error - refresh index and retry once
                                    currentIndex = await getEndIndex();
                                    try {
                                        currentIndex = await insertText(charBuffer, currentIndex);
                                        charsTyped += charBuffer.length;
                                        apiCallCount++;
                                        charBuffer = '';
                                        bufferIndex = 0;
                                    } catch (retryError) {
                                        console.error('Retry failed:', retryError);
                                        // If retry fails, refresh index and continue
                                        currentIndex = await getEndIndex();
                                        charBuffer = '';
                                        bufferIndex = 0;
                                    }
                                }
                            }
                        }
                        
                        // Delay between characters (based on WPM)
                        await sleep(baseDelay);
                        
                        // Make typos more frequently (5-8% chance) and spread throughout
                        // Typos are more common when typing faster or when tired
                        const typoChance = currentWPM > 30 ? 0.08 : 0.05; // More typos when typing faster
                        if (Math.random() < typoChance && char.match(/[a-zA-Z]/) && charIdx < word.length - 1) {
                            try {
                                // Type a wrong character (adjacent key on keyboard)
                                let wrongChar;
                                if (char.match(/[a-z]/)) {
                                    wrongChar = String.fromCharCode(
                                        char.charCodeAt(0) + (Math.random() < 0.5 ? 1 : -1)
                                    );
                                } else {
                                    wrongChar = String.fromCharCode(
                                        char.charCodeAt(0) + (Math.random() < 0.5 ? 1 : -1)
                                    );
                                }
                                
                                // Insert wrong character - refresh index first
                                currentIndex = await insertText(wrongChar, currentIndex);
                                const wrongCharIndex = currentIndex - wrongChar.length; // Index where wrong char was inserted
                                await sleep(200 + Math.random() * 150);
                                
                                // Realize mistake and backspace - delete the wrong character
                                const now = Date.now();
                                const timeSinceLastCall = now - lastApiCallTime;
                                if (timeSinceLastCall < MIN_DELAY_BETWEEN_CALLS) {
                                    await sleep(MIN_DELAY_BETWEEN_CALLS - timeSinceLastCall);
                                }
                                
                                await docs.documents.batchUpdate({
                                    documentId: documentId,
                                    requestBody: {
                                        requests: [{
                                            deleteContentRange: {
                                                range: {
                                                    startIndex: wrongCharIndex,
                                                    endIndex: wrongCharIndex + wrongChar.length
                                                }
                                            }
                                        }]
                                    }
                                });
                                lastApiCallTime = Date.now();
                                // After deletion, refresh index
                                currentIndex = await getEndIndex();
                                await sleep(400 + Math.random() * 300);
                                
                                // Type correct character
                                currentIndex = await insertText(char, currentIndex);
                                await sleep(150 + Math.random() * 100);
                            } catch (error) {
                                console.error('Error in typo simulation:', error);
                                // If typo fails, refresh index and continue
                                currentIndex = await getEndIndex();
                            }
                        }
                    }
                    
                    // Pause after word (longer for longer words)
                    if (word.trim().length > 0) {
                        const wordPause = Math.min(word.length * 20 + Math.random() * 60, 250);
                        await sleep(wordPause);
                    }
                }
                
                // Flush any remaining buffer before sentence pause
                if (charBuffer.length > 0) {
                    try {
                        currentIndex = await insertText(charBuffer, currentIndex);
                        charBuffer = '';
                        bufferIndex = 0;
                    } catch (error) {
                        console.error('Error flushing buffer:', error);
                        if (error.message && (error.message.includes('Quota exceeded') || error.message.includes('quota'))) {
                            await sleep(10000); // Wait 10 seconds on quota error
                        }
                        // Refresh index and try again
                        currentIndex = await getEndIndex();
                        try {
                            currentIndex = await insertText(charBuffer, currentIndex);
                            charBuffer = '';
                            bufferIndex = 0;
                        } catch (retryError) {
                            console.error('Retry flush failed:', retryError);
                            currentIndex = await getEndIndex();
                            charBuffer = '';
                            bufferIndex = 0;
                        }
                    }
                }
                
                // Pause after sentence (varies with WPM - slower typers pause longer)
                // At 20 WPM: longer pauses (3-5 seconds)
                // At 35 WPM: shorter pauses (1-2 seconds)
                const pauseMultiplier = 1 + ((MIN_WPM + MAX_WPM - currentWPM) / MAX_WPM); // Longer pause when slower
                const sentencePause = (1500 + Math.random() * 2000) * pauseMultiplier;
                await sleep(sentencePause);
                
                // Occasionally pause longer (thinking/editing time) - 25-35% chance
                // More likely when typing slower (thinking more)
                const thinkingChance = currentWPM < 25 ? 0.35 : 0.25;
                if (Math.random() < thinkingChance) {
                    const thinkingPause = (2500 + Math.random() * 5000) * pauseMultiplier; // 2.5-7.5+ seconds
                    await sleep(thinkingPause);
                }
            }
            
            // Longer pause after paragraph (varies with WPM)
            if (paraIdx < paragraphs.length - 1) {
                const pauseMultiplier = 1 + ((MIN_WPM + MAX_WPM - currentWPM) / MAX_WPM);
                const paraPause = (4000 + Math.random() * 4000) * pauseMultiplier; // 4-8+ seconds
                await sleep(paraPause);
                
                // Occasionally take a longer break (reading/reviewing) - 15% chance
                if (Math.random() < 0.15) {
                    const breakPause = (5000 + Math.random() * 10000) * pauseMultiplier; // 5-15+ seconds
                    console.log(`Taking a short break... (${(breakPause/1000).toFixed(1)}s)`);
                    await sleep(breakPause);
                }
            }
        }
        
        // Final flush of any remaining buffer
        if (charBuffer.length > 0) {
            try {
                currentIndex = await insertText(charBuffer, currentIndex);
            } catch (error) {
                console.error('Error in final flush:', error);
                // Refresh index and try again
                try {
                    currentIndex = await getEndIndex();
                    currentIndex = await insertText(charBuffer, currentIndex);
                } catch (retryError) {
                    console.error('Retry final flush failed:', retryError);
                }
            }
        }

        const totalTimeMinutes = ((Date.now() - startTime) / 60000).toFixed(1);
        const averageWPM = charsTyped / (totalTimeMinutes * avgCharsPerWord);
        console.log(`✅ Realistic typing completed for document: ${documentId}`);
        console.log(`📊 Total: ${charsTyped} characters typed using ${apiCallCount} API calls`);
        console.log(`⏱️ Time: ${totalTimeMinutes} minutes | Average speed: ~${averageWPM.toFixed(1)} WPM`);
    }

    /**
     * List Google Docs documents
     */
    async listDocuments(maxResults = 50) {
        try {
            if (!this.isAuthenticated()) {
                throw new Error('Not authenticated. Please authenticate first.');
            }
            
            await this.ensureValidCredentials();

            const drive = google.drive({ version: 'v3', auth: this.oAuth2Client });

            // List Google Docs files (MIME type: application/vnd.google-apps.document)
            const response = await drive.files.list({
                q: "mimeType='application/vnd.google-apps.document' and trashed=false",
                orderBy: 'modifiedTime desc',
                pageSize: maxResults,
                fields: 'files(id, name, modifiedTime, webViewLink)'
            });

            const documents = response.data.files || [];
            
            return {
                success: true,
                documents: documents.map(doc => ({
                    id: doc.id,
                    name: doc.name,
                    modifiedTime: doc.modifiedTime,
                    url: doc.webViewLink || `https://docs.google.com/document/d/${doc.id}`
                }))
            };
        } catch (error) {
            console.error('Error listing documents:', error);
            return {
                success: false,
                error: error.message,
                documents: []
            };
        }
    }

    /**
     * Revoke tokens and sign out
     */
    async signOut() {
        try {
            if (this.oAuth2Client) {
                await this.oAuth2Client.revokeCredentials();
            }
            
            // Delete token file
            if (fs.existsSync(this.tokenPath)) {
                fs.unlinkSync(this.tokenPath);
            }
            
            this.oAuth2Client = null;
            console.log('✅ Signed out from Google');
            return true;
        } catch (error) {
            console.error('Error signing out:', error);
            return false;
        }
    }
}

module.exports = GoogleDocsIntegration;

