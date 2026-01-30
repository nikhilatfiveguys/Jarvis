class JarvisOverlay {
    constructor() {
        this.isActive = false;
        this.currentScreenCapture = null;
        this.updateNotificationVisible = false; // Track if update notification is showing
        this.isElectron = typeof require !== 'undefined';
        this.isPinkMode = false; // Track pink mode state
        this.currentDocument = null; // Store current document from Exa API
        this.isProcessingDocument = false; // Track document processing state
        this.loadingInterval = null; // Track active loading animation interval
        this.loadingMessageInterval = null; // Track message rotation interval
        this.currentLoadingMessage = null; // Current loading message being displayed
        this.loadingMessageIndex = 0; // Index for rotating loading messages
        this.selectedModel = 'default'; // Track selected AI model
        this.selectedModelName = 'Jarvis'; // Track displayed model name
        this.grokFreakyMode = false; // Track Grok freaky mode state
        this.grokVoiceMode = false; // Track Grok voice mode state
        // ElevenLabs API key should be stored in Supabase Edge Function Secrets
        this.elevenLabsApiKey = null;
        this.elevenLabsVoiceId = 'ShB6BQqbEXZxWO5511Qq'; // Female voice
        this.elevenLabsVoiceId2 = '4NejU5DwQjevnR6mh3mb'; // Male voice
        this.useSecondVoice = false; // Toggle between voices
        this.hasBeenPositioned = false; // Track if overlay has been positioned (to avoid recentering)
        this.stealthModeEnabled = false; // Track stealth mode state
        
        // Interactive tutorial state
        this.tutorialStep = 0;
        this.tutorialToggleCount = 0;
        this.tutorialActive = false;
        
        // Load conversation history from localStorage
        try {
            const saved = localStorage.getItem('jarvis_conversation_history');
            this.conversationHistory = saved ? JSON.parse(saved) : [];
        } catch (e) {
            console.error('Failed to load conversation history:', e);
            this.conversationHistory = [];
        }
        
        this.licenseStatus = null;
        this.features = {};
        this.subscriptionJustActivated = false; // Flag to prevent showing limit notification right after subscription
        this.subscriptionActivatedTime = null;
        this.countdownTimerInterval = null; // Track countdown timer to stop it
        
        // Message tracking for free users (High tier models)
        this.maxFreeMessages = 5;
        this.messageCount = this.loadMessageCount();
        
        // Low model tracking for free users (30/day)
        this.maxFreeLowMessages = 30;
        this.lowMessageCount = this.loadLowMessageCount();
        this.isLowModelMode = false; // Track if we're in low model mode (due to credits exhausted)
        this.lowModelId = 'gpt-5-mini'; // GPT-5 Mini model ID for OpenAI API
        this.lowModelCharLimit = 2000; // Character limit for Low model input
        
        // Check and reset Low model message count if 24 hours have passed
        this.checkAndResetLowMessageCount();
        
        // Check for free access
        this.checkFreeAccess();
        
        // Check and reset message count if 24 hours have passed
        this.checkAndResetMessageCount();
        
        this.initializeElements();
        this.setupEventListeners();
        this.setupHotkeys();
        this.setupElectronIntegration();
        this.setupDragFunctionality();
        this.setupVoiceRecording(); // Voice recording handlers disabled inside, but subscription listeners still active
        // Initialize tutorial asynchronously - don't block
        this.initializeInteractiveTutorial().catch(e => console.error('Tutorial init:', e));
        // Check license asynchronously - don't block startup
        this.checkLicense().catch(e => console.error('License check:', e));
        this.updateMessageCounter();
    }

    async loadApiKeys() {
        try {
            // First try to get from main process via IPC (most reliable in Electron)
            if (this.isElectron && window.require) {
                try {
                    const { ipcRenderer } = window.require('electron');
                    const apiKeys = await ipcRenderer.invoke('get-api-keys');
                    if (apiKeys) {
                        this.apiKey = apiKeys.openai;
                        this.perplexityApiKey = apiKeys.perplexity;
                        this.claudeApiKey = apiKeys.claude;
                        this.openrouterApiKey = apiKeys.openrouter;
                        this.apiProxyUrl = apiKeys.apiProxyUrl;
                        this.supabaseAnonKey = apiKeys.supabaseAnonKey;
                        console.log('✅ API keys loaded from main process');
                        console.log('OpenAI key present:', !!this.apiKey);
                        console.log('Perplexity key present:', !!this.perplexityApiKey);
                        console.log('Claude key present:', !!this.claudeApiKey);
                        console.log('OpenRouter key present:', !!this.openrouterApiKey);
                        console.log('API Proxy URL:', this.apiProxyUrl || 'NOT CONFIGURED (using direct API calls)');
                        console.log('Supabase Anon Key present:', !!this.supabaseAnonKey);
                        console.log('Supabase Anon Key value:', this.supabaseAnonKey ? this.supabaseAnonKey.substring(0, 30) + '...' : 'MISSING');
                        console.log('Has Perplexity access:', !!(this.perplexityApiKey && this.perplexityApiKey.trim() !== '') || !!(this.apiProxyUrl && this.supabaseAnonKey));
                        
                        // Verify the anon key matches what we expect
                        const expectedAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibW5iZ291aWFtbXhwa2J5YXhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI1MjEwODcsImV4cCI6MjA3ODA5NzA4N30.ppFaxEFUyBWjwkgdszbvP2HUdXXKjC0Bu-afCQr0YxE';
                        if (this.supabaseAnonKey && this.supabaseAnonKey !== expectedAnonKey) {
                            console.warn('⚠️ Supabase anon key does not match expected value!');
                        }
                        // Rebuild tools array now that API keys are loaded
                        this.rebuildToolsArray();
                        return;
                    }
                } catch (ipcError) {
                    console.warn('Failed to get API keys via IPC, trying fallback:', ipcError);
                }
            }
            
            // Fallback to environment variables (works if nodeIntegration is true)
            this.apiKey = process.env.OPENAI_API_KEY;
            this.perplexityApiKey = process.env.PPLX_API_KEY;
            this.claudeApiKey = process.env.CLAUDE_API_KEY;
            this.openrouterApiKey = process.env.OPENROUTER_API_KEY;
            
            // API keys must be set via environment variables or IPC
            if (!this.apiKey) {
                console.warn('⚠️ No OpenAI API key found in environment or IPC.');
            }
            if (!this.perplexityApiKey) {
                console.warn('⚠️ No Perplexity API key found in environment or IPC.');
            }
            if (!this.claudeApiKey) {
                console.warn('⚠️ No Claude API key found in environment or IPC.');
            }
            if (!this.openrouterApiKey) {
                console.warn('⚠️ No OpenRouter API key found in environment or IPC.');
            }
            
            console.log('✅ API keys loaded (fallback method)');
            console.log('OpenAI key present:', !!this.apiKey);
            console.log('Perplexity key present:', !!this.perplexityApiKey);
            console.log('Claude key present:', !!this.claudeApiKey);
            console.log('OpenRouter key present:', !!this.openrouterApiKey);
            // Rebuild tools array now that API keys are loaded
            this.rebuildToolsArray();
        } catch (error) {
            console.error('Error loading API keys:', error);
            // API keys must be set via environment variables
            console.warn('⚠️ Failed to load API keys. Please set environment variables.');
            // Rebuild tools array (will be empty if no keys)
            this.rebuildToolsArray();
        }
    }

    rebuildToolsArray() {
        // Start with base tools
        this.tools = [
            {
                type: "function",
                name: "getscreenshot",
                description: "Takes a screenshot of the user's screen and returns it for analysis. Use this when the user asks about what's on their screen, wants you to analyze an image, or needs help with something visual.",
                parameters: {
                    type: "object",
                    properties: {},
                    required: []
                }
            }
        ];
        
        // Add web search tool if Perplexity API is available (either direct key or proxy)
        const hasPerplexityAccess = (this.perplexityApiKey && this.perplexityApiKey.trim() !== '') || 
                                     (this.apiProxyUrl && this.supabaseAnonKey);
        
        if (hasPerplexityAccess) {
            this.tools.push({
                type: "function",
                name: "web_search",
                description: "Search the live web for current information using Perplexity. You MUST call this for: current events, recent news, trends, anything after your knowledge cutoff, or when the user asks for 'latest' or 'recent' or 'current'. Do NOT say you cannot access the web or live data—you have this tool. Call it with a clear search query.",
                parameters: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "The search query (e.g. 'latest AI trends 2025', 'recent news about X')"
                        }
                    },
                    required: ["query"]
                }
            });
            console.log('✅ Perplexity web search tool added', {
                usingProxy: !!(this.apiProxyUrl && this.supabaseAnonKey),
                hasDirectKey: !!(this.perplexityApiKey && this.perplexityApiKey.trim() !== '')
            });
        } else {
            console.warn('⚠️ Perplexity API not available - web search tool not added', {
                hasDirectKey: !!(this.perplexityApiKey),
                hasProxy: !!(this.apiProxyUrl && this.supabaseAnonKey)
            });
        }
        
        // Add Claude tool if API key is available (check for truthy and non-empty string)
        if (this.claudeApiKey && this.claudeApiKey.trim() !== '') {
            this.tools.push({
                type: "function",
                name: "askclaude",
                description: "Use Claude AI for complex analytical questions, deep reasoning, philosophical questions, or when you need more thorough analysis. Call this when asked for deeper thinking or complex problem solving.",
                parameters: {
                    type: "object",
                    properties: {
                        question: {
                            type: "string",
                            description: "The question to send to Claude"
                        }
                    },
                    required: ["question"]
                }
            });
            console.log('✅ Claude AI tool added');
        } else {
            console.warn('⚠️ Claude API key not available - Claude tool not added');
        }
        
        // Add quiz tool - always available
        this.tools.push({
            type: "function",
            name: "create_quiz",
            description: "ALWAYS use this tool when user wants a quiz - NEVER write quiz questions as plain text. Creates an interactive quiz UI with clickable buttons. Use for ANY quiz request including: general topics, attached files/documents, or screen content. For screen quizzes, call getscreenshot first. Generate exact number of questions requested (1-20), default 5.",
            parameters: {
                type: "object",
                properties: {
                    topic: {
                        type: "string",
                        description: "The topic or subject of the quiz (e.g. 'Chapter 5: The French Revolution' or 'Attached Document Content')"
                    },
                    questions: {
                        type: "array",
                        description: "Array of quiz questions - generate exactly the number the user requested",
                        items: {
                            type: "object",
                            properties: {
                                question: {
                                    type: "string",
                                    description: "The question text"
                                },
                                options: {
                                    type: "array",
                                    description: "Array of 4 answer options",
                                    items: { type: "string" }
                                },
                                correct_index: {
                                    type: "number",
                                    description: "Index (0-3) of the correct answer"
                                },
                                explanation: {
                                    type: "string",
                                    description: "Brief explanation of why the answer is correct"
                                }
                            },
                            required: ["question", "options", "correct_index"]
                        }
                    },
                    num_questions: {
                        type: "number",
                        description: "Number of questions (default 5, max 10)"
                    }
                },
                required: ["topic", "questions"]
            }
        });
        console.log('✅ Quiz tool added');
    }

    async checkLicense() {
        try {
            if (this.isElectron && window.require) {
                const { ipcRenderer } = window.require('electron');
                const subscriptionResult = await ipcRenderer.invoke('check-subscription-status');
                
                if (subscriptionResult && subscriptionResult.hasActiveSubscription) {
                    this.licenseStatus = { 
                        valid: true, 
                        type: 'active',
                        email: subscriptionResult.subscriptionData.email
                    };
                    this.features = {
                        unlimited_messages: true,
                        screenshot_analysis: true,
                        voice_activation: true
                    };
                    console.log('✅ Premium subscription active');
                    
                    // Check if user needs to set password
                    this.checkPasswordNotification(subscriptionResult.subscriptionData.email);
                    
                    // Immediately clear any message limit notifications
                    if (this.dragOutput && !this.dragOutput.classList.contains('hidden')) {
                        const currentContent = this.dragOutput.innerHTML || this.dragOutput.textContent || '';
                        if (currentContent.includes('Message limit reached') || 
                            currentContent.includes('message limit reached') ||
                            currentContent.includes('Message Limit Reached') || 
                            currentContent.includes('message limit') || 
                            (currentContent.includes('Wait') && currentContent.includes('subscribe'))) {
                            console.log('🧹 Clearing message limit notification after subscription check');
                            this.dragOutput.classList.add('hidden');
                            this.dragOutput.innerHTML = '';
                            this.dragOutput.textContent = '';
                        }
                    }
                } else {
                    this.licenseStatus = { valid: false, type: 'free' };
                    this.features = {};
                    console.log('ℹ️ Free tier - subscription not active');
                    // Hide password notification for non-premium users
                    this.hidePasswordNotification();
                }
                
                // Update message counter display
                this.updateMessageCounter();
                
                // Update premium features visibility
                this.updatePremiumFeaturesVisibility();
            }
        } catch (error) {
            console.error('Failed to check license:', error);
            this.licenseStatus = { valid: false, type: 'error' };
            this.features = {};
            // Still update message counter even on error
            this.updateMessageCounter();
            this.updatePremiumFeaturesVisibility();
        }
    }
    
    // Check if user needs to set password and show notification
    async checkPasswordNotification(email) {
        if (!this.isElectron || !window.require) return;
        
        try {
            const { ipcRenderer } = window.require('electron');
            const result = await ipcRenderer.invoke('check-user-has-password', email);
            
            // Check if notification was dismissed in this session
            const dismissedKey = 'jarvis-password-notification-dismissed';
            const dismissed = localStorage.getItem(dismissedKey);
            
            if (result.success && !result.hasPassword && !dismissed) {
                console.log('🔐 User needs to set password, showing notification');
                this.showPasswordNotification();
            } else {
                this.hidePasswordNotification();
            }
        } catch (error) {
            console.error('Error checking password status:', error);
        }
    }
    
    // Show password notification
    showPasswordNotification() {
        const notification = document.getElementById('set-password-notification');
        if (notification) {
            notification.classList.remove('hidden');
            
            // Setup event listeners
            const openBtn = document.getElementById('password-notification-open-btn');
            const dismissBtn = document.getElementById('password-notification-dismiss-btn');
            
            if (openBtn && !openBtn._hasListener) {
                openBtn._hasListener = true;
                openBtn.addEventListener('click', () => {
                    if (this.isElectron && window.require) {
                        const { ipcRenderer } = window.require('electron');
                        ipcRenderer.invoke('open-account-window');
                    }
                    this.hidePasswordNotification();
                });
            }
            
            if (dismissBtn && !dismissBtn._hasListener) {
                dismissBtn._hasListener = true;
                dismissBtn.addEventListener('click', () => {
                    // Remember dismissal for this session
                    localStorage.setItem('jarvis-password-notification-dismissed', 'true');
                    this.hidePasswordNotification();
                });
            }
        }
    }
    
    // Hide password notification
    hidePasswordNotification() {
        const notification = document.getElementById('set-password-notification');
        if (notification) {
            notification.classList.add('hidden');
        }
    }
    
    updatePremiumFeaturesVisibility() {
        const hasPremium = this.hasPremiumAccess();
        
        // Model switcher is always visible in hamburger menu, but we check premium access when clicked
        // Reset to default model if not premium (only if a non-default model was selected)
        if (!hasPremium && this.selectedModel && this.selectedModel !== 'default') {
            console.log(`🤖 [MODEL SWITCHER] Resetting to default - premium required for ${this.selectedModel}`);
            this.selectedModel = 'default';
            this.selectedModelName = 'Jarvis';
            if (this.currentModelDisplay) {
                this.currentModelDisplay.textContent = 'Jarvis';
            }
        }
        
        // Disable stealth mode toggle for free users
        if (this.stealthModeToggle) {
            if (hasPremium) {
                this.stealthModeToggle.style.opacity = '1';
                this.stealthModeToggle.style.pointerEvents = 'auto';
            } else {
                this.stealthModeToggle.style.opacity = '0.5';
                this.stealthModeToggle.style.pointerEvents = 'auto'; // Still allow clicks to show upgrade message
            }
        }
    }

    getUserEmail() {
        try {
            const userData = localStorage.getItem('jarvis_user');
            if (userData) {
                const user = JSON.parse(userData);
                return user.email;
            }
            return null;
        } catch (error) {
            console.error('Failed to get user email:', error);
            return null;
        }
    }

    setupVoiceRecording() {
        if (!this.isElectron || !window.require) return;

        const { ipcRenderer } = window.require('electron');

        // Don't request microphone permission on startup - only when user tries to use voice recording

        // Listen for voice recording events from main process
        ipcRenderer.on('voice-recording-started', () => {
            this.showVoiceRecordingIndicator();
            this.showVoiceShortcutHint();
        });

        ipcRenderer.on('voice-recording-processing', () => {
            // Immediately hide recording indicator and show thinking state
            this.hideVoiceRecordingIndicator();
            this.hideVoiceShortcutHint();
            this.showVoiceProcessingState();
        });

        ipcRenderer.on('voice-recording-stopped', () => {
            this.hideVoiceRecordingIndicator();
            this.hideVoiceShortcutHint();
        });

        ipcRenderer.on('voice-transcription', (event, text) => {
            this.hideVoiceProcessingState();
            this.handleVoiceTranscription(text);
        });

        ipcRenderer.on('voice-recording-error', (event, error) => {
            this.hideVoiceProcessingState();
            this.showVoiceError(error);
        });

        // Listen for subscription cancellation
        ipcRenderer.on('subscription-cancelled', () => {
            this.handleSubscriptionCancelled();
        });

        // Listen for subscription activation
        ipcRenderer.on('subscription-activated', (event, data) => {
            this.handleSubscriptionActivated(data);
        });

        // When user signs in or signs up in account window, refresh license so 5/5 goes away immediately
        ipcRenderer.on('refresh-overlay-subscription', () => {
            this.checkLicense().catch(e => console.error('Refresh subscription:', e));
        });

        // Listen for password set event
        ipcRenderer.on('password-set', (event, email) => {
            console.log('🔐 Password set notification received for:', email);
            this.hidePasswordNotification();
            // Clear the dismissal flag since password is now set
            localStorage.removeItem('jarvis-password-notification-dismissed');
        });
        
        // Listen for answer screen shortcut trigger
        ipcRenderer.on('trigger-answer-screen', () => {
            console.log('🖥️ Answer screen triggered via shortcut');
            this.answerThis();
        });

        // Listen for paywall display request
        ipcRenderer.on('show-paywall', () => {
            this.showPaywall();
        });

        // Setup push-to-talk (hold Control key to record, release to stop)
        this.setupPushToTalk();
    }

    setupPushToTalk() {
        // Track if we started recording via push-to-talk
        this.isPushToTalkActive = false;
        this.pushToTalkKey = 'Control'; // The key to hold for push-to-talk
        
        // Listen for keydown - start recording when Control is held
        document.addEventListener('keydown', (e) => {
            // Only trigger on Control key alone (not with other modifiers as part of a combo)
            if (e.key === 'Control' && !e.repeat && !this.isPushToTalkActive) {
                // Small delay to distinguish from Ctrl+key combos
                this.pushToTalkTimeout = setTimeout(() => {
                    if (!this.isPushToTalkActive) {
                        this.isPushToTalkActive = true;
                        console.log('🎤 Push-to-talk: Starting recording (Control held)');
                        const { ipcRenderer } = window.require('electron');
                        ipcRenderer.invoke('start-push-to-talk');
                    }
                }, 150); // 150ms delay to avoid triggering on Ctrl+key combos
            }
        });

        // Listen for keyup - stop recording when Control is released
        document.addEventListener('keyup', (e) => {
            if (e.key === 'Control') {
                // Clear the timeout if key was released quickly (it was a combo)
                if (this.pushToTalkTimeout) {
                    clearTimeout(this.pushToTalkTimeout);
                    this.pushToTalkTimeout = null;
                }
                
                if (this.isPushToTalkActive) {
                    this.isPushToTalkActive = false;
                    console.log('🎤 Push-to-talk: Stopping recording (Control released)');
                    const { ipcRenderer } = window.require('electron');
                    ipcRenderer.invoke('stop-push-to-talk');
                }
            }
        });
    }

    async requestMicrophonePermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
        } catch (error) {
            console.error('Microphone permission denied:', error);
            // Don't show notification on startup - only show when user actually tries to record
        }
    }

    showVoiceRecordingIndicator() {
        // Create or show voice recording indicator
        let indicator = document.getElementById('voice-recording-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'voice-recording-indicator';
            indicator.className = 'voice-recording-indicator';
            indicator.innerHTML = '● recording';
            document.body.appendChild(indicator);
        }
        indicator.style.display = 'block';
    }

    hideVoiceRecordingIndicator() {
        const indicator = document.getElementById('voice-recording-indicator');
        if (indicator) {
            indicator.style.display = 'none';
        }
    }

    showVoiceShortcutHint() {
        // Only show hint the first few times
        const hintCount = parseInt(localStorage.getItem('jarvis-voice-hint-count') || '0');
        if (hintCount >= 3) return; // Stop showing after 3 times
        
        localStorage.setItem('jarvis-voice-hint-count', String(hintCount + 1));
        
        let hint = document.getElementById('voice-shortcut-hint');
        if (!hint) {
            hint = document.createElement('div');
            hint.id = 'voice-shortcut-hint';
            hint.className = 'voice-shortcut-hint';
            // Show different hint based on whether it was push-to-talk
            hint.innerHTML = this.isPushToTalkActive 
                ? 'Release <kbd>⌃</kbd> to stop'
                : 'Press <kbd>⌘S</kbd> to stop';
            document.body.appendChild(hint);
        } else {
            hint.innerHTML = this.isPushToTalkActive 
                ? 'Release <kbd>⌃</kbd> to stop'
                : 'Press <kbd>⌘S</kbd> to stop';
        }
        hint.style.display = 'block';
        
        // Auto-hide after 3 seconds
        setTimeout(() => this.hideVoiceShortcutHint(), 3000);
    }

    hideVoiceShortcutHint() {
        const hint = document.getElementById('voice-shortcut-hint');
        if (hint) {
            hint.style.display = 'none';
        }
    }

    showVoiceProcessingState() {
        // Show thinking indicator in the output area
        if (this.outputArea) {
            this.outputArea.innerHTML = '<div class="thinking">transcribing...</div>';
            this.outputArea.style.display = 'block';
        }
    }

    hideVoiceProcessingState() {
        // Will be replaced by actual content or cleared on error
    }

    handleVoiceTranscription(text) {
        if (text && text.trim()) {
            const trimmedText = text.trim();
            const lowerText = trimmedText.toLowerCase();
            
            // Check for screenshot voice command "6-7" or variations
            const screenshotPatterns = [
                '6-7', '67', '6 7', 'six seven', 'six-seven',
                'take screenshot', 'take a screenshot', 'screenshot',
                'capture screen', 'screen capture'
            ];
            
            const isScreenshotCommand = screenshotPatterns.some(pattern => 
                lowerText.includes(pattern) || lowerText === pattern
            );
            
            if (isScreenshotCommand) {
                // Clear input since we're executing a command
                if (this.textInput) this.textInput.value = '';
                // Take screenshot and analyze
                this.takeScreenshotAndAnalyze();
                return;
            }
            
            // Check for voice commands to write to docs (including /docs command)
            const docsCommandPatterns = [
                '/docs',
                'add to docs',
                'write to docs',
                'write on docs',
                'write on my doc',
                'write to my doc',
                'add to my doc',
                'write on my docs',
                'write to my docs',
                'add to my docs',
                'save to docs',
                'save to my doc',
                'save to my docs',
                'put this in my doc',
                'put this in docs',
                'write this to my doc',
                'write this in my doc'
            ];
            
            // Check for exact match or contains pattern
            const isDocsCommand = docsCommandPatterns.some(pattern => {
                if (pattern === '/docs') {
                    // Exact match for /docs command
                    return lowerText === '/docs' || lowerText.startsWith('/docs ');
                }
                return lowerText.includes(pattern);
            });
            
            if (isDocsCommand) {
                // Clear input since we're executing a command
                if (this.textInput) this.textInput.value = '';
                // Check if it's paste mode (user said "paste" in the command)
                const isPasteMode = lowerText.includes('paste') || lowerText.startsWith('/docs paste');
                // Trigger write to docs
                this.writeToDocs(isPasteMode);
                return;
            }
            
            // Check for Gmail voice commands
            const emailPatterns = [
                'what are my emails',
                'check my emails',
                'check my email',
                'show my emails',
                'show my email',
                'any emails',
                'any new emails',
                'emails today',
                'today\'s emails',
                'todays emails',
                'important emails',
                'any important emails',
                'unread emails',
                'new emails',
                'check gmail',
                'open gmail',
                'what\'s in my inbox',
                'whats in my inbox',
                'show inbox'
            ];
            
            const isEmailCommand = emailPatterns.some(pattern => lowerText.includes(pattern));
            
            if (isEmailCommand) {
                // Clear input since we're executing a command
                if (this.textInput) this.textInput.value = '';
                
                // Determine which type of emails to fetch
                if (lowerText.includes('important')) {
                    this.getImportantEmails();
                } else if (lowerText.includes('unread') || lowerText.includes('new')) {
                    this.getUnreadEmails();
                } else {
                    this.getTodaysEmails();
                }
                return;
            }
            
            // Check for Calendar view commands
            const calendarViewPatterns = [
                'what\'s on my calendar',
                'whats on my calendar',
                'what is on my calendar',
                'show my calendar',
                'show calendar',
                'check my calendar',
                'check calendar',
                'my schedule',
                'upcoming events',
                'upcoming meetings',
                'what do i have today',
                'what do i have this week',
                'any meetings',
                'any events'
            ];
            
            const isCalendarViewCommand = calendarViewPatterns.some(pattern => lowerText.includes(pattern));
            
            if (isCalendarViewCommand) {
                // Clear input since we're executing a command
                if (this.textInput) this.textInput.value = '';
                this.getUpcomingEvents();
                return;
            }
            
            // Check for Calendar add/create commands
            const calendarPatterns = [
                'add to calendar',
                'add to my calendar',
                'add this to calendar',
                'add this to my calendar',
                'schedule',
                'create event',
                'create a meeting',
                'create meeting',
                'book a meeting',
                'book meeting',
                'set a reminder',
                'set reminder',
                'add event',
                'calendar event',
                'put on my calendar',
                'put this on my calendar'
            ];
            
            const isCalendarCommand = calendarPatterns.some(pattern => lowerText.includes(pattern));
            
            if (isCalendarCommand) {
                // Clear input since we're executing a command
                if (this.textInput) this.textInput.value = '';
                // Show the calendar modal for manual event creation
                this.createCalendarEvent();
                return;
            }
            
            // Set the input value and send the transcribed text to the API
            this.textInput.value = trimmedText;
            this.sendMessage();
        }
    }
    
    async takeScreenshotAndAnalyze() {
        try {
            this.showNotification('📸 Taking screenshot...', 'info');
            
            if (this.isElectron && window.require) {
                const { ipcRenderer } = window.require('electron');
                const screenshot = await ipcRenderer.invoke('take-screenshot');
                
                if (screenshot) {
                    // Store the screenshot
                    this.currentScreenCapture = screenshot;
                    
                    // Show the screenshot in the UI and prompt for analysis
                    this.showNotification('Screenshot captured! Ask a question about it.', 'success');
                    
                    // Focus the input
                    if (this.textInput) {
                        this.textInput.focus();
                        this.textInput.placeholder = 'Ask about the screenshot...';
                    }
                } else {
                    this.showNotification('Failed to capture screenshot', 'error');
                }
            }
        } catch (error) {
            console.error('Screenshot error:', error);
            this.showNotification('Screenshot failed: ' + error.message, 'error');
        }
    }

    showVoiceError(error) {
        this.showNotification(`Voice recording error: ${error}`, 'error');
    }

    handleSubscriptionCancelled() {
        
        // Clear any stored subscription data
        try {
            localStorage.removeItem('jarvis_subscription');
        } catch (e) {
            console.error('Failed to clear subscription data:', e);
        }
        
        // Reset license status to free
        this.licenseStatus = { valid: false, type: 'free' };
        this.features = {};
        
        // Reset message count to 0 for free users
        this.resetMessageCount();
        
        // Update message counter display
        this.updateMessageCounter();
        
        // Show notification to user
        this.showNotification('Your subscription has been cancelled. You now have 5 free messages available every 24 hours.', 'error');
        
        // Update any UI elements that show subscription status
        this.updateAccountInfo();
    }

    async handleSubscriptionActivated(data) {
        console.log('🎉 Subscription activated event received:', data);
        
        // Stop countdown timer immediately
        if (this.countdownTimerInterval) {
            console.log('🛑 Stopping countdown timer');
            clearInterval(this.countdownTimerInterval);
            this.countdownTimerInterval = null;
        }
        
        // Set flag to prevent showing limit notification
        this.subscriptionJustActivated = true;
        this.subscriptionActivatedTime = Date.now();
        console.log('🏁 Set subscription activation flag - will block limit notifications for 30 seconds');
        
        // Immediately clear any "message limit reached" notifications
        if (this.dragOutput) {
            const currentContent = this.dragOutput.innerHTML || this.dragOutput.textContent || '';
            if (currentContent.includes('Message limit reached') || 
                currentContent.includes('message limit reached') ||
                currentContent.includes('Message Limit Reached') || 
                currentContent.includes('message limit') ||
                (currentContent.includes('Wait') && currentContent.includes('subscribe'))) {
                console.log('🧹 Clearing message limit notification on subscription activation');
                this.dragOutput.classList.add('hidden');
                this.dragOutput.innerHTML = '';
                this.dragOutput.textContent = '';
            }
        }
        
        // Force a fresh subscription check from Supabase
        await this.checkLicense();
        
        // Update license status to premium (in case checkLicense didn't update it yet)
        this.licenseStatus = { 
            valid: true, 
            type: 'active',
            email: data.email
        };
        this.features = {
            unlimited_messages: true,
            screenshot_analysis: true,
            voice_activation: true
        };
        
        // Reset message count for premium users
        this.resetMessageCount();
        
        // Update message counter (will hide it for premium users)
        this.updateMessageCounter();
        
        // Show success notification
        this.showNotification(data.message || 'Your Jarvis Premium subscription is now active!', false);
        
        // Update account info to reflect new subscription status
        this.updateAccountInfo();
        
        // Update premium features visibility
        this.updatePremiumFeaturesVisibility();
        
        // Set up a periodic check to ensure subscription status is updated (in case webhook is delayed)
        let checkCount = 0;
        const maxChecks = 5; // Check 5 times over 10 seconds
        const checkInterval = setInterval(async () => {
            checkCount++;
            await this.checkLicense();
            
            // Clear notification again after each check
            if (this.hasPremiumAccess() && this.dragOutput && !this.dragOutput.classList.contains('hidden')) {
                const currentContent = this.dragOutput.innerHTML || this.dragOutput.textContent || '';
                if (currentContent.includes('Message limit reached') || 
                    currentContent.includes('message limit reached') ||
                    currentContent.includes('Message Limit Reached') || 
                    currentContent.includes('message limit') ||
                    (currentContent.includes('Wait') && currentContent.includes('subscribe'))) {
                    this.dragOutput.classList.add('hidden');
                    this.dragOutput.innerHTML = '';
                    this.dragOutput.textContent = '';
                }
            }
            
            if (checkCount >= maxChecks || this.hasPremiumAccess()) {
                clearInterval(checkInterval);
            }
        }, 2000); // Check every 2 seconds
        
        console.log('✅ Subscription activation complete');
    }

    showPaywall() {
        
        // Show the paywall overlay
        this.showUpgradePrompt();
        
        // Show notification
        this.showNotification('Please subscribe to continue using Jarvis Premium features.', 'info');
    }


    async showUpgradePrompt() {
        // Open paywall/checkout directly
        if (this.isElectron && window.require) {
            try {
                const { ipcRenderer } = window.require('electron');
                // Create checkout session and open it
                const result = await ipcRenderer.invoke('create-checkout-session');
                if (result && result.success) {
                    this.showNotification('Opening checkout page...', 'info');
                } else {
                    // Fallback to paywall window
                    ipcRenderer.send('open-paywall');
                }
            } catch (error) {
                console.error('Error opening checkout:', error);
                // Fallback to paywall window
                const { ipcRenderer } = window.require('electron');
                ipcRenderer.send('open-paywall');
            }
        }
    }

    saveConversationHistory() {
        try {
            localStorage.setItem('jarvis_conversation_history', JSON.stringify(this.conversationHistory));
        } catch (e) {
            console.error('Failed to save conversation history:', e);
        }
    }

    extractText(data) {
        if (!data) return "No output.";
        if (typeof data === "string") return data;
        
        // Handle Responses API output array
        if (data.output && Array.isArray(data.output)) {
            for (const out of data.output) {
                // Message type with content
                if (out?.type === 'message' && out?.content) {
                    if (typeof out.content === 'string') return out.content;
                    if (Array.isArray(out.content)) {
                        for (const item of out.content) {
                            if ((item.type === "output_text" || item.type === "text") && item.text) {
                                return String(item.text);
                            }
                        }
                    }
                }
                // Direct output_text type
                if (out?.type === 'output_text' && out?.text) return String(out.text);
                // Role-based content
                if (out?.role === 'assistant' && out?.content) {
                    if (typeof out.content === 'string') return out.content;
                    if (Array.isArray(out.content)) {
                        for (const item of out.content) {
                            if ((item.type === "output_text" || item.type === "text") && item.text) {
                                return String(item.text);
                            }
                        }
                    }
                }
                // Content array
                if (out?.content && Array.isArray(out.content)) {
                    const textItem = out.content.find(c => c.type === "output_text" || c.type === "text");
                    if (textItem?.text) return String(textItem.text);
                }
                // Direct text
                if (out?.text && typeof out.text === 'string') return out.text;
                if (typeof out === 'string') return out;
            }
        }
        
        // Other common fields (Responses API)
        if (data.text && typeof data.text === 'string') return data.text;
        if (data.content && typeof data.content === 'string') return data.content;
        if (data.message?.content && typeof data.message.content === 'string') return data.message.content;
        
        // Debug: Log the actual response structure
        console.error('Could not extract text from response:', JSON.stringify(data, null, 2));
        return "Error: Could not extract text from response.";
    }
    
    // Same as extractText but returns null instead of error message when no text found
    extractTextSafe(data) {
        if (!data) return null;
        if (typeof data === "string") return data;
        
        // Handle Responses API output array
        if (data.output && Array.isArray(data.output)) {
            for (const out of data.output) {
                // Message type with content
                if (out?.type === 'message' && out?.content) {
                    if (typeof out.content === 'string') return out.content;
                    if (Array.isArray(out.content)) {
                        for (const item of out.content) {
                            if ((item.type === "output_text" || item.type === "text") && item.text) {
                                return String(item.text);
                            }
                        }
                    }
                }
                // Direct output_text type
                if (out?.type === 'output_text' && out?.text) return String(out.text);
                // Role-based content
                if (out?.role === 'assistant' && out?.content) {
                    if (typeof out.content === 'string') return out.content;
                    if (Array.isArray(out.content)) {
                        for (const item of out.content) {
                            if ((item.type === "output_text" || item.type === "text") && item.text) {
                                return String(item.text);
                            }
                        }
                    }
                }
            }
        }
        
        // Handle Chat Completions format
        if (data.choices && Array.isArray(data.choices) && data.choices.length > 0) {
            const choice = data.choices[0];
            if (choice.message?.content) return String(choice.message.content);
            if (choice.text) return String(choice.text);
        }
        
        // Handle direct content
        if (data.text && typeof data.text === 'string') return data.text;
        if (data.content && typeof data.content === 'string') return data.content;
        if (data.message?.content && typeof data.message.content === 'string') return data.message.content;
        
        // Return null if nothing found (safe version)
        return null;
    }

    initializeElements() {
        this.overlay = document.getElementById('jarvis-overlay');
        this.instructions = document.getElementById('instructions');
        this.activationIndicator = document.getElementById('activation-indicator');
        this.textInput = document.getElementById('text-input');
        this.dragOutput = document.getElementById('drag-output');
        this.dragHandle = document.getElementById('drag-handle');
        this.closeOutputBtn = document.getElementById('close-output');
        this.closeOutputFloating = document.getElementById('close-output-floating');
        this.answerThisBtn = document.getElementById('answer-this-btn');
        this.actionButtonsContainer = document.getElementById('action-buttons-container');
        this.humanizeBtn = document.getElementById('humanize-btn');
        this.documentNameModal = document.getElementById('document-name-modal');
        this.documentNameInput = document.getElementById('document-name-input');
        this.documentNameConfirm = document.getElementById('document-name-confirm');
        this.documentNameCancel = document.getElementById('document-name-cancel');
        this.documentSelectionModal = document.getElementById('document-selection-modal');
        this.documentList = document.getElementById('document-list');
        this.documentListLoading = document.getElementById('document-list-loading');
        this.documentSelectionCancel = document.getElementById('document-selection-cancel');
        this.documentSelectionNew = document.getElementById('document-selection-new');
        this.docsWritingIndicator = document.getElementById('docs-writing-indicator');
        this.docsDoneIndicator = document.getElementById('docs-done-indicator');
        this.docsOpenBtn = document.getElementById('docs-open-btn');
        this.docsDismissBtn = document.getElementById('docs-dismiss-btn');
        this.startBtn = document.getElementById('start-jarvis');
        this.resizeHandle = document.getElementById('resize-handle');
        this.settingsBtn = document.getElementById('settings-btn');
        this.settingsMenu = document.getElementById('settings-menu');
        this.fileBtn = document.getElementById('add-btn');
        this.clearChatBtn = document.getElementById('clear-chat-btn');
        this.settingsCloseBtn = document.getElementById('settings-close-btn');
        this.accountInfoBtn = document.getElementById('account-info-btn');
        this.hotkeysBtn = document.getElementById('hotkeys-btn');
        this.stealthModeToggle = document.getElementById('stealth-mode-toggle');
        this.stealthModeCheckbox = document.getElementById('stealth-mode-checkbox');
        this.fileInput = document.getElementById('file-input');
        this.accountModal = document.getElementById('account-modal');
        this.accountModalClose = document.getElementById('account-modal-close');
        this.accountModalOk = document.getElementById('account-modal-ok');
        this.userEmailElement = document.getElementById('user-email');
        this.premiumStatusElement = document.getElementById('premium-status');
        this.featureListElement = document.getElementById('feature-list');
        this.messageCounter = document.getElementById('message-counter');
        this.messageCountText = document.getElementById('message-count-text');
        this.attachmentsBar = document.getElementById('attachments-bar');
        this.messagesContainer = document.getElementById('messages-container');
        this.revealHistoryBtn = document.getElementById('reveal-history-btn');
        this.modelSwitcherBtn = document.getElementById('model-switcher-btn');
        this.modelSubmenu = document.getElementById('model-submenu');
        this.currentModelDisplay = document.getElementById('current-model-display');
        this.tierToggleCheckbox = document.getElementById('tier-toggle-checkbox');
        this.settingsSubmenuBtn = document.getElementById('settings-submenu-btn');
        this.settingsSubmenu = document.getElementById('settings-submenu');
        this.opacitySlider = document.getElementById('opacity-slider');
        this.colorWheelBtn = document.getElementById('color-wheel-btn');
        this.colorSubmenu = document.getElementById('color-submenu');
        this.colorPreview = document.getElementById('color-preview');
        
        // Output Toolbar elements
        this.outputToolbar = document.getElementById('output-toolbar');
        this.toolbarCopyBtn = document.getElementById('toolbar-copy-btn');
        this.toolbarDocsBtn = document.getElementById('toolbar-docs-btn');
        this.toolbarRetryBtn = document.getElementById('toolbar-retry-btn');
        
        // Track the last user query for retry functionality
        this.lastUserQuery = '';
        
        // Initialize first model as active by default
        if (this.modelSubmenu) {
            const firstModel = this.modelSubmenu.querySelector('.model-item[data-model="default"]');
            if (firstModel) {
                firstModel.classList.add('active');
            }
        }
        
        // Set up MutationObserver to keep scroll at bottom when content changes
        this.setupScrollObserver();
        
        
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.isDraggingOutput = false; // Track if output element is being dragged
        this.pendingAttachments = [];
        
        this.currentModel = 'gpt-5.1';
        // API keys will be loaded via loadApiKeys() method
        this.apiKey = null;
        this.perplexityApiKey = null;
        this.claudeApiKey = null;
        this.apiProxyUrl = null;
        this.supabaseAnonKey = null;
        // NaturalWrite API key should be stored in Supabase Edge Function Secrets
        this.naturalWriteApiKey = null;
        // Initialize tools array (will be rebuilt after API keys are loaded)
        this.tools = [];
        
        // Load API keys asynchronously and rebuild tools array when done
        this.loadApiKeys().catch(err => console.error('Failed to load API keys:', err));
    }

    setupEventListeners() {
        if (this.startBtn) this.startBtn.addEventListener('click', () => this.startJarvis());
        this.textInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        
        // Windows-specific: Request window focus when input field gets focus
        // This ensures the window can receive keyboard input
        this.textInput.addEventListener('focus', () => {
            if (this.isElectron) {
                const { ipcRenderer } = require('electron');
                ipcRenderer.invoke('request-focus').catch(() => {});
            }
        });
        
        
        if (this.answerThisBtn) {
            this.answerThisBtn.addEventListener('click', () => this.answerThis());
        }
        
        // Also handle the moved answer button in the container
        const answerBtnMoved = document.getElementById('answer-this-btn-moved');
        if (answerBtnMoved) {
            answerBtnMoved.addEventListener('click', () => this.answerThis());
        }
        
        if (this.humanizeBtn) {
            this.humanizeBtn.addEventListener('click', () => this.humanize());
        }
        
        // Output Toolbar event listeners
        this.initializeOutputToolbar();
        
        if (this.docsOpenBtn) {
            this.docsOpenBtn.addEventListener('click', () => this.openGoogleDoc());
        }
        
        if (this.docsDismissBtn) {
            this.docsDismissBtn.addEventListener('click', () => this.hideDocsDoneIndicator());
        }
        
        // Reveal history button event listener
        if (this.revealHistoryBtn) {
            this.revealHistoryBtn.addEventListener('click', () => this.toggleChatHistory());
        }
        
        // Model switcher in hamburger menu
        if (this.modelSwitcherBtn) {
            this.modelSwitcherBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleModelSubmenu();
            });
        }
        
        // Settings submenu toggle
        if (this.settingsSubmenuBtn) {
            this.settingsSubmenuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleSettingsSubmenu();
            });
        }
        
        // Initialize opacity value (default 95% = original fully visible)
        const savedOpacity = localStorage.getItem('jarvis-overlay-opacity') || '95';
        this.currentOpacity = parseInt(savedOpacity);
        this.setOverlayOpacity(parseInt(savedOpacity));
        
        // Set slider value if it exists (listener will be attached when menu opens)
        if (this.opacitySlider) {
            this.opacitySlider.value = savedOpacity;
        }
        
        // Color picker
        if (this.colorWheelBtn) {
            // Load saved color (default black)
            const savedColor = localStorage.getItem('jarvis-overlay-color') || 'black';
            this.setOverlayColor(savedColor);
            
            this.colorWheelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleColorSubmenu();
            });
        }
        
        // Color options
        if (this.colorSubmenu) {
            const colorOptions = this.colorSubmenu.querySelectorAll('.color-option');
            colorOptions.forEach(option => {
                option.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const color = option.getAttribute('data-color');
                    this.setOverlayColor(color);
                    this.toggleColorSubmenu();
                });
            });
        }
        
        // Model selection event listeners
        if (this.modelSubmenu) {
            const modelItems = this.modelSubmenu.querySelectorAll('.model-item');
            modelItems.forEach(item => {
                item.addEventListener('click', (e) => {
                    // Don't trigger model selection if clicking the freaky toggle
                    if (e.target.classList.contains('freaky-toggle')) {
                        return;
                    }
                    e.stopPropagation();
                    const model = item.getAttribute('data-model');
                    const modelName = item.querySelector('.model-name').textContent;
                    this.selectModel(model, modelName);
                    this.hideModelSubmenu();
                });
            });
            
            // Freaky mode toggle for Grok
            const freakyToggle = document.getElementById('freaky-toggle');
            const freakyCheckbox = document.getElementById('freaky-toggle-checkbox');
            if (freakyToggle) {
                freakyToggle.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
            }
            if (freakyCheckbox) {
                freakyCheckbox.addEventListener('change', (e) => {
                    e.stopPropagation();
                    this.toggleGrokFreakyMode(freakyCheckbox.checked);
                });
            }
            
            // "More models" button
            const moreModelsBtn = document.getElementById('model-more-btn');
            if (moreModelsBtn) {
                moreModelsBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleMoreModels();
                });
            }
        }
        
        // Grok voice mode toggle
        const grokVoiceBtn = document.getElementById('grok-voice-btn');
        if (grokVoiceBtn) {
            grokVoiceBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleGrokVoiceMode();
            });
        }
        
        // Voice selector toggle (switch between voices)
        const voiceSelectBtn = document.getElementById('voice-select-btn');
        if (voiceSelectBtn) {
            voiceSelectBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleVoiceSelection();
            });
        }
        
        // Settings button event listeners (hamburger menu)
        if (this.settingsBtn) {
            this.settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Toggle settings menu
                if (this.settingsMenu) {
                    if (this.settingsMenu.classList.contains('hidden')) {
                        this.settingsMenu.classList.remove('hidden');
                        // Attach opacity slider listener when menu opens
                        this.attachOpacitySliderWhenReady();
                    } else {
                        this.settingsMenu.classList.add('hidden');
                    }
                }
                // Track for tutorial
                this.advanceTutorial('hamburger');
            });
        }
        
        const handleFileInputChange = async (e) => {
            console.log('📂 File input changed');
            const files = Array.from(e.target.files || []);
            console.log('📄 Selected files:', files.length);
            if (files.length > 0) {
                await this.handleSelectedFiles(files);
                this.hideSettingsMenu();
            }
        };

        // Add file button - directly opens file picker
        if (this.fileBtn && this.fileInput) {
            console.log('✅ Add button and file input found, setting up listeners');
            this.fileBtn.addEventListener('click', (e) => {
                console.log('🖱️ Add button clicked');
                e.stopPropagation();
                this.fileInput.value = '';
                this.fileInput.click();
            });
        } else {
            console.warn('⚠️ Add button or file input not found', {
                fileBtn: !!this.fileBtn,
                fileInput: !!this.fileInput
            });
        }

        if (this.fileInput) {
            this.fileInput.addEventListener('change', handleFileInputChange);
        } else {
            console.warn('⚠️ File input element missing');
        }
        
        if (this.clearChatBtn) {
            this.clearChatBtn.addEventListener('click', () => this.clearChatHistory());
        }
        
        // Check for updates button
        const checkUpdatesBtn = document.getElementById('check-updates-btn');
        if (checkUpdatesBtn) {
            checkUpdatesBtn.addEventListener('click', () => {
                this.checkForUpdates();
                this.showUpdateNotification('🔍 Checking for updates...', 'info');
            });
        }
        
        // Quit app button
        const quitAppBtn = document.getElementById('quit-app-btn');
        if (quitAppBtn) {
            quitAppBtn.addEventListener('click', () => {
                this.quitApp();
            });
        }
        
        // Load and display current app version
        this.loadAppVersion();
        
        if (this.settingsCloseBtn) {
            this.settingsCloseBtn.addEventListener('click', () => {
                this.hideSettingsMenu();
                // Hide overlay like Option+Space does
                if (this.isElectron && window.require) {
                    try {
                        const { ipcRenderer } = window.require('electron');
                        ipcRenderer.invoke('hide-overlay');
                    } catch (e) {
                        console.error('Failed to hide overlay:', e);
                    }
                }
            });
        }
        
        if (this.accountInfoBtn) {
            this.accountInfoBtn.addEventListener('click', () => this.showAccountWindow());
        }
        
        if (this.hotkeysBtn) {
            this.hotkeysBtn.addEventListener('click', () => this.showHotkeysWindow());
        }
        
        // Stealth Mode toggle
        if (this.stealthModeCheckbox) {
            // Load saved preference (default to true/ON if not set)
            const savedPreference = localStorage.getItem('stealth_mode_enabled');
            const stealthModeEnabled = savedPreference === null ? true : savedPreference === 'true';
            this.stealthModeEnabled = stealthModeEnabled; // Initialize state
            this.stealthModeCheckbox.checked = stealthModeEnabled;
            console.log('🔧 Initial stealth mode state:', stealthModeEnabled);
            
            // Apply on load (with a small delay to ensure Electron is ready)
            // Only enable stealth mode on load if user has premium
            setTimeout(() => {
                // If stealth mode is saved as enabled but user doesn't have premium, disable it
                if (stealthModeEnabled && !this.hasPremiumAccess()) {
                    this.stealthModeCheckbox.checked = false;
                    this.stealthModeEnabled = false;
                    console.log('🔧 Stealth mode disabled on load - requires premium');
                } else {
                this.toggleStealthMode(stealthModeEnabled, false); // false = don't show notification on initial load
                }
            }, 500);
            
            // Listen for checkbox changes - this is the main handler
            // This will fire when checkbox is clicked directly OR when label is clicked
            this.stealthModeCheckbox.addEventListener('change', (e) => {
                const enabled = e.target.checked;
                console.log('🔧 Checkbox changed event fired! New state:', enabled);
                
                // Check if user has premium access (only allow enabling stealth mode with premium)
                if (enabled && !this.hasPremiumAccess()) {
                    // Revert the checkbox
                    e.target.checked = false;
                    this.showNotification('🔒 Stealth Mode requires Jarvis Premium. Upgrade to hide Jarvis from screen recordings!', false);
                    this.showUpgradePrompt();
                    return;
                }
                
                localStorage.setItem('stealth_mode_enabled', enabled.toString());
                this.toggleStealthMode(enabled, true); // true = show notification
            });
            
            // Also listen for click events as a backup
            this.stealthModeCheckbox.addEventListener('click', (e) => {
                console.log('🔧 Checkbox clicked! Current checked state:', this.stealthModeCheckbox.checked);
                // Don't prevent default - let checkbox toggle naturally
            });
            
            // Handle click on the entire toggle item area
            // Always manually toggle to ensure it works reliably
            if (this.stealthModeToggle) {
                this.stealthModeToggle.addEventListener('click', (e) => {
                    // Stop propagation so menu doesn't close
                    e.stopPropagation();
                    
                    // Check if user has premium access
                    if (!this.hasPremiumAccess()) {
                        this.showNotification('🔒 Stealth Mode requires Jarvis Premium. Upgrade to hide Jarvis from screen recordings!', false);
                        this.showUpgradePrompt();
                        return;
                    }
                    
                    // Prevent default label behavior to avoid double-toggle
                    // We'll handle the toggle manually
                    if (e.target.closest('label') || e.target.closest('.toggle-switch')) {
                        e.preventDefault();
                    }
                    
                    // Always toggle the checkbox manually to ensure it works
                    const currentState = this.stealthModeCheckbox.checked;
                    console.log('🔧 Toggle item clicked, current state:', currentState);
                    this.stealthModeCheckbox.checked = !currentState;
                    console.log('🔧 Toggled to:', this.stealthModeCheckbox.checked);
                    
                    // Trigger change event to fire all handlers (including IPC call)
                    const changeEvent = new Event('change', { bubbles: true, cancelable: true });
                    this.stealthModeCheckbox.dispatchEvent(changeEvent);
                });
            }
        }
        
        if (this.accountModalClose) {
            this.accountModalClose.addEventListener('click', () => this.hideAccountModal());
        }
        
        if (this.accountModalOk) {
            this.accountModalOk.addEventListener('click', () => this.hideAccountModal());
        }
        
        // Jarvis Low/High tier toggle (inside dropdown)
        this.setupTierToggle();
        
        
        // Close account modal when clicking outside
        if (this.accountModal) {
            this.accountModal.addEventListener('click', (e) => {
                if (e.target === this.accountModal) {
                    this.hideAccountModal();
                }
            });
        }

        // Initialize Google Services buttons
        this.setupGoogleServices();
        
        // Close settings menu when clicking outside
        document.addEventListener('click', (e) => {
            // Close settings menu when clicking outside (but not if clicking on model submenu or settings submenu)
            if (this.settingsMenu && !this.settingsMenu.contains(e.target) && !this.settingsBtn.contains(e.target)) {
                this.hideSettingsMenu();
                this.hideModelSubmenu();
                this.hideSettingsSubmenu();
                this.hideColorSubmenu();
            }
        });
        
        // Close menus and restore click-through when window loses focus (user clicked another window)
        window.addEventListener('blur', () => {
            // Hide all menus
            this.hideSettingsMenu();
            this.hideModelSubmenu();
            this.hideSettingsSubmenu();
            this.hideColorSubmenu();
            
            // Restore click-through so user can interact with other windows (but not if update notification is visible)
            if (this.isElectron && window.require && !this.updateNotificationVisible) {
                try {
                    const { ipcRenderer } = window.require('electron');
                    ipcRenderer.invoke('make-click-through').catch(() => {});
                } catch (e) {}
            }
        });
        
        // Make overlay interactive when needed, but allow clicks to work
        if (this.overlay) {
            let clickThroughTimeout = null;
            let menuCloseTimeout = null;
            let isCurrentlyInteractive = false;
            
            // Make overlay interactive when mouse enters overlay area
            this.overlay.addEventListener('mouseenter', () => {
                // Cancel any pending menu close
                clearTimeout(menuCloseTimeout);
                    clearTimeout(clickThroughTimeout);
                
                if (this.isElectron) {
                    const { ipcRenderer } = require('electron');
                    ipcRenderer.invoke('make-interactive').catch(() => {});
                    isCurrentlyInteractive = true;
                }
            });
            
            // Handle mouse leave - go back to click-through after delay
            this.overlay.addEventListener('mouseleave', () => {
                if (this.isElectron && isCurrentlyInteractive) {
                    // Don't set click-through if dragging output or resizing
                    if (this.isDraggingOutput || this.isResizing) {
                        return;
                    }
                    
                    // Don't set click-through if update notification is visible
                    if (this.updateNotificationVisible) {
                        return;
                    }
                    
                    // Delay closing menus to allow for mouse movement between elements
                    clearTimeout(menuCloseTimeout);
                    menuCloseTimeout = setTimeout(() => {
                        // Close any open menus when mouse leaves overlay
                        this.hideSettingsMenu();
                        this.hideModelSubmenu();
                        this.hideSettingsSubmenu();
                        this.hideColorSubmenu();
                        
                        // Go back to click-through (only if update notification is not visible)
                        if (!this.updateNotificationVisible) {
                            const { ipcRenderer } = require('electron');
                            ipcRenderer.invoke('make-click-through').catch(() => {});
                            isCurrentlyInteractive = false;
                        }
                    }, 500); // 500ms delay before closing menus
                }
            });
            
            // Keep interactive when interacting with settings menu
            if (this.settingsMenu) {
                this.settingsMenu.addEventListener('mouseenter', () => {
                    if (this.isElectron) {
                        clearTimeout(clickThroughTimeout);
                        const { ipcRenderer } = require('electron');
                        ipcRenderer.invoke('make-interactive').catch(() => {});
                        isCurrentlyInteractive = true;
                    }
                });
                this.settingsMenu.addEventListener('mousedown', () => {
                    if (this.isElectron) {
                        clearTimeout(clickThroughTimeout);
                        const { ipcRenderer } = require('electron');
                        ipcRenderer.invoke('make-interactive').catch(() => {});
                        ipcRenderer.invoke('request-focus').catch(() => {});
                        isCurrentlyInteractive = true;
                    }
                });
            }
            
            // Keep interactive when interacting with settings submenu (where opacity slider is)
            if (this.settingsSubmenu) {
                this.settingsSubmenu.addEventListener('mouseenter', () => {
                    if (this.isElectron) {
                        clearTimeout(clickThroughTimeout);
                        const { ipcRenderer } = require('electron');
                        ipcRenderer.invoke('make-interactive').catch(() => {});
                        isCurrentlyInteractive = true;
                    }
                });
                this.settingsSubmenu.addEventListener('mousedown', () => {
                    if (this.isElectron) {
                        clearTimeout(clickThroughTimeout);
                        const { ipcRenderer } = require('electron');
                        ipcRenderer.invoke('make-interactive').catch(() => {});
                        ipcRenderer.invoke('request-focus').catch(() => {});
                        isCurrentlyInteractive = true;
                    }
                });
            }
            
            // Keep interactive when interacting with color submenu
            if (this.colorSubmenu) {
                this.colorSubmenu.addEventListener('mouseenter', () => {
                    if (this.isElectron) {
                        clearTimeout(clickThroughTimeout);
                        const { ipcRenderer } = require('electron');
                        ipcRenderer.invoke('make-interactive').catch(() => {});
                        isCurrentlyInteractive = true;
                    }
                });
                this.colorSubmenu.addEventListener('mousedown', () => {
                    if (this.isElectron) {
                        clearTimeout(clickThroughTimeout);
                        const { ipcRenderer } = require('electron');
                        ipcRenderer.invoke('make-interactive').catch(() => {});
                        ipcRenderer.invoke('request-focus').catch(() => {});
                        isCurrentlyInteractive = true;
                    }
                });
            }
            
            // Handle clicks on overlay - always make interactive
            this.overlay.addEventListener('mousedown', (e) => {
                if (this.isElectron) {
                    clearTimeout(clickThroughTimeout);
                    const { ipcRenderer } = require('electron');
                    // Make interactive when clicking anywhere on overlay
                    ipcRenderer.invoke('make-interactive').catch(() => {});
                    isCurrentlyInteractive = true;
                    // Request focus to ensure window can receive input
                    ipcRenderer.invoke('request-focus').catch(() => {});
                }
            });
            
            // Keep overlay interactive while mouse is down (for dragging)
            this.overlay.addEventListener('mousemove', (e) => {
                if (this.isElectron && e.buttons > 0) {
                    // Mouse is being held down, keep interactive
                    clearTimeout(clickThroughTimeout);
                    if (!isCurrentlyInteractive) {
                        const { ipcRenderer } = require('electron');
                        ipcRenderer.invoke('make-interactive').catch(() => {});
                        isCurrentlyInteractive = true;
                    }
                }
            });
            
            // Ensure overlay starts in click-through mode
            if (this.isElectron) {
                const { ipcRenderer } = require('electron');
                // Set initial state to click-through after overlay is ready
                setTimeout(() => {
                    ipcRenderer.invoke('make-click-through').catch(() => {});
                    isCurrentlyInteractive = false;
                }, 1000); // Delay to allow overlay to fully initialize
            }
        }
        
        if (this.closeOutputBtn) {
            this.closeOutputBtn.addEventListener('click', () => this.hideOutput());
        }
        if (this.closeOutputFloating) {
            this.closeOutputFloating.addEventListener('click', () => this.hideOutput());
        }
        // Attach drag listeners to drag-output (will be called initially and when new drag-output is created)
        this.attachDragListeners();
    }
    
    attachDragListeners() {
        if (this.dragOutput) {
            // Attach drag listeners (new elements won't have listeners, so safe to add)
            this.dragOutput.addEventListener('dragstart', (e) => this.handleDragStart(e));
            this.dragOutput.addEventListener('dragend', (e) => this.handleDragEnd(e));
            // Track drag - CRITICAL: Keep window interactive during entire drag operation
            // Don't switch to click-through while dragging, as it breaks drag-drop on Windows
            this.dragOutput.addEventListener('drag', (e) => {
                if (this.isDraggingOutput && this.isElectron) {
                    const { ipcRenderer } = require('electron');
                    // Always keep window interactive during drag - don't switch to click-through
                    // This is essential for drag-drop to work, especially on Windows
                    ipcRenderer.invoke('make-interactive');
                }
            });
        }
        
        // Resize handle functionality - prevent it from interfering with drag
        if (this.resizeHandle) {
            this.resizeHandle.addEventListener('mousedown', (e) => {
                // Only handle resize if click is on the resize handle itself, not if dragging
                e.preventDefault();
                e.stopPropagation();
                this.handleResizeStart(e);
            });
            // Prevent drag events on resize handle
            this.resizeHandle.addEventListener('dragstart', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        }
    }

    setupHotkeys() {
        document.addEventListener('keydown', (e) => {
            if (e.metaKey && e.shiftKey && e.code === 'Space') {
                e.preventDefault();
                this.toggleOverlay();
            }
            if (e.key === 'Escape') {
                this.hideOverlay();
            }
        });
    }

    setupElectronIntegration() {
        if (!this.isElectron) return;
        
        const { ipcRenderer } = require('electron');
        
        // Track update state
        this.pendingUpdate = null;
        this.updateReadyToInstall = false;
            
        ipcRenderer.on('toggle-overlay', () => {
            this.toggleOverlay();
        });
        
        // Listen for toggle events from main process (for tutorial tracking)
        ipcRenderer.on('overlay-toggled', () => {
            this.advanceTutorial('toggle');
        });
        
        // Listen for permission restart prompt
        ipcRenderer.on('show-permission-restart-prompt', () => {
            this.showPermissionRestartPrompt();
        });
        
        ipcRenderer.on('show-overlay', () => {
            this.showOverlay();
        });
        
        ipcRenderer.on('hide-overlay', () => {
            this.hideOverlay();
        });
        
        // Auto-update handlers
        ipcRenderer.on('update-available', (event, info) => {
            console.log('📦 Update available:', info);
            this.pendingUpdate = info;
            this.updateReadyToInstall = false;
            this.showUpdateInMenu(info.version, 'available');
            this.showUpdateNotification(`🔄 Update v${info.version} available. Click Update to download and install automatically.`, 'update', false, info);
        });

        ipcRenderer.on('update-download-progress', (event, progress) => {
            console.log('📥 Download progress:', progress.percent);
            this.showUpdateInMenu(null, 'downloading', progress.percent);
            this.showUpdateNotification(`⬇️ Downloading... ${Math.round(progress.percent)}%`, 'downloading');
        });

        ipcRenderer.on('update-downloaded', async (event, info) => {
            console.log('✅ Update downloaded:', info);
            this.pendingUpdate = info;
            this.updateReadyToInstall = true;
            this.showUpdateInMenu(info.version, 'ready');
            // Automatically install when download completes (one-click update)
            this.showUpdateNotification(`✅ Update v${info.version} downloaded. Installing and restarting...`, 'downloading');
            // Small delay to show the message, then install
            setTimeout(() => {
                this.installUpdate();
            }, 1000);
        });
        
        ipcRenderer.on('update-error', (event, error) => {
            // Ignore network/timeout errors - don't show to user
            if (error && (error.includes('504') || error.includes('timeout') || error.includes('time-out') || error.includes('Gateway'))) {
                this.hideUpdateNotification();
                return; // Silently ignore
            }

            // Only show critical errors (like code signature issues)
            if (error && error.includes('code signature')) {
                this.showUpdateNotification('Opening download page...', 'info');
                const { shell } = require('electron');
                shell.openExternal('https://github.com/nikhilatfiveguys/Jarvis/releases/latest');
            }
            // Don't show other update errors - they're not critical
            this.hideUpdateNotification();
        });
        
        ipcRenderer.on('update-not-available', (event) => {
            console.log('✅ App is up to date');
            this.showUpdateNotification("You're up to date! ✅", 'success', true);
        });
    }

    async showUpdateNotification(message, type = 'info', allowDismissForever = false, updateInfo = null) {
        // Check if user dismissed "up to date" notifications
        if (type === 'success' && localStorage.getItem('jarvis-hide-uptodate-notification') === 'true') {
            return;
        }

        // Remove any existing update notification
        this.hideUpdateNotification();

        // Disable click-through so user can interact with the update notification
        if (this.isElectron && window.require) {
            try {
                const { ipcRenderer } = window.require('electron');
                // Await the call and ensure it completes
                await ipcRenderer.invoke('set-ignore-mouse-events', false);
                
                // Also ensure window is focused and visible
                ipcRenderer.invoke('request-focus').catch(() => {});
                
                // Set a flag to prevent other handlers from re-enabling click-through
                this.updateNotificationVisible = true;
            } catch (e) {
                console.error('Failed to disable click-through:', e);
            }
        }

        const notification = document.createElement('div');
        notification.id = 'update-notification';
        notification.className = `update-notification ${type === 'success' ? 'success' : type === 'update' ? 'update-available' : ''}`;

        let html = `<div class="update-notification-text">${message}</div>`;

        // Add action buttons based on type
        if (type === 'update' && updateInfo) {
            html += `
                <div class="update-notification-actions">
                    <button class="update-notification-btn dismiss" onclick="window.jarvisApp.hideUpdateNotification()">Later</button>
                    <button class="update-notification-btn primary" onclick="window.jarvisApp.downloadUpdate()">Update</button>
                </div>
            `;
        } else if (type === 'ready') {
            // No buttons needed - auto-installing
            html += `<div class="update-notification-text" style="margin-top: 4px; font-size: 11px; opacity: 0.8;">Installing and restarting...</div>`;
        } else if (type === 'downloading') {
            // No buttons during download, just show progress
            // Optionally add a cancel button if needed in the future
        } else if (allowDismissForever) {
            html += `
                <div class="update-notification-actions">
                    <button class="update-notification-btn dismiss" onclick="window.jarvisApp.dismissUpToDateForever()">Don't show again</button>
                    <button class="update-notification-btn" onclick="window.jarvisApp.hideUpdateNotification()">OK</button>
                </div>
            `;
        }

        notification.innerHTML = html;
        document.body.appendChild(notification);

        // Keep notification interactive - prevent mouseleave from re-enabling click-through
        notification.addEventListener('mouseenter', () => {
            if (this.isElectron && window.require) {
                try {
                    const { ipcRenderer } = window.require('electron');
                    ipcRenderer.invoke('set-ignore-mouse-events', false).catch(() => {});
                } catch (e) {}
            }
        });

        // Attach event listeners to buttons (more reliable than inline onclick)
        const buttons = notification.querySelectorAll('.update-notification-btn');
        buttons.forEach(button => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                
                if (button.classList.contains('dismiss') && button.textContent.includes("Don't show again")) {
                    this.dismissUpToDateForever();
                } else if (button.textContent === 'OK' || button.classList.contains('dismiss')) {
                    this.hideUpdateNotification();
                } else if (button.textContent === 'Update') {
                    this.downloadUpdate();
                } else if (button.textContent === 'Install & Restart') {
                    this.installUpdate();
                }
            });
            
            // Ensure buttons keep window interactive on hover
            button.addEventListener('mouseenter', () => {
                if (this.isElectron && window.require) {
                    try {
                        const { ipcRenderer } = window.require('electron');
                        ipcRenderer.invoke('set-ignore-mouse-events', false).catch(() => {});
                    } catch (e) {}
                }
            });
        });

        // Auto-hide success notifications after 5 seconds (unless they have important actions)
        if (type === 'success' || type === 'info') {
            setTimeout(() => this.hideUpdateNotification(), 5000);
        }
    }

    hideUpdateNotification() {
        const notification = document.getElementById('update-notification');
        if (notification) {
            notification.remove();
        }
        
        // Clear the flag
        this.updateNotificationVisible = false;
        
        // Re-enable click-through after hiding notification
        if (this.isElectron && window.require) {
            try {
                const { ipcRenderer } = window.require('electron');
                // Small delay to ensure notification is fully removed before re-enabling click-through
                setTimeout(() => {
                    ipcRenderer.invoke('make-click-through').catch(() => {});
                }, 200);
            } catch (e) {
                console.error('Failed to re-enable click-through:', e);
            }
        }
    }

    dismissUpToDateForever() {
        localStorage.setItem('jarvis-hide-uptodate-notification', 'true');
        this.hideUpdateNotification();
    }
    
    showUpdateInMenu(version, status, progress = 0) {
        const menuItem = document.getElementById('update-available-menu-item');
        if (!menuItem) return;
        
        menuItem.classList.remove('hidden');
        
        if (status === 'available') {
            menuItem.innerHTML = `<span>🔄 Update v${version}</span><span class="update-badge">Download</span>`;
            menuItem.onclick = () => this.downloadUpdate();
        } else if (status === 'downloading') {
            menuItem.innerHTML = `<span>⬇️ Downloading...</span><span class="update-badge">${Math.round(progress)}%</span>`;
            menuItem.onclick = null;
        } else if (status === 'ready') {
            menuItem.innerHTML = `<span>✅ Update Ready</span><span class="update-badge">Install</span>`;
            menuItem.onclick = () => this.installUpdate();
        }
    }

    // Show limit exceeded notification with button to add credits
    showLimitExceededNotification() {
        // Remove any existing limit notification
        this.hideLimitExceededNotification();
        
        // Auto-switch to Low model
        this.switchToLowModel(true); // silent = true

        const notification = document.createElement('div');
        notification.id = 'limit-exceeded-notification';
        notification.className = 'update-notification limit-exceeded';
        
        notification.innerHTML = `
            <div class="update-notification-text">
                ⚠️ Credits exhausted!
            </div>
            <div class="update-notification-actions">
                <button class="update-notification-btn dismiss" id="limit-close-btn">OK</button>
                <button class="update-notification-btn primary" id="limit-add-credits-btn">Add Credits</button>
            </div>
        `;

        document.body.appendChild(notification);

        // Make window interactive immediately and keep it interactive
        if (this.isElectron && window.require) {
            const { ipcRenderer } = window.require('electron');
            
            // Make interactive immediately
            ipcRenderer.invoke('make-interactive');
            
            // Keep making it interactive on any mouse movement over the notification
            notification.addEventListener('mousemove', () => {
                ipcRenderer.invoke('make-interactive');
            });
            
            notification.addEventListener('mouseenter', () => {
                ipcRenderer.invoke('make-interactive');
            });
        }

        const closeBtn = document.getElementById('limit-close-btn');
        const addCreditsBtn = document.getElementById('limit-add-credits-btn');

        // Use mousedown with one-time flag
        let closeTriggered = false;
        let addCreditsTriggered = false;
        
        const handleClose = (e) => {
            if (closeTriggered) return;
            closeTriggered = true;
            e.preventDefault();
            e.stopPropagation();
            this.hideLimitExceededNotification();
        };
        
        const handleAddCredits = (e) => {
            if (addCreditsTriggered) return;
            addCreditsTriggered = true;
            e.preventDefault();
            e.stopPropagation();
            this.openAddCredits();
        };

        closeBtn.addEventListener('mousedown', handleClose);
        closeBtn.addEventListener('click', handleClose);
        
        addCreditsBtn.addEventListener('mousedown', handleAddCredits);
        addCreditsBtn.addEventListener('click', handleAddCredits);

        // Trigger animation
        setTimeout(() => notification.classList.add('visible'), 10);
    }

    hideLimitExceededNotification() {
        const notification = document.getElementById('limit-exceeded-notification');
        if (notification) {
            notification.classList.remove('visible');
            setTimeout(() => notification.remove(), 300);
            
            // Restore click-through mode
            if (this.isElectron && window.require) {
                const { ipcRenderer } = window.require('electron');
                ipcRenderer.invoke('make-click-through').catch(() => {});
            }
        }
    }

    async openAddCredits() {
        // Polar product ID for adding credits
        const creditsProductId = 'f1c1e554-61c7-40fd-802f-b79c238383a2';
        
        console.log('🛒 Opening Polar checkout for credits...');

        if (this.isElectron && window.require) {
            try {
                const { ipcRenderer } = window.require('electron');
                const result = await ipcRenderer.invoke('create-credits-checkout', creditsProductId);
                
                if (!result.success) {
                    console.error('Failed to create checkout:', result.error);
                    this.showNotification('❌ Failed to open checkout: ' + result.error, false);
                }
            } catch (e) {
                console.error('Failed to open checkout:', e);
                this.showNotification('❌ Failed to open checkout', false);
            }
        }

        this.hideLimitExceededNotification();
    }
    
    async downloadUpdate() {
        try {
            this.showUpdateNotification('⬇️ Downloading update...', 'downloading');
            const { ipcRenderer } = require('electron');
            const result = await ipcRenderer.invoke('download-update');
            if (!result.success) {
                // Check for code signature error - open download page instead
                if (result.error && result.error.includes('code signature')) {
                    this.showUpdateNotification('Opening download page...', 'info');
                    const { shell } = require('electron');
                    shell.openExternal('https://github.com/nikhilatfiveguys/Jarvis/releases/latest');
                } else {
                    this.showUpdateNotification('❌ Download failed: ' + result.error, 'error');
                }
            }
            // Note: Installation will happen automatically when download completes via update-downloaded event
        } catch (error) {
            console.error('Download error:', error);
            // Check for code signature error
            if (error.message && error.message.includes('code signature')) {
                this.showUpdateNotification('Opening download page...', 'info');
                const { shell } = require('electron');
                shell.openExternal('https://github.com/nikhilatfiveguys/Jarvis/releases/latest');
            } else {
                this.showUpdateNotification('❌ Download failed: ' + error.message, 'error');
            }
        }
    }

    async installUpdate() {
        try {
            this.showUpdateNotification('🔄 Installing update and restarting...', 'downloading');
            const { ipcRenderer } = require('electron');
            // Don't await - let it quit immediately
            ipcRenderer.invoke('install-update').catch((error) => {
                console.error('Install error:', error);
                // Check for code signature error
                if (error.message && error.message.includes('code signature')) {
                    this.showUpdateNotification('Opening download page...', 'info');
                    const { shell } = require('electron');
                    shell.openExternal('https://github.com/nikhilatfiveguys/Jarvis/releases/latest');
                } else {
                    this.showUpdateNotification('❌ Install failed: ' + error.message, 'error');
                }
            });
        } catch (error) {
            console.error('Install error:', error);
            // Check for code signature error
            if (error.message && error.message.includes('code signature')) {
                this.showUpdateNotification('Opening download page...', 'info');
                const { shell } = require('electron');
                shell.openExternal('https://github.com/nikhilatfiveguys/Jarvis/releases/latest');
            } else {
                this.showUpdateNotification('❌ Install failed: ' + error.message, 'error');
            }
        }
    }
    
    quitApp() {
        // Show confirmation dialog
        const confirmed = confirm('Are you sure you want to quit Jarvis?');
        if (confirmed) {
            if (this.isElectron && window.require) {
                const { ipcRenderer } = window.require('electron');
                ipcRenderer.invoke('quit-app');
            }
        }
    }
    
    async checkForUpdates() {
        try {
            const { ipcRenderer } = require('electron');
            const result = await ipcRenderer.invoke('check-for-updates');
            if (!result.success) {
                this.showUpdateNotification('❌ Update check failed: ' + result.error, 'error');
            }
        } catch (error) {
            console.error('Update check error:', error);
            this.showUpdateNotification('❌ Update check failed: ' + error.message, 'error');
        }
    }
    
    async loadAppVersion() {
        try {
            if (this.isElectron && window.require) {
                const { ipcRenderer } = window.require('electron');
                const version = await ipcRenderer.invoke('get-app-version');
                const versionDisplay = document.getElementById('app-version-display');
                if (versionDisplay && version) {
                    versionDisplay.textContent = 'v' + version;
                }
            }
        } catch (error) {
            console.error('Failed to load app version:', error);
        }
    }

    setupDragFunctionality() {
        if (!this.dragHandle) return;
        
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;
        
        this.dragHandle.addEventListener('mousedown', (e) => {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            
            // Get current position
            const rect = this.overlay.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            
            this.overlay.style.cursor = 'grabbing';
            e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            
            // Get overlay dimensions
            const overlayRect = this.overlay.getBoundingClientRect();
            const overlayWidth = overlayRect.width;
            const overlayHeight = overlayRect.height;
            
            // Calculate new position
            let newLeft = initialLeft + dx;
            let newTop = initialTop + dy;
            
            // Constrain to viewport - keep fully visible
            const maxLeft = window.innerWidth - overlayWidth;
            const maxTop = window.innerHeight - overlayHeight;
            
            newLeft = Math.max(0, Math.min(maxLeft, newLeft));
            newTop = Math.max(0, Math.min(maxTop, newTop));
            
            this.overlay.style.left = `${newLeft}px`;
            this.overlay.style.top = `${newTop}px`;
            this.overlay.style.transform = 'none';
        });
        
        document.addEventListener('mouseup', () => {
            if (isDragging) {
                isDragging = false;
                this.overlay.style.cursor = 'default';
                // Track drag for tutorial
                this.advanceTutorial('drag');
            }
        });
        
        // Double-click to center at top
        this.dragHandle.addEventListener('dblclick', () => {
            const overlayWidth = this.overlay.offsetWidth || 400;
            const overlayHeight = this.overlay.offsetHeight || 200;
            const centerX = Math.max(0, (window.innerWidth - overlayWidth) / 2);
            const topY = Math.max(0, Math.min(20, window.innerHeight - overlayHeight - 20));
            this.overlay.style.left = `${centerX}px`;
            this.overlay.style.top = `${topY}px`;
            this.overlay.style.transform = 'none';
        });
    }

    moveToTopMiddle() {
        if (!this.overlay) return;
        const overlayWidth = this.overlay.offsetWidth || 400;
        const centerX = (window.innerWidth - overlayWidth) / 2;
        const topY = 20; // 20px from the top
        
        this.overlay.style.left = `${centerX}px`;
        this.overlay.style.top = `${topY}px`;
        this.overlay.style.transform = 'none';
    }

    // Interactive Tutorial System
    async initializeInteractiveTutorial() {
        if (!this.isElectron) return;
        
        try {
            const { ipcRenderer } = window.require('electron');
            const needsTutorial = await ipcRenderer.invoke('needs-interactive-tutorial');
            
            if (needsTutorial) {
                // Check if screen permission is granted
                const hasPermission = await ipcRenderer.invoke('check-screen-permission');
                
                if (hasPermission) {
                    // Permission granted - show tutorial
                    this.tutorialActive = true;
                    this.tutorialStep = 1;
                    this.showTutorialStep(1);
                } else {
                    // Permission not granted - show permission banner
                    this.showPermissionRestartPrompt();
                }
            }
        } catch (e) {
            console.error('Failed to check tutorial status:', e);
        }
    }
    
    showTutorialStep(step) {
        const tutorial = document.getElementById('onboarding-tutorial');
        const tutorialText = document.getElementById('tutorial-text');
        const tutorialIcon = document.getElementById('tutorial-icon');
        const doneBtn = document.getElementById('tutorial-done-btn');
        
        if (!tutorial || !tutorialText || !tutorialIcon) return;
        
        // Show tutorial
        tutorial.classList.remove('hidden');
        doneBtn.classList.add('hidden');
        
        switch(step) {
            case 1:
                tutorialIcon.innerHTML = '⌨️';
                tutorialText.innerHTML = 'Press <kbd>⌥ Option</kbd> + <kbd>Space</kbd> twice to open/close overlay';
                break;
            case 2:
                tutorialIcon.innerHTML = `<div class="drag-dots-icon">
                    <span class="dot"></span><span class="dot"></span>
                    <span class="dot"></span><span class="dot"></span>
                    <span class="dot"></span><span class="dot"></span>
                </div>`;
                tutorialText.innerHTML = 'Use the 6 dots to move Jarvis around';
                break;
            case 3:
                tutorialIcon.innerHTML = '📸';
                tutorialText.innerHTML = 'Press <strong>Answer Screen</strong> to answer any question on your screen';
                break;
            case 4:
                tutorialIcon.innerHTML = `<div class="hamburger-icon">
                    <span></span><span></span><span></span>
                </div>`;
                tutorialText.innerHTML = 'Press the hamburger menu to access all features';
                doneBtn.classList.remove('hidden');
                doneBtn.onclick = () => this.completeTutorial();
                break;
        }
        
        this.tutorialStep = step;
    }
    
    advanceTutorial(action) {
        if (!this.tutorialActive) return;
        
        switch(action) {
            case 'toggle':
                if (this.tutorialStep === 1) {
                    this.tutorialToggleCount++;
                    if (this.tutorialToggleCount >= 2) {
                        this.showTutorialStep(2);
                    }
                }
                break;
            case 'drag':
                if (this.tutorialStep === 2) {
                    this.showTutorialStep(3);
                }
                break;
            case 'answer-screen':
                if (this.tutorialStep === 3) {
                    this.showTutorialStep(4);
                }
                break;
            case 'hamburger':
                if (this.tutorialStep === 4) {
                    // Already on step 4 (hamburger), no need to advance
                }
                break;
        }
    }
    
    async completeTutorial() {
        const tutorial = document.getElementById('onboarding-tutorial');
        if (tutorial) {
            tutorial.classList.add('hidden');
        }
        
        this.tutorialActive = false;
        
        if (this.isElectron) {
            try {
                const { ipcRenderer } = window.require('electron');
                await ipcRenderer.invoke('complete-interactive-tutorial');
            } catch (e) {
                console.error('Failed to complete tutorial:', e);
            }
        }
    }
    
    showPermissionRestartPrompt() {
        // Show permission banner at the top like the tutorial
        const banner = document.getElementById('permission-banner');
        
        if (!banner) return;
        
        // Show the banner
        banner.classList.remove('hidden');
    }
    
    hidePermissionBanner() {
        const banner = document.getElementById('permission-banner');
        if (banner) {
            banner.classList.add('hidden');
        }
    }

    toggleOverlay() {
        if (this.isActive) {
            // Don't allow hiding overlay during tutorial
            if (this.tutorialActive) {
                this.showNotification('Complete the tutorial first!');
                return;
            }
            this.hideOverlay();
        } else {
            this.showOverlay();
        }
        
        // Track toggles for tutorial
        this.advanceTutorial('toggle');
    }

    async showOverlay() {
        if (!this.overlay) return;
        
        // Reset cursor
        this.overlay.style.cursor = 'default';
        
        // Re-check subscription status when overlay is shown
        await this.checkLicense();
        
        // Clear any message limit notifications if user has premium
        if (this.hasPremiumAccess() && this.dragOutput && !this.dragOutput.classList.contains('hidden')) {
            const currentContent = this.dragOutput.innerHTML || this.dragOutput.textContent || '';
            if (currentContent.includes('Message limit reached') || 
                currentContent.includes('message limit reached') ||
                currentContent.includes('Message Limit Reached') || 
                currentContent.includes('message limit') ||
                (currentContent.includes('Wait') && currentContent.includes('subscribe'))) {
                this.dragOutput.classList.add('hidden');
                this.dragOutput.innerHTML = '';
                this.dragOutput.textContent = '';
            }
        }
        
        this.overlay.classList.remove('hidden');
        this.instructions.classList.add('hidden');
        
        // DISABLED: No automatic recentering - position is set by CSS
        // if (!this.hasBeenPositioned) {
        //     this.recenterOverlay();
        //     this.hasBeenPositioned = true;
        // }
        
        this.isActive = true;
        this.textInput.focus();
        
        // Update message counter to reflect current subscription status
        this.updateMessageCounter();
        
        // Only show welcome notification if not in tutorial mode
        if (!this.tutorialActive) {
        this.showNotification('Jarvis is ready! Look for the red X button in the top-right corner of this message.');
        }
    }

    recenterOverlay() {
        if (!this.overlay) return;
        
        const overlayWidth = this.overlay.offsetWidth || 400;
        const overlayHeight = this.overlay.offsetHeight || 200;
        const centerX = Math.max(0, (window.innerWidth - overlayWidth) / 2);
        const centerY = Math.max(0, (window.innerHeight - overlayHeight) / 2);
        
        // Ensure overlay stays within bounds
        const maxLeft = window.innerWidth - 10;
        const maxTop = window.innerHeight - 10;
        const finalX = Math.min(maxLeft, Math.max(-(overlayWidth - 10), centerX));
        const finalY = Math.min(maxTop, Math.max(-(overlayHeight - 10), centerY));
        
        this.overlay.style.left = `${finalX}px`;
        this.overlay.style.top = `${finalY}px`;
        this.overlay.style.transform = 'none';
        this.overlay.style.position = 'fixed';
    }


    async captureScreen() {
        if (this.isElectron) {
            const { ipcRenderer } = require('electron');
            this.currentScreenCapture = await ipcRenderer.invoke('take-screenshot');
        } else {
            try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { mediaSource: 'screen' }
            });
            const video = document.createElement('video');
            video.srcObject = stream;
            video.play();
            
                    const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                video.addEventListener('loadedmetadata', () => {
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    ctx.drawImage(video, 0, 0);
                    this.currentScreenCapture = canvas.toDataURL('image/png');
                    stream.getTracks().forEach(track => track.stop());
                });
            } catch (error) {
                console.error('Screen capture failed:', error);
                throw error;
            }
        }
    }

    async analyzeContent(userQuestion = null) {
        if (!this.currentScreenCapture) {
            this.showNotification('I need to capture your screen first. Please try again.');
            return;
        }
        
        this.showLoadingNotification();
        
        try {
            const imageUrl = this.currentScreenCapture;
            const analysis = await this.analyzeWithOpenAI(imageUrl, userQuestion);
            this.showNotification(analysis, true);
        } catch (error) {
            console.error('Analysis failed:', error);
            this.showNotification(`Analysis failed: ${error.message}. Please try again.`);
        }
    }

    async analyzeWithOpenAI(imageUrl, userQuestion) {
        try {
            const prompt = userQuestion || "What am I looking at? Please analyze the screen content and describe what you see.";
            
            // Always use Edge Function - API keys stored in Supabase Secrets
            if (!this.apiProxyUrl || !this.supabaseAnonKey) {
                throw new Error('API keys must be stored in Supabase Edge Function Secrets.');
            }
            
            const response = await fetch(this.apiProxyUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.supabaseAnonKey}`,
                    'Content-Type': 'application/json',
                    'apikey': this.supabaseAnonKey
                },
                body: JSON.stringify({
                    provider: 'openai',
                    endpoint: 'responses',
                    payload: {
                        model: this.currentModel,
                        instructions: 'Answer ONLY with the direct answer. No preface, no restating the question. Be as short as possible while correct.',
                        input: [{
                            role: 'user',
                            content: [
                                { type: 'input_text', text: prompt },
                                { type: 'input_image', image_url: imageUrl }
                            ]
                        }]
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            const analysis = this.extractText(data) || 'Unable to analyze';
            
            this.conversationHistory.push({ role: 'user', content: prompt });
            this.conversationHistory.push({ 
                role: 'assistant', 
                content: analysis,
                model: this.selectedModelName || 'Jarvis'
            });
            
            if (this.conversationHistory.length > 30) {
                this.conversationHistory = this.conversationHistory.slice(-30);
            }
            
            this.saveConversationHistory();
            
            return analysis;
        } catch (error) {
            console.error('OpenAI API error:', error);
            throw error;
        }
    }

    async captureAndAnalyzeScreen(message) {
        try {
            // Re-check subscription status before processing (in case it was cancelled)
            await this.checkLicense();
            
            // Check if user has license for screenshot analysis
            if (!this.features.screenshotAnalysis) {
                this.showNotification('Screenshot analysis requires a Pro subscription. Please upgrade to continue.');
                this.showUpgradePrompt();
                return;
            }

            this.showLoadingNotification();
            await this.captureScreen();
            
            if (!this.currentScreenCapture) {
                this.showNotification('Failed to capture screenshot');
                return;
            }
            const response = await this.analyzeWithOpenAI(this.currentScreenCapture, message);
            this.showNotification(response, true);
            
            // Increment message count for free users
            if (!this.hasPremiumAccess()) {
                this.incrementMessageCount();
            }
        } catch (error) {
            console.error('Screenshot analysis error:', error);
            this.showNotification('Error analyzing screenshot');
        }
    }

    async processMessage(message) {
        try {
            // Re-check subscription status before processing (in case it was cancelled or activated)
            await this.checkLicense();
            
            // Double-check premium access after license check completes
            const hasPremium = this.hasPremiumAccess();
            
            // ALWAYS clear any existing "message limit reached" notification if user now has premium
            if (hasPremium) {
                if (this.dragOutput && !this.dragOutput.classList.contains('hidden')) {
                    const currentContent = this.dragOutput.innerHTML || this.dragOutput.textContent || '';
                    if (currentContent.includes('Message limit reached') || 
                        currentContent.includes('message limit reached') ||
                        currentContent.includes('Message Limit Reached') || 
                        currentContent.includes('message limit') || 
                        (currentContent.includes('Wait') && currentContent.includes('subscribe'))) {
                        // Clear the notification immediately
                        this.dragOutput.classList.add('hidden');
                        this.dragOutput.innerHTML = '';
                        this.dragOutput.textContent = '';
                    }
                }
            }
            
            // Check message limit for free users ONLY if not premium
            // Triple-check: premium status, grace period flag, and subscription activation time
            const shouldBlock = hasPremium || 
                               (this.subscriptionJustActivated && this.subscriptionActivatedTime && (Date.now() - this.subscriptionActivatedTime < 30000));
            
            if (!shouldBlock && this.hasReachedMessageLimit()) {
                // One final check before showing
                if (this.hasPremiumAccess() || this.subscriptionJustActivated) {
                    console.log('🚫 Final block - premium detected before showing notification');
                    return;
                }
                this.showMessageLimitReached();
                return;
            }

            const lowerMessage = message.toLowerCase();
            
            // Check for aaron2 keyword - grant free access to all features
            if (lowerMessage.includes('aaron2')) {
                this.grantFreeAccess();
                return; // Exit early to avoid API call
            }
            
            // Check for nicole keyword - toggle pink mode
            if (lowerMessage.includes('nicole')) {
                this.togglePinkMode();
                return; // Exit early to avoid API call
            }
            
            // Check for URL in message - only load document if appropriate
            const urlMatch = message.match(/(https?:\/\/[^\s]+)/);
            if (urlMatch) {
                const url = urlMatch[1];
                const shouldLoadDocument = this.shouldLoadDocumentFromUrl(message, url);
                
                if (shouldLoadDocument) {
                await this.extractAndProcessDocument(url, message);
                return;
                }
                // If not loading document, continue with normal message processing
                // The URL will be included in the message sent to the AI
            }
            
            this.showLoadingNotification();
            
            // Route to OpenRouter if a specific model is selected, otherwise use default ChatGPT
            let response;
            
            // Handle Jarvis Low (GPT-5 Mini) model - uses OpenAI API directly
            if (this.selectedModel === 'jarvis-low' || this.isLowModelMode) {
                console.log(`🤖 [MODEL SWITCHER] Using Jarvis Low (GPT-5 Mini) via OpenAI API: ${this.lowModelId}`);
                response = await this.callLowModel(message);
                
                // Increment low message count for free users
                if (!this.hasPremiumAccess()) {
                    this.incrementLowMessageCount();
                }
            } else if (this.selectedModel && this.selectedModel !== 'default') {
                console.log(`🤖 [MODEL SWITCHER] Using OpenRouter model: ${this.selectedModel} (${this.selectedModelName})`);
                console.log(`🤖 [MODEL SWITCHER] OpenRouter API key present: ${!!this.openrouterApiKey}`);
                response = await this.callOpenRouter(message, this.selectedModel);
            } else {
                console.log(`🤖 [MODEL SWITCHER] Using default Responses API (currentModel: ${this.currentModel})`);
                response = await this.callChatGPT(message);
            }
            
            // Don't show notification if quiz or other interactive content was displayed
            if (response === '__QUIZ_DISPLAYED__') {
                console.log('📝 Quiz displayed - skipping showNotification');
                return;
            }
            
            this.showNotification(response, true);
            
            // Increment message count for free users (for non-low models)
            if (!this.hasPremiumAccess() && !this.isUsingLowModel()) {
                this.incrementMessageCount();
            }
        } catch (error) {
            console.error('Message processing error:', error);
            const errorMessage = error.message || "Sorry, I'm having trouble processing that request right now.";
            this.showNotification(errorMessage);
        }
    }

    async callChatGPT(message, screenshot = null) {
        try {
            // Build conversation context with full history for better continuity
            let conversationContext = '';
            if (this.conversationHistory.length > 0) {
                conversationContext = '\n\nPREVIOUS CONVERSATION (remember this context):\n' + 
                    this.conversationHistory.slice(-10).map((msg, idx) => 
                        `${idx + 1}. ${msg.role === 'user' ? 'User' : 'Jarvis'}: ${msg.content.substring(0, 300)}`
                    ).join('\n');
            }

            // Add document context if available
            let documentContext = '';
            if (this.currentDocument) {
                documentContext = `\n\nCURRENT DOCUMENT CONTEXT:
Title: ${this.currentDocument.title}
URL: ${this.currentDocument.url}
Content: ${this.currentDocument.content.substring(0, 2000)}...`;
            }

            // Build input content - include screenshot if provided
            const inputContent = [{ type: 'input_text', text: message }];
            if (screenshot) {
                // Validate screenshot format - must be a data URL with base64 data
                if (typeof screenshot !== 'string') {
                    console.error('❌ Screenshot is not a string:', typeof screenshot);
                    throw new Error('Invalid screenshot format. Expected data URL string.');
                }
                if (!screenshot.startsWith('data:image/')) {
                    console.error('❌ Screenshot missing data URL prefix:', screenshot.substring(0, 50));
                    throw new Error('Invalid screenshot format. Expected data URL starting with data:image/.');
                }
                // Ensure screenshot has base64 data (not just the prefix)
                const base64Index = screenshot.indexOf('base64,');
                if (base64Index === -1) {
                    console.error('❌ Screenshot missing base64 prefix');
                    throw new Error('Screenshot must be a base64-encoded data URL.');
                }
                const base64Data = screenshot.substring(base64Index + 7); // +7 for "base64,"
                if (!base64Data || base64Data.length === 0) {
                    console.error('❌ Screenshot has empty base64 data');
                    throw new Error('Screenshot base64 data is empty. Please try capturing again.');
                }
                if (base64Data.length < 100) {
                    console.warn('⚠️ Screenshot base64 data seems very short:', base64Data.length);
                }
                inputContent.push({ type: 'input_image', image_url: screenshot });
                console.log('📸 Including screenshot in OpenAI API request, total length:', screenshot.length, 'base64 length:', base64Data.length);
                // Clear screenshot after using it (if it's the instance variable)
                if (screenshot === this.currentScreenCapture) {
                    this.currentScreenCapture = null;
                }
            }
            const hasPerplexityAccess = (this.perplexityApiKey && this.perplexityApiKey.trim() !== '') || 
                                         (this.apiProxyUrl && this.supabaseAnonKey);
            const webSearchHint = hasPerplexityAccess ? ' You HAVE live web search via the web_search tool. For current events, recent news, latest trends, or anything that needs up-to-date information, you MUST call web_search first—never say you cannot access live web data.' : '';
            const claudeHint = this.claudeApiKey ? ' Use the askclaude tool for complex analytical questions, deep reasoning, philosophical questions, or when you need more thorough analysis.' : '';
            const quizHint = ' IMPORTANT: When the user asks to be quizzed, tested, or wants practice questions, you MUST use the create_quiz tool - NEVER write out quiz questions as text. This applies to ALL quiz requests including quizzes about attached files/documents. Generate exactly the number of questions they request (1-20), default 5 if unspecified. For screen-based quizzes, use getscreenshot first then create_quiz.';
            const instructions = `You are Jarvis. An AI assistant powered by many different AI models. Answer directly without any preface, introduction, or phrases like "here's the answer" or "the answer is". Just provide the answer immediately. Respond concisely. Use getscreenshot for screen questions.${webSearchHint}${claudeHint}${quizHint}${conversationContext}${documentContext}`;

            // Debug: Log available tools
            console.log('🔧 Available tools:', this.tools.map(t => t.name));
            console.log('🔧 Has web_search tool:', this.tools.some(t => t.name === 'web_search'));
            console.log('🔧 Has create_quiz tool:', this.tools.some(t => t.name === 'create_quiz'));
            console.log('🔧 Perplexity access check:', {
                hasDirectKey: !!(this.perplexityApiKey && this.perplexityApiKey.trim() !== ''),
                hasProxy: !!(this.apiProxyUrl && this.supabaseAnonKey),
                apiProxyUrl: this.apiProxyUrl || 'NOT SET',
                supabaseAnonKey: this.supabaseAnonKey ? 'SET' : 'NOT SET'
            });
            console.log('Claude tool registered:', this.tools.some(t => t.name === 'askclaude'));
            
            const requestPayload = {
                model: this.currentModel,
                instructions: instructions,
                input: [{ role: 'user', content: inputContent }],
                tools: this.tools
            };
            
            console.log('API Request payload:', JSON.stringify(requestPayload, null, 2));

            this.showLoadingNotification();
            
            // Use IPC to main process (most reliable in Electron)
            let response;
            if (this.isElectron && window.require) {
                try {
                    const { ipcRenderer } = window.require('electron');
                    console.log('🔒 Using IPC to main process for OpenAI API');
                    const result = await ipcRenderer.invoke('call-openai-api', requestPayload);
                    
                    if (result && result.ok && result.data) {
                        console.log('✅ Main process OpenAI call succeeded');
                        // Create a mock response object that looks like a fetch response
                        response = {
                            ok: true,
                            status: result.status,
                            json: async () => result.data,
                            text: async () => JSON.stringify(result.data),
                            clone: function() { return this; },
                            headers: new Map()
                        };
                    } else {
                        console.error('❌ Main process OpenAI call failed:', result);
                        // Check if it's a limit exceeded error (429 with cost data)
                        if (result?.status === 429 && (result?.data?.costLimitDollars !== undefined || result?.data?.isBlocked !== undefined)) {
                            console.error('🚫 OpenAI blocked - limit exceeded');
                            this.showLimitExceededNotification();
                            throw new Error('LIMIT_EXCEEDED');
                        }
                        // Create error response
                        response = {
                            ok: false,
                            status: result?.status || 500,
                            text: async () => JSON.stringify(result?.data || { error: 'IPC call failed' }),
                            clone: function() { return this; },
                            headers: new Map()
                        };
                    }
                } catch (ipcError) {
                    if (ipcError.message === 'LIMIT_EXCEEDED') {
                        return "⚠️ Switched to Jarvis Low. Add credits for other models.";
                    }
                    console.error('❌ IPC OpenAI call failed, falling back to fetch:', ipcError);
                    // Fall through to fetch backup below
                    response = null;
                }
            }
            
            // Fallback to fetch if IPC didn't work
            if (!response) {
                if (this.apiProxyUrl && this.supabaseAnonKey) {
                    console.log('🔒 Using fetch to Supabase Edge Function proxy for OpenAI');
                    response = await fetch(this.apiProxyUrl, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${this.supabaseAnonKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            provider: 'openai',
                            endpoint: 'responses',
                            payload: requestPayload
                        })
                    });
                } else {
                    // Always use Edge Function - API keys stored in Supabase Secrets
                    if (!this.apiProxyUrl || !this.supabaseAnonKey) {
                        throw new Error('API keys must be stored in Supabase Edge Function Secrets.');
                    }
                    console.log('🔒 Using Supabase Edge Function for OpenAI API');
                    response = await fetch(this.apiProxyUrl, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${this.supabaseAnonKey}`,
                            'Content-Type': 'application/json',
                            'apikey': this.supabaseAnonKey
                        },
                        body: JSON.stringify({
                            provider: 'openai',
                            endpoint: 'responses',
                            payload: requestPayload
                        })
                    });
                }
            }
            
            if (!response.ok) {
                let errorText;
                try {
                    errorText = await response.text();
                    console.error('Raw error response:', errorText);
                    if (response.headers && response.headers.entries) {
                        console.error('Response headers:', Object.fromEntries(response.headers.entries()));
                    }
                    
                    let errorData;
                    try {
                        errorData = JSON.parse(errorText);
                    } catch (parseErr) {
                        // Not JSON, use raw text
                        errorData = { message: errorText, raw: errorText };
                    }
                    
                    console.error('OpenAI API Error:', {
                        status: response.status,
                        statusText: response.statusText,
                        error: errorData,
                        usingProxy: !!(this.apiProxyUrl && this.supabaseAnonKey),
                        proxyUrl: this.apiProxyUrl || 'none'
                    });
                    
                    // If 401 and using proxy, it's likely a Supabase Secrets issue
                    if (response.status === 401 && this.apiProxyUrl) {
                        const details = errorData.details || errorData.error?.message || errorData.message || errorText;
                        console.error(`❌ 401 ERROR: API keys may be missing or invalid in Supabase Secrets. Details: ${details}`);
                        throw new Error(`Unauthorized (401): API keys may be missing or invalid in Supabase Secrets. Details: ${details}`);
                    }
                    
                    // Check if it's a cost limit exceeded error (429)
                    if (response.status === 429 && (errorData.costLimitDollars || errorData.isBlocked !== undefined)) {
                        console.error('🚫 OpenAI blocked via proxy - limit exceeded');
                        this.showLimitExceededNotification();
                        return "⚠️ Switched to Jarvis Low. Add credits for other models.";
                    }
                    
                    // Check if it's a Supabase Edge Function error
                    if (errorData.error || errorData.details) {
                        const errorMsg = errorData.error?.message || errorData.details || errorData.message || JSON.stringify(errorData);
                        console.error(`❌ API ERROR ${response.status}:`, errorMsg);
                        throw new Error(`API error: ${response.status} - ${errorMsg}`);
                    }
                    const finalError = errorData.error?.message || errorData.message || errorText;
                    console.error(`❌ ERROR ${response.status}:`, finalError);
                    throw new Error(`API error: ${response.status} - ${finalError}`);
                } catch (parseError) {
                    console.error('OpenAI API Error (parse failed):', {
                        status: response.status,
                        statusText: response.statusText,
                        errorText: errorText || 'Unknown',
                        parseError: parseError.message
                    });
                    // If 401 and using proxy, suggest checking Supabase Secrets
                    if (response.status === 401 && this.apiProxyUrl) {
                        throw new Error(`Unauthorized (401): Check if API keys are set in Supabase Secrets. Raw error: ${errorText || 'No details'}`);
                    }
                    throw new Error(`API error: ${response.status} - ${response.statusText || errorText || 'Unknown error'}`);
                }
            }
            
            let data = await response.json();
            
            // Debug: Log full response structure to understand format
            console.log('API Response structure:', JSON.stringify(data, null, 2));
            
            // Check for tool calls in multiple possible locations
            const toolCalls = [];
            
            // Method 1: Check output array for function_call type
            if (data.output && Array.isArray(data.output)) {
                for (const item of data.output) {
                    // Check for function_call type - may have different statuses or no status
                    if (item.type === 'function_call' || item.function_call) {
                        console.log('Found function_call in output:', item);
                        
                        // Handle both direct function_call and nested
                        const funcCall = item.function_call || item;
                        const itemName = funcCall.name || item.name;
                        const itemArgs = funcCall.arguments || item.arguments;
                        
                        if (itemName) {
                            let parsedArgs = {};
                            try {
                                // Try to parse arguments - could be string or object
                                if (itemArgs) {
                                    if (typeof itemArgs === 'string') {
                                        parsedArgs = JSON.parse(itemArgs);
                                    } else if (typeof itemArgs === 'object') {
                                        parsedArgs = itemArgs;
                                    }
                                }
                            } catch (e) {
                                console.error('Error parsing tool arguments:', e, itemArgs);
                                parsedArgs = {};
                            }
                            
                            toolCalls.push({
                                name: itemName,
                                arguments: parsedArgs,
                                call_id: item.call_id || item.id
                            });
                        }
                    }
                }
            }
            
            // Method 2: Check for tool_calls array (standard format)
            if (data.tool_calls && Array.isArray(data.tool_calls)) {
                console.log('Found tool_calls array:', data.tool_calls);
                for (const toolCall of data.tool_calls) {
                    let parsedArgs = {};
                    try {
                        if (toolCall.function?.arguments) {
                            if (typeof toolCall.function.arguments === 'string') {
                                parsedArgs = JSON.parse(toolCall.function.arguments);
                            } else {
                                parsedArgs = toolCall.function.arguments;
                            }
                        }
                    } catch (e) {
                        console.error('Error parsing tool_calls arguments:', e);
                    }
                    
                    toolCalls.push({
                        name: toolCall.function?.name || toolCall.name,
                        arguments: parsedArgs,
                        call_id: toolCall.id || toolCall.call_id
                    });
                }
            }
            
            // Method 3: Check choices[0].message.tool_calls (chat completions format)
            if (data.choices && Array.isArray(data.choices) && data.choices[0]?.message?.tool_calls) {
                console.log('Found tool_calls in choices:', data.choices[0].message.tool_calls);
                for (const toolCall of data.choices[0].message.tool_calls) {
                    let parsedArgs = {};
                    try {
                        if (toolCall.function?.arguments) {
                            if (typeof toolCall.function.arguments === 'string') {
                                parsedArgs = JSON.parse(toolCall.function.arguments);
                            } else {
                                parsedArgs = toolCall.function.arguments;
                            }
                        }
                    } catch (e) {
                        console.error('Error parsing choices tool_calls arguments:', e);
                    }
                    
                    toolCalls.push({
                        name: toolCall.function?.name,
                        arguments: parsedArgs,
                        call_id: toolCall.id
                    });
                }
            }
            
            // Debug: Log tool calls found
            if (toolCalls.length > 0) {
                console.log('✅ Tool calls detected:', toolCalls);
                console.log('Tool call names:', toolCalls.map(tc => tc.name));
                console.log('Is create_quiz in detected tools?', toolCalls.some(tc => tc.name === 'create_quiz'));
                console.log('Is askclaude in detected tools?', toolCalls.some(tc => tc.name === 'askclaude'));
            } else {
                console.log('❌ No tool calls detected in response');
                console.log('Full API response:', JSON.stringify(data, null, 2));
                console.log('Response keys:', Object.keys(data));
                if (data.output) {
                    console.log('Output array items:', data.output.map(item => ({ type: item.type, name: item.name })));
                }
            }
            
            if (toolCalls.length > 0) {
                const toolNames = toolCalls.map(tc => tc.name).join(', ');
                
                for (let i = 0; i < toolCalls.length; i++) {
                    const toolCall = toolCalls[i];
                    try {
                        if (toolCall.name === 'getscreenshot') {
                            const result = await this.executeGetScreenshot();
                            if (result && typeof result === 'object' && result.type === 'screenshot') {
                                inputContent.push({ type: 'input_image', image_url: result.image_url });
                                this.showNotification('📸 Screenshot captured, analyzing...');
                            } else if (typeof result === 'string') {
                                inputContent.push({ type: 'input_text', text: `Screenshot: ${result}` });
                                this.showNotification('📸 Screenshot captured, analyzing...');
                            }
                        } else if (toolCall.name === 'web_search' || toolCall.name === 'search') {
                            // Support both "web_search" and "search" (backend may use either)
                            console.log('🔍 Search tool called!', {
                                name: toolCall.name,
                                arguments: toolCall.arguments,
                                hasProxy: !!(this.apiProxyUrl && this.supabaseAnonKey),
                                hasDirectKey: !!(this.perplexityApiKey && this.perplexityApiKey.trim() !== '')
                            });
                            const query = toolCall.arguments?.query || toolCall.arguments?.query_string || toolCall.arguments?.search_query || '';
                            if (!query) {
                                console.error('❌ Search tool called without query:', toolCall.arguments);
                                inputContent.push({ type: 'input_text', text: 'Web search: No query provided' });
                                this.showNotification('⚠️ No search query provided');
                            } else {
                                console.log('🔍 Executing web search via Perplexity with query:', query);
                                const result = await this.executeSearchWeb(query);
                                console.log('✅ Web search completed, result length:', result?.length || 0);
                                inputContent.push({ type: 'input_text', text: `Web search: ${result}` });
                            }
                        } else if (toolCall.name === 'askclaude') {
                            const question = toolCall.arguments?.question || toolCall.arguments?.query || '';
                            if (!question) {
                                console.error('AskClaude tool called without question:', toolCall.arguments);
                                inputContent.push({ type: 'input_text', text: 'Claude analysis: No question provided' });
                                this.showNotification('⚠️ Step 7c: No question provided for Claude');
                            } else {
                                console.log('Calling Claude with question:', question);
                                const result = await this.executeAskClaude(question);
                                console.log('Claude response received, length:', result?.length || 0);
                                // Pass Claude's full response - don't truncate it
                                inputContent.push({ type: 'input_text', text: `Claude's detailed analysis:\n\n${result}` });
                            }
                        } else if (toolCall.name === 'create_quiz') {
                            console.log('📝 QUIZ TOOL CALLED! Full toolCall:', JSON.stringify(toolCall, null, 2));
                            console.log('📝 toolCall.arguments:', toolCall.arguments);
                            console.log('📝 toolCall.arguments type:', typeof toolCall.arguments);
                            
                            try {
                                const topic = toolCall.arguments?.topic || 'General Knowledge';
                                const questions = toolCall.arguments?.questions || [];
                                
                                console.log('📝 Parsed topic:', topic);
                                console.log('📝 Parsed questions:', questions);
                                console.log('📝 Questions length:', questions.length);
                                
                                if (questions.length === 0) {
                                    console.error('📝 Quiz tool called without questions:', toolCall.arguments);
                                    inputContent.push({ type: 'input_text', text: 'Quiz: No questions provided by AI' });
                                    this.showNotification('⚠️ Quiz creation failed: No questions generated');
                                } else {
                                    console.log('📝 Creating quiz on topic:', topic, 'with', questions.length, 'questions');
                                    console.log('📝 First question:', JSON.stringify(questions[0], null, 2));
                                    // Stop loading and show quiz
                                    this.stopLoadingAnimation();
                                    if (this.dragOutput) {
                                        this.dragOutput.classList.remove('loading-notification');
                                    }
                                    this.showQuiz(topic, questions);
                                    // Return special marker to prevent showNotification from overwriting quiz
                                    return '__QUIZ_DISPLAYED__';
                                }
                            } catch (quizError) {
                                console.error('📝 ERROR creating quiz:', quizError);
                                inputContent.push({ type: 'input_text', text: `Quiz error: ${quizError.message}` });
                                this.showNotification(`❌ Quiz error: ${quizError.message}`);
                            }
                        } else {
                            console.warn('Unknown tool call:', toolCall.name);
                            this.showNotification(`⚠️ Unknown tool: ${toolCall.name}`);
                        }
                    } catch (error) {
                        console.error(`Error executing tool ${toolCall.name}:`, error);
                        inputContent.push({ type: 'input_text', text: `Error executing ${toolCall.name}: ${error.message}` });
                        this.showNotification(`❌ Error executing ${toolCall.name}: ${error.message}`);
                    }
                }
                
                // Second call with tool results
                // If Claude was called, preserve its full response
                const hasClaudeResponse = toolCalls.some(tc => tc.name === 'askclaude');
                const finalInstructions = hasClaudeResponse 
                    ? `You are Jarvis. Claude has provided a detailed analysis. Present Claude's analysis clearly and comprehensively. Answer directly without any preface, introduction, or phrases like "here's the answer" or "the answer is". Just provide the answer immediately. Don't summarize or shorten it unless the user asks.${conversationContext}`
                    : `You are Jarvis. Answer directly without any preface, introduction, or phrases like "here's the answer" or "the answer is". Just provide the answer immediately. Respond concisely.${conversationContext}`;
                
                console.log('🔄 Making second API call with tool results. Has Claude response:', hasClaudeResponse);
                console.log('🔄 isElectron:', this.isElectron, 'hasRequire:', !!window.require);
                
                const secondCallPayload = {
                    model: this.currentModel,
                    instructions: finalInstructions,
                    input: [{ role: 'user', content: inputContent }]
                };
                
                // Use IPC for second call too
                if (this.isElectron && window.require) {
                    try {
                        const { ipcRenderer } = window.require('electron');
                        console.log('🔒 SECOND CALL: Using IPC for second OpenAI call (with tool results)');
                        console.log('📤 SECOND CALL: Invoking call-openai-api via IPC...');
                        const result = await ipcRenderer.invoke('call-openai-api', secondCallPayload);
                        console.log('📥 SECOND CALL: IPC result:', { ok: result?.ok, status: result?.status });
                        
                        if (result && result.ok && result.data) {
                            console.log('✅ Second OpenAI call via IPC succeeded');
                            data = result.data;
                        } else {
                            console.error('❌ Second OpenAI call via IPC failed:', result);
                            // Check if it's a limit exceeded error
                            if (result?.status === 429 && result?.data?.costLimitDollars !== undefined) {
                                console.error('🚫 OpenAI (second call) blocked - limit exceeded');
                                this.showLimitExceededNotification();
                                throw new Error('LIMIT_EXCEEDED');
                            }
                            throw new Error(`API error: ${result?.status || 500} - ${result?.data?.error || 'IPC call failed'}`);
                        }
                    } catch (ipcError) {
                        if (ipcError.message === 'LIMIT_EXCEEDED') {
                            return "⚠️ Switched to Jarvis Low. Add credits for other models.";
                        }
                        console.error('❌ IPC second call failed, falling back to Edge Function:', ipcError);
                        // Fall through to Edge Function fetch below
                        if (!this.apiProxyUrl || !this.supabaseAnonKey) {
                            throw new Error('API keys must be stored in Supabase Edge Function Secrets.');
                        }
                        response = await fetch(this.apiProxyUrl, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${this.supabaseAnonKey}`,
                                'Content-Type': 'application/json',
                                'apikey': this.supabaseAnonKey
                            },
                            body: JSON.stringify({
                                provider: 'openai',
                                endpoint: 'responses',
                                payload: secondCallPayload
                            })
                        });
                        
                        if (!response.ok) {
                            throw new Error(`API error: ${response.status}`);
                        }
                        
                        data = await response.json();
                    }
                } else {
                    // Not in Electron, use Edge Function
                    if (!this.apiProxyUrl || !this.supabaseAnonKey) {
                        throw new Error('API keys must be stored in Supabase Edge Function Secrets.');
                    }
                    response = await fetch(this.apiProxyUrl, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${this.supabaseAnonKey}`,
                            'Content-Type': 'application/json',
                            'apikey': this.supabaseAnonKey
                        },
                        body: JSON.stringify({
                            provider: 'openai',
                            endpoint: 'responses',
                            payload: secondCallPayload
                        })
                    });
                    
                    if (!response.ok) {
                        throw new Error(`API error: ${response.status}`);
                    }
                    
                    data = await response.json();
                }
            }
            
            const finalResponse = this.extractText(data);
            // Stop loading animation before showing final response
            this.stopLoadingAnimation();
            const safeResponse = typeof finalResponse === 'string' ? finalResponse : String(finalResponse || 'No response');
            
            this.conversationHistory.push({ role: 'user', content: message });
            this.conversationHistory.push({ 
                role: 'assistant', 
                content: safeResponse,
                model: this.selectedModelName || 'Jarvis'
            });
            
            if (this.conversationHistory.length > 30) {
                this.conversationHistory = this.conversationHistory.slice(-30);
            }
            
            this.saveConversationHistory();
            
            return safeResponse;
        } catch (error) {
            console.error('API error:', error);
            throw error;
        }
    }
    
    async executeGetScreenshot() {
        try {
            this.showNotification('Taking screenshot...');
            await this.captureScreen();
            
            if (!this.currentScreenCapture) {
                return "Failed to capture screenshot";
            }
            
            // Return special marker that indicates this is a screenshot
            // The sendMessage function will handle adding the image to messages
            return { type: 'screenshot', image_url: this.currentScreenCapture };
        } catch (error) {
            console.error('Screenshot tool error:', error);
            return `Screenshot capture error: ${error.message}`;
        }
    }
    
    async executeSearchWeb(query) {
        // Check if Perplexity API is available (either direct key or proxy)
        const hasPerplexityAccess = (this.perplexityApiKey && this.perplexityApiKey.trim() !== '') || 
                                     (this.apiProxyUrl && this.supabaseAnonKey);
        
        if (!hasPerplexityAccess) {
            console.warn('⚠️ Perplexity API not available for web search', {
                hasDirectKey: !!(this.perplexityApiKey),
                hasProxy: !!(this.apiProxyUrl && this.supabaseAnonKey)
            });
            return `Web search is not available. To enable web search, configure the Perplexity API key (either via PPLX_API_KEY environment variable or Supabase Secrets).`;
        }

        try {
            // Start loading notification with search context (don't stop it here - let it continue until final answer)
            this.showLoadingNotification(null, 'search');
            
            // Use Edge Function proxy if available, otherwise direct API call
            let perplexityResponse;
            const requestPayload = {
                model: 'sonar-pro',
                messages: [
                    {
                        role: 'system',
                        content: 'Be precise and concise. Provide the most relevant and up-to-date information.'
                    },
                    {
                        role: 'user',
                        content: query
                    }
                ]
            };
            
            // ALWAYS use hardcoded values - exact same as test script that works
            const SUPABASE_URL = 'https://nbmnbgouiammxpkbyaxj.supabase.co';
            const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibW5iZ291aWFtbXhwa2J5YXhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI1MjEwODcsImV4cCI6MjA3ODA5NzA4N30.ppFaxEFUyBWjwkgdszbvP2HUdXXKjC0Bu-afCQr0YxE';
            const PROXY_URL = `${SUPABASE_URL}/functions/v1/jarvis-api-proxy`;
            
            // Force use of hardcoded values (ignore loaded values since test script works)
            console.log('🔒 Using Supabase Edge Function proxy for Perplexity (hardcoded values from test script)');
            console.log('📤 Request details:', {
                url: PROXY_URL,
                anonKeyPrefix: SUPABASE_ANON_KEY.substring(0, 30) + '...',
                isElectron: this.isElectron
            });
            
            // Try using main process IPC first (more reliable in Electron)
            if (this.isElectron && window.require) {
                try {
                    const { ipcRenderer } = window.require('electron');
                    console.log('📤 Making Perplexity API call via main process IPC');
                    console.log('📤 Request payload:', JSON.stringify(requestPayload, null, 2));
                    
                    const result = await ipcRenderer.invoke('call-perplexity-api', requestPayload);
                    console.log('📥 IPC result received (FULL):', JSON.stringify(result, null, 2));
                    console.log('📥 IPC result received (summary):', {
                        ok: result.ok,
                        status: result.status,
                        hasData: !!result.data,
                        resultType: typeof result,
                        hasChoices: result.data?.choices ? 'YES' : 'NO'
                    });
                    
                    if (result && result.ok && result.data) {
                        console.log('✅ Main process API call succeeded');
                        // Handle success - extract content directly
                        const perplexityData = result.data;
                        
                        // Check if response has the expected structure
                        if (perplexityData.choices && perplexityData.choices[0] && perplexityData.choices[0].message) {
                            const content = perplexityData.choices[0].message.content;
                            if (content) {
                                this.showLoadingNotification(null, 'default');
                                return content;
                            }
                        }
                        
                        // If structure is wrong, treat as error
                        const errorMsg = `Web search failed: Invalid response structure from Perplexity API.`;
                        this.stopLoadingAnimation();
                        this.showNotification(`❌ ${errorMsg}`, false);
                        return errorMsg;
                    } else if (result) {
                        console.error('❌ Main process API call failed:', result);
                        this.stopLoadingAnimation();
                        // Check if it's a limit exceeded error
                        if (result?.status === 429 && result?.data?.costLimitDollars !== undefined) {
                            console.error('🚫 Perplexity blocked - limit exceeded');
                            this.showLimitExceededNotification();
                            return "⚠️ Switched to Jarvis Low. Add credits for other models.";
                        }
                        const errorData = result.data || {};
                        const errorMsg = errorData.error?.message || errorData.details || errorData.error || `HTTP ${result.status}: ${result.statusText}`;
                        const fullError = `Web search failed: ${errorMsg}`;
                        this.showNotification(`❌ ${fullError}`, false);
                        return fullError;
                    } else {
                        throw new Error('IPC returned null/undefined');
                    }
                } catch (ipcError) {
                    if (ipcError.message === 'LIMIT_EXCEEDED') {
                        return "⚠️ Switched to Jarvis Low. Add credits for other models.";
                    }
                    console.error('❌ IPC call failed:', ipcError);
                    this.showNotification(`❌ IPC call failed: ${ipcError.message}. Trying direct fetch...`, false);
                    // Fall through to direct fetch
                }
            }
            
            // Fallback to direct fetch if IPC didn't work or not in Electron
            if (!perplexityResponse) {
                try {
                    console.log('📤 Making fetch request to:', PROXY_URL);
                    perplexityResponse = await fetch(PROXY_URL, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                            'Content-Type': 'application/json',
                            'apikey': SUPABASE_ANON_KEY
                        },
                        body: JSON.stringify({
                            provider: 'perplexity',
                            endpoint: 'chat/completions',
                            payload: requestPayload
                        })
                    });
                    console.log('✅ Fetch request completed, status:', perplexityResponse.status);
                } catch (fetchError) {
                    console.error('❌ Fetch request failed:', fetchError);
                    this.stopLoadingAnimation();
                    const errorMsg = `Web search failed: Network error - ${fetchError.message}. This might be a CORS issue or the Edge Function is not accessible.`;
                    this.showNotification(`❌ ${errorMsg}`, false);
                    return errorMsg;
                }
            }
            
            // If we got a successful response from IPC, we already returned above
            // Only continue here if we're using direct fetch
            if (!perplexityResponse) {
                const errorMsg = 'Web search failed: No response received.';
                this.stopLoadingAnimation();
                this.showNotification(`❌ ${errorMsg}`, false);
                return errorMsg;
            }
            
            console.log('📥 Perplexity response status:', perplexityResponse.status, perplexityResponse.statusText);
            
            if (!perplexityResponse.ok) {
                const errorText = await perplexityResponse.text().catch(() => 'Unknown error');
                console.error('❌ Raw Perplexity error response:', errorText);
                let errorData;
                try {
                    errorData = JSON.parse(errorText);
                } catch {
                    errorData = { error: { message: errorText } };
                }
                
                // Show FULL error details in notification so user can see it
                const fullErrorDetails = JSON.stringify({
                    status: perplexityResponse.status,
                    statusText: perplexityResponse.statusText,
                    error: errorData,
                    errorText: errorText.substring(0, 500)
                }, null, 2);
                
                console.error('❌ Perplexity API Error Details:', fullErrorDetails);
                
                // Show detailed error in notification
                const errorSummary = `Status: ${perplexityResponse.status}\nError: ${errorData.error?.message || errorData.details || errorText.substring(0, 200)}`;
                this.showNotification(`❌ Web search failed!\n\n${errorSummary}`, false);
                this.stopLoadingAnimation();
                
                // Provide helpful error messages based on status code
                let errorMessage;
                if (perplexityResponse.status === 401) {
                    if (this.apiProxyUrl) {
                        // Check if it's a Supabase auth error or Perplexity API error
                        const isSupabaseError = errorText.includes('Missing Authorization') || 
                                               errorText.includes('Unauthorized') ||
                                               errorData.error?.message?.includes('Missing Authorization');
                        
                        // Check if anon key is missing
                        const anonKeyMissing = !this.supabaseAnonKey || this.supabaseAnonKey.trim() === '';
                        
                        // Parse error to determine the source
                        const errorDetails = errorData.error?.message || errorData.details || errorText || '';
                        const isMissingAuth = errorDetails.includes('Missing Authorization') || errorDetails.includes('Unauthorized');
                        const isPerplexityError = errorDetails.includes('Perplexity') || errorDetails.includes('PPLX');
                        
                        if (anonKeyMissing) {
                            errorMessage = `❌ Web search failed (401): Supabase anon key is missing! Please restart the app.`;
                        } else if (isMissingAuth && !isPerplexityError) {
                            errorMessage = `❌ Web search failed (401): Edge Function authentication failed. The function may need to be made public in Supabase Dashboard.`;
                        } else if (isPerplexityError || errorDetails.includes('not configured')) {
                            errorMessage = `❌ Web search failed (401): Perplexity API key missing in Supabase Secrets. Go to Dashboard → Settings → Edge Functions → Secrets and verify PPLX_API_KEY is set.`;
                        } else {
                            errorMessage = `❌ Web search failed (401): Authentication error. Error: ${errorDetails.substring(0, 100)}`;
                        }
                    } else {
                        errorMessage = `❌ Web search failed (401): Perplexity API key invalid. Error: ${errorText.substring(0, 150)}`;
                    }
                } else if (perplexityResponse.status === 400) {
                    const errorMsg = errorData.error?.message || errorData.details || errorData.message || 'Bad request';
                    errorMessage = `Web search failed: Invalid request (400). ${errorMsg}`;
                } else if (perplexityResponse.status === 429) {
                    errorMessage = `Web search failed: Rate limit exceeded (429). Please try again later.`;
                } else if (perplexityResponse.status === 500) {
                    errorMessage = `Web search failed: Server error (500). The Perplexity API may be experiencing issues. Error: ${errorText.substring(0, 200)}`;
                } else {
                    errorMessage = errorData.error?.message || errorData.details || errorData.message || `HTTP ${perplexityResponse.status}: ${perplexityResponse.statusText}`;
                    errorMessage = `Web search failed: ${errorMessage}`;
                }
                
                // Show error notification
                this.showNotification(`❌ ${errorMessage}`, false);
                return errorMessage;
            }
            
            let perplexityData;
            try {
                perplexityData = await perplexityResponse.json();
            } catch (jsonError) {
                const textResponse = await perplexityResponse.text().catch(() => 'Unable to read response');
                this.stopLoadingAnimation();
                const errorMsg = `Web search failed: Invalid JSON response from Perplexity API. Status: ${perplexityResponse.status}. Response: ${textResponse.substring(0, 300)}`;
                this.showNotification(`❌ ${errorMsg}`, false);
                return errorMsg;
            }
            
            // Check if response has an error field (proxy might return errors in different format)
            if (perplexityData.error) {
                this.stopLoadingAnimation();
                const errorMsg = perplexityData.error.message || perplexityData.error.details || JSON.stringify(perplexityData.error);
                const fullError = `Web search failed: ${errorMsg}`;
                this.showNotification(`❌ ${fullError}`, false);
                return fullError;
            }
            
            // Check if response has the expected structure
            if (!perplexityData.choices || !Array.isArray(perplexityData.choices) || perplexityData.choices.length === 0) {
                this.stopLoadingAnimation();
                const errorMsg = `Web search failed: Invalid response structure from Perplexity API (no choices array). Response keys: ${Object.keys(perplexityData).join(', ')}`;
                this.showNotification(`❌ ${errorMsg}`, false);
                return errorMsg;
            }
            
            if (!perplexityData.choices[0] || !perplexityData.choices[0].message) {
                this.stopLoadingAnimation();
                const errorMsg = `Web search failed: Invalid response structure from Perplexity API (no message). Response: ${JSON.stringify(perplexityData).substring(0, 200)}`;
                this.showNotification(`❌ ${errorMsg}`, false);
                return errorMsg;
            }
            
            const content = perplexityData.choices[0].message.content;
            if (!content || content.trim() === '') {
                this.stopLoadingAnimation();
                const errorMsg = `Web search failed: No content returned from Perplexity API. Full response: ${JSON.stringify(perplexityData).substring(0, 300)}`;
                this.showNotification(`❌ ${errorMsg}`, false);
                return errorMsg;
            }
            
            // Don't stop loading here - it will continue through the synthesis phase
            // Switch to default loading context for the synthesis phase
            this.showLoadingNotification(null, 'default');
            return content;
        } catch (error) {
            this.stopLoadingAnimation();
            const errorMsg = `Web search error: ${error.message}`;
            this.showNotification(`❌ ${errorMsg}`, false);
            return errorMsg;
        }
    }

    // Jarvis Low model - uses OpenAI API with gpt-4o-mini (no cost tracking)
    async callLowModel(message) {
        try {
            // Build conversation context
            let conversationContext = '';
            if (this.conversationHistory.length > 0) {
                conversationContext = '\n\nPREVIOUS CONVERSATION:\n' + 
                    this.conversationHistory.slice(-6).map((msg, idx) => 
                        `${idx + 1}. ${msg.role === 'user' ? 'User' : 'Jarvis'}: ${msg.content.substring(0, 200)}`
                    ).join('\n');
            }

            // Add document context if available
            let documentContext = '';
            if (this.currentDocument) {
                documentContext = `\n\nDOCUMENT CONTEXT:\nTitle: ${this.currentDocument.title}\nContent: ${this.currentDocument.content.substring(0, 1500)}...`;
            }

            const instructions = `You are Jarvis Low, a fast and efficient AI assistant. Answer directly without any preface. Be concise but helpful.${conversationContext}${documentContext}`;

            // Add user message to conversation history
            this.conversationHistory.push({
                role: 'user',
                content: message,
                model: 'Jarvis Low'
            });

            this.showLoadingNotification();

            // Build request for OpenAI Responses API
            const requestPayload = {
                model: this.lowModelId, // gpt-4o-mini
                instructions: instructions,
                input: [{ role: 'user', content: [{ type: 'input_text', text: message }] }]
            };

            let response;
            
            // Use IPC to call OpenAI through main process (skips cost tracking for low model)
            if (this.isElectron && window.require) {
                try {
                    const { ipcRenderer } = window.require('electron');
                    console.log('🔒 Calling OpenAI (Low Model) via main process IPC');
                    const result = await ipcRenderer.invoke('call-openai-api', requestPayload, true); // true = isLowModel
                    
                    if (result && result.ok && result.data) {
                        console.log('✅ Low model call succeeded');
                        const content = this.extractText(result.data) || 'No response generated';
                        
                        // Add to conversation history
                        this.conversationHistory.push({
                            role: 'assistant',
                            content: content,
                            model: 'Jarvis Low'
                        });
                        
                        this.showLoadingNotification(null, 'default');
                        return content;
                    } else {
                        console.error('❌ Low model call failed:', result);
                        throw new Error(`API error: ${result?.status || 500} - ${result?.data?.error || 'Unknown error'}`);
                    }
                } catch (ipcError) {
                    console.error('❌ IPC low model call failed:', ipcError);
                    throw ipcError;
                }
            }

            // Fallback to direct API call if IPC not available
            if (this.apiProxyUrl && this.supabaseAnonKey) {
                response = await fetch(this.apiProxyUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.supabaseAnonKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        provider: 'openai',
                        endpoint: 'responses',
                        payload: requestPayload
                    })
                });
            } else {
                // Must use Edge Function - no direct API keys allowed
                throw new Error('No API access available. API keys must be stored in Supabase Edge Function Secrets.');
            }

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            const content = this.extractText(data) || 'No response generated';

            // Add to conversation history
            this.conversationHistory.push({
                role: 'assistant',
                content: content,
                model: 'Jarvis Low'
            });

            this.showLoadingNotification(null, 'default');
            return content;
        } catch (error) {
            this.stopLoadingAnimation();
            console.error('Low model error:', error);
            return `Error: ${error.message}`;
        }
    }

    async callOpenRouter(message, model) {
        try {
            // Check if this is a Claude model - route to Claude API directly
            if (model.startsWith('anthropic/claude-')) {
                console.log(`🤖 Detected Claude model: ${model}, routing to Claude API`);
                return await this.callClaudeDirect(message, model);
            }

            // Build conversation context
            let conversationContext = '';
            if (this.conversationHistory.length > 0) {
                conversationContext = '\n\nPREVIOUS CONVERSATION (remember this context):\n' + 
                    this.conversationHistory.slice(-10).map((msg, idx) => 
                        `${idx + 1}. ${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content.substring(0, 300)}`
                    ).join('\n');
            }

            // Add document context if available
            let documentContext = '';
            if (this.currentDocument) {
                documentContext = `\n\nCURRENT DOCUMENT CONTEXT:
Title: ${this.currentDocument.title}
URL: ${this.currentDocument.url}
Content: ${this.currentDocument.content.substring(0, 2000)}...`;
            }

            // Special instructions for Grok voice mode - brief conversational responses
            let voiceInstructions = '';
            if (model === 'x-ai/grok-4.1-fast' && this.grokVoiceMode) {
                voiceInstructions = '\n\nIMPORTANT: Keep your response very brief and conversational, like someone talking casually. Use 1-3 short sentences max. No bullet points, no formatting, no long explanations. Just quick, punchy responses like a friend would say.';
            }

            const instructions = `You are Jarvis, an AI assistant. Answer directly without any preface, introduction, or phrases like "here's the answer" or "the answer is". Just provide the answer immediately. Respond concisely.${conversationContext}${documentContext}${voiceInstructions}`;

            console.log(`🤖 Calling OpenRouter with model: ${model}`);
            
            // Build message content - include screenshot if available
            let userContent;
            if (this.currentScreenCapture) {
                userContent = [
                    { type: 'text', text: message },
                    { type: 'image_url', image_url: { url: this.currentScreenCapture } }
                ];
                console.log('📸 Including screenshot in OpenRouter request');
                // Clear screenshot after using it
                this.currentScreenCapture = null;
            } else {
                userContent = message;
            }
            
            // Use IPC to call OpenRouter through main process (for token tracking and limit enforcement)
            if (this.isElectron && window.require) {
                const { ipcRenderer } = window.require('electron');
                
                const requestPayload = {
                    model: model,
                    messages: [
                        { role: 'system', content: instructions },
                        { role: 'user', content: userContent }
                    ]
                };
                
                console.log('🔒 Calling OpenRouter via main process IPC');
                const result = await ipcRenderer.invoke('call-openrouter-api', requestPayload, false); // false = not low model (low model uses OpenAI API)
                
                if (!result.ok) {
                    // Check if it's a limit exceeded error
                    if (result.status === 429 && result.data?.isBlocked !== undefined) {
                        const errorMsg = result.data.error || 'Usage limit exceeded';
                        console.error('🚫 OpenRouter blocked:', errorMsg);
                        // Show notification with button to add credits
                        this.showLimitExceededNotification();
                        return `⚠️ Switched to Jarvis Low. Add credits for other models.`;
                    }
                    throw new Error(`OpenRouter API error: ${result.status} - ${result.data?.error || result.statusText}`);
                }
                
                const data = result.data;
                
                if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                    throw new Error('Invalid response structure from OpenRouter');
                }

                const content = data.choices[0].message.content;
                
                // Update conversation history
                this.conversationHistory.push({ role: 'user', content: message });
                this.conversationHistory.push({ 
                    role: 'assistant', 
                    content: content,
                    model: this.selectedModelName || 'Jarvis'
                });
                
                if (this.conversationHistory.length > 30) {
                    this.conversationHistory = this.conversationHistory.slice(-30);
                }
                
                this.saveConversationHistory();
                
                // Speak the response if Grok voice mode is enabled
                if (model === 'x-ai/grok-4.1-fast' && this.grokVoiceMode && content) {
                    this.speakWithElevenLabs(content);
                }
                
                return content;
            } else {
                // Fallback to direct fetch if not in Electron (shouldn't happen in normal use)
                console.warn('⚠️ Not in Electron environment, using direct fetch (no token tracking)');
                
                // Always use Edge Function - no direct API keys allowed
                if (!this.apiProxyUrl || !this.supabaseAnonKey) {
                    console.warn('⚠️ Supabase Edge Function not available');
                    return `OpenRouter is not available. API keys must be stored in Supabase Edge Function Secrets.`;
                }
                
                const response = await fetch(this.apiProxyUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.supabaseAnonKey}`,
                        'Content-Type': 'application/json',
                        'apikey': this.supabaseAnonKey
                    },
                    body: JSON.stringify({
                        provider: 'openrouter',
                        endpoint: 'chat/completions',
                        payload: {
                            model: model,
                            messages: [
                                { role: 'system', content: instructions },
                                { role: 'user', content: userContent }
                            ]
                        }
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    console.error('OpenRouter API error:', errorText);
                    throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
                }

                const data = await response.json();
                
                if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                    throw new Error('Invalid response structure from OpenRouter');
                }

                const content = data.choices[0].message.content;
                
                // Update conversation history
                this.conversationHistory.push({ role: 'user', content: message });
                this.conversationHistory.push({ 
                    role: 'assistant', 
                    content: content,
                    model: this.selectedModelName || 'Jarvis'
                });
                
                if (this.conversationHistory.length > 30) {
                    this.conversationHistory = this.conversationHistory.slice(-30);
                }
                
                this.saveConversationHistory();
                
                // Speak the response if Grok voice mode is enabled
                if (model === 'x-ai/grok-4.1-fast' && this.grokVoiceMode && content) {
                    this.speakWithElevenLabs(content);
                }
                
                return content;
            }
        } catch (error) {
            console.error('OpenRouter API error:', error);
            throw error;
        }
    }

    async callClaudeDirect(message, openRouterModel) {
        // Map OpenRouter model names to Claude API model names
        const modelMap = {
            'anthropic/claude-sonnet-4.5': 'claude-sonnet-4-5-20250929',
            'anthropic/claude-opus-4.5': 'claude-3-opus-20240229' // Opus 4.5 maps to Opus 3
        };
        
        let claudeModel = modelMap[openRouterModel] || 'claude-sonnet-4-5-20250929';
        
        try {
            // Build conversation context
            let conversationContext = '';
            if (this.conversationHistory.length > 0) {
                conversationContext = '\n\nPREVIOUS CONVERSATION (remember this context):\n' + 
                    this.conversationHistory.slice(-10).map((msg, idx) => 
                        `${idx + 1}. ${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content.substring(0, 300)}`
                    ).join('\n');
            }

            // Add document context if available
            let documentContext = '';
            if (this.currentDocument) {
                documentContext = `\n\nCURRENT DOCUMENT CONTEXT:
Title: ${this.currentDocument.title}
URL: ${this.currentDocument.url}
Content: ${this.currentDocument.content.substring(0, 2000)}...`;
            }

            const systemMessage = `You are Jarvis, an AI assistant. Answer directly without any preface, introduction, or phrases like "here's the answer" or "the answer is". Just provide the answer immediately. Respond concisely.${conversationContext}${documentContext}`;

            // Build messages array (Claude API uses top-level system param, not system role in messages)
            const messages = [];
            
            // Add current message
            if (this.currentScreenCapture) {
                // Extract base64 data from data URL
                const base64Data = this.currentScreenCapture.includes(',') 
                    ? this.currentScreenCapture.split(',')[1] 
                    : this.currentScreenCapture.replace('data:image/png;base64,', '');
                
                messages.push({
                    role: 'user',
                    content: [
                        { type: 'text', text: message },
                        { 
                            type: 'image', 
                            source: { 
                                type: 'base64', 
                                media_type: 'image/png', 
                                data: base64Data 
                            } 
                        }
                    ]
                });
                this.currentScreenCapture = null;
            } else {
                messages.push({
                    role: 'user',
                    content: message
                });
            }

            const requestBody = {
                model: claudeModel,
                max_tokens: 4096,
                system: systemMessage,  // Claude API uses top-level system parameter
                messages: messages
            };

            console.log(`🤖 Calling Claude API with model: ${claudeModel}`);
            
            // Use IPC to call Claude through main process (for token tracking and limit enforcement)
            if (this.isElectron && window.require) {
                const { ipcRenderer } = window.require('electron');
                
                console.log('🔒 Calling Claude via main process IPC');
                const result = await ipcRenderer.invoke('call-claude-api', requestBody);
                
                if (!result.ok) {
                    // Check if it's a limit exceeded error
                    if (result.status === 429 && result.data?.isBlocked !== undefined) {
                        const errorMsg = result.data.error || 'Usage limit exceeded';
                        console.error('🚫 Claude blocked:', errorMsg);
                        // Show notification with button to add credits
                        if (result.data.costLimitDollars) {
                            this.showLimitExceededNotification();
                        }
                        return `⚠️ Switched to Jarvis Low. Add credits for other models.`;
                    }
                    throw new Error(`Claude API error: ${result.status} - ${result.data?.error || result.statusText}`);
                }
                
                const data = result.data;
                
                if (!data.content || !Array.isArray(data.content) || data.content.length === 0) {
                    throw new Error('Invalid response structure from Claude API');
                }

                const content = data.content[0].text;
                
                // Update conversation history
                this.conversationHistory.push({ role: 'user', content: message });
                this.conversationHistory.push({ 
                    role: 'assistant', 
                    content: content,
                    model: this.selectedModelName || 'Claude'
                });
                
                if (this.conversationHistory.length > 30) {
                    this.conversationHistory = this.conversationHistory.slice(-30);
                }
                
                this.saveConversationHistory();
                
                return content;
            } else {
                // Fallback to direct fetch if not in Electron (shouldn't happen in normal use)
                console.warn('⚠️ Not in Electron environment, using direct fetch (no token tracking)');
                
                const hasProxy = this.apiProxyUrl && this.supabaseAnonKey;
                
                if (!hasProxy) {
                    return `Claude is not available. API keys must be stored in Supabase Edge Function Secrets.`;
                }
                
                // Always use Edge Function - no direct API keys allowed
                const claudeResponse = await fetch(this.apiProxyUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.supabaseAnonKey}`,
                        'Content-Type': 'application/json',
                        'apikey': this.supabaseAnonKey
                    },
                    body: JSON.stringify({
                        provider: 'claude',
                        endpoint: 'messages',
                        payload: requestBody
                    })
                });

                if (!claudeResponse.ok) {
                    const errorText = await claudeResponse.text();
                    throw new Error(`Claude API error: ${claudeResponse.status} - ${errorText}`);
                }

                const data = await claudeResponse.json();
                
                if (!data.content || !Array.isArray(data.content) || data.content.length === 0) {
                    throw new Error('Invalid response structure from Claude API');
                }

                const content = data.content[0].text;
                
                // Update conversation history
                this.conversationHistory.push({ role: 'user', content: message });
                this.conversationHistory.push({ 
                    role: 'assistant', 
                    content: content,
                    model: this.selectedModelName || 'Claude'
                });
                
                if (this.conversationHistory.length > 30) {
                    this.conversationHistory = this.conversationHistory.slice(-30);
                }
                
                this.saveConversationHistory();
                
                return content;
            }
        } catch (error) {
            console.error('Claude API error:', error);
            throw error;
        }
    }

    async executeAskClaude(question) {
        try {
            // Start loading notification with Claude context
            this.showLoadingNotification(null, 'claude');
            
            // Present the question directly to Claude without confusing context
            const messages = [];
            
            // Only include recent USER messages for context (skip assistant messages entirely)
            if (this.conversationHistory.length > 0) {
                const recentHistory = this.conversationHistory.slice(-5);
                recentHistory.forEach(msg => {
                    if (msg.role === 'user') {
                        let contentStr = '';
                        if (typeof msg.content === 'string') {
                            contentStr = msg.content.trim();
                        } else if (msg.content) {
                            contentStr = String(msg.content).trim();
                        }
                        
                        if (contentStr && contentStr.length > 0 && 
                            !contentStr.toLowerCase().includes('use claude') &&
                            !contentStr.toLowerCase().includes('claude tool')) {
                            messages.push({
                                role: 'user',
                                content: contentStr.substring(0, 1000)
                            });
                        }
                    }
                });
            }
            
            // Build the current question
            let currentQuestion = String(question || '').trim();
            if (!currentQuestion) {
                currentQuestion = 'Please provide an analysis.';
            }
            
            // Add document context if available
            if (this.currentDocument) {
                currentQuestion = `Here is some context from a document:
Title: ${this.currentDocument.title}
URL: ${this.currentDocument.url}
Content: ${String(this.currentDocument.content || '').substring(0, 2000)}...

${currentQuestion}`;
            }
            
            if (currentQuestion && currentQuestion.trim().length > 0) {
                messages.push({
                    role: 'user',
                    content: currentQuestion.trim()
                });
            } else {
                throw new Error('Question cannot be empty');
            }
            
            if (messages.length === 0 || !messages.some(m => m.role === 'user')) {
                throw new Error('Messages array must contain at least one user message');
            }
            
            const requestBody = {
                model: 'claude-sonnet-4-5-20250929',
                max_tokens: 4096,
                messages: messages
            };
            
            console.log('Calling Claude API (tool call) with:', {
                model: requestBody.model,
                messageCount: messages.length
            });
            
            // Use IPC to call Claude through main process (for token tracking and limit enforcement)
            if (this.isElectron && window.require) {
                const { ipcRenderer } = window.require('electron');
                
                console.log('🔒 Calling Claude (tool) via main process IPC');
                const result = await ipcRenderer.invoke('call-claude-api', requestBody);
                
                if (!result.ok) {
                    // Check if it's a limit exceeded error
                    if (result.status === 429 && result.data?.isBlocked !== undefined) {
                        const errorMsg = result.data.error || 'Usage limit exceeded';
                        console.error('🚫 Claude (tool) blocked:', errorMsg);
                        this.stopLoadingAnimation();
                        // Show notification with button to add credits
                        if (result.data.costLimitDollars) {
                            this.showLimitExceededNotification();
                        }
                        return `⚠️ Switched to Jarvis Low. Add credits for other models.`;
                    }
                    
                    this.stopLoadingAnimation();
                    const errorData = result.data || {};
                    
                    if (result.status === 401) {
                        return `Claude API authentication failed (401). Error: ${errorData.error?.message || errorData.error || 'Check your API key'}`;
                    } else if (result.status === 400) {
                        return `Claude API bad request (400). Error: ${errorData.error?.message || errorData.error || 'Check request format'}`;
                    } else {
                        return `Claude analysis failed (${result.status}): ${errorData.error?.message || errorData.error || 'Unknown error'}`;
                    }
                }
                
                const claudeData = result.data;
                
                // Extract text from Claude's response
                let textContent;
                if (claudeData.content && Array.isArray(claudeData.content)) {
                    textContent = claudeData.content
                        .filter(block => block.type === 'text')
                        .map(block => block.text)
                        .join('\n\n');
                    console.log('Claude response extracted, length:', textContent.length);
                } else if (claudeData.content && typeof claudeData.content === 'string') {
                    textContent = claudeData.content;
                } else {
                    console.error('Unexpected Claude response format:', claudeData);
                    this.stopLoadingAnimation();
                    return 'No response from Claude - unexpected response format';
                }
                
                // Switch to default loading context for the synthesis phase
                this.showLoadingNotification(null, 'default');
                return textContent;
            } else {
                // Fallback for non-Electron environment (shouldn't happen)
                console.warn('⚠️ Not in Electron, Claude tool call not tracked');
                this.stopLoadingAnimation();
                return 'Claude is not available in this environment.';
            }
        } catch (error) {
            console.error('Claude API error:', error);
            this.stopLoadingAnimation();
            return `Claude error: ${error.message}`;
        }
    }


    async sendMessage() {
        const message = (this.textInput?.value || '').trim();
        if (!message && (!this.pendingAttachments || this.pendingAttachments.length === 0)) return;

        // Check character limit for Low model (GPT-5 Mini)
        if (this.isUsingLowModel() && message.length > this.lowModelCharLimit) {
            this.showNotification(`⚠️ Message too long for Jarvis Low. Please limit to ${this.lowModelCharLimit} characters. (Current: ${message.length})`, false);
            return;
        }

        // Check low message limit for free users using Low model
        if (this.isUsingLowModel() && !this.hasPremiumAccess() && this.hasReachedLowMessageLimit()) {
            this.showNotification(`⚠️ You've reached your daily limit of ${this.maxFreeLowMessages} messages with Jarvis Low. Try again tomorrow or upgrade for unlimited access!`, false);
            return;
        }

        // Check for /hide command
        if (message.toLowerCase() === '/hide' || message.toLowerCase().startsWith('/hide ')) {
            // Clear input
            if (this.textInput) this.textInput.value = '';
            // Hide Answer Screen button
            const answerBtn = document.getElementById('answer-this-btn');
            if (answerBtn) {
                answerBtn.classList.add('hidden');
            }
            const answerBtnMoved = document.getElementById('answer-this-btn-moved');
            if (answerBtnMoved) {
                answerBtnMoved.classList.add('hidden');
            }
            return;
        }

        // Check for /unhide command
        if (message.toLowerCase() === '/unhide' || message.toLowerCase().startsWith('/unhide ')) {
            // Clear input
            if (this.textInput) this.textInput.value = '';
            // Show Answer Screen button
            const answerBtn = document.getElementById('answer-this-btn');
            if (answerBtn) {
                answerBtn.classList.remove('hidden');
            }
            const answerBtnMoved = document.getElementById('answer-this-btn-moved');
            if (answerBtnMoved) {
                answerBtnMoved.classList.remove('hidden');
            }
            return;
        }

        // Check for /docs command
        if (message.toLowerCase() === '/docs' || message.toLowerCase().startsWith('/docs ')) {
            // Clear input
            if (this.textInput) this.textInput.value = '';
            // Check if it's paste mode
            const isPasteMode = message.toLowerCase().startsWith('/docs paste');
            // Trigger write to docs with paste mode flag
            await this.writeToDocs(isPasteMode);
            return;
        }

        // Check for /calendar command or calendar-related phrases
        const lowerMessage = message.toLowerCase();
        const isCalendarCommand = lowerMessage === '/calendar' || lowerMessage.startsWith('/calendar ');
        
        // Detect calendar VIEW phrases
        const calendarViewPhrases = [
            'what\'s on my calendar', 'whats on my calendar', 'what is on my calendar',
            'show my calendar', 'show calendar', 'check my calendar', 'check calendar',
            'my schedule', 'upcoming events', 'upcoming meetings', 
            'what do i have today', 'what do i have this week', 'any meetings', 'any events'
        ];
        const isCalendarViewPhrase = calendarViewPhrases.some(phrase => lowerMessage.includes(phrase));
        
        if (isCalendarViewPhrase) {
            // Clear input
            if (this.textInput) this.textInput.value = '';
            await this.getUpcomingEvents();
            return;
        }
        
        // Handle /calendar command - show modal for manual event creation
        if (isCalendarCommand) {
            // Clear input
            if (this.textInput) this.textInput.value = '';
                await this.createCalendarEvent();
            return;
        }

        // Check for Gmail-related queries
        const isGmailQuery = lowerMessage.includes('email') || lowerMessage.includes('gmail') || 
                            lowerMessage.includes('inbox') || lowerMessage.includes('messages');
        const isTodaysEmails = lowerMessage.includes('today') && isGmailQuery;
        const isImportantEmails = (lowerMessage.includes('important') || lowerMessage.includes('priority')) && isGmailQuery;
        const isUnreadEmails = (lowerMessage.includes('unread') || lowerMessage.includes('new')) && isGmailQuery;
        
        if (isGmailQuery) {
            // Clear input
            if (this.textInput) this.textInput.value = '';
            
            if (isTodaysEmails) {
                await this.getTodaysEmails();
            } else if (isImportantEmails) {
                await this.getImportantEmails();
            } else if (isUnreadEmails) {
                await this.getUnreadEmails();
            } else {
                // General email query - show today's emails
                await this.getTodaysEmails();
            }
            return;
        }

        // Store the last user query for retry functionality
        if (message) {
            this.lastUserQuery = message;
        }

        // Immediately clear UI input so text disappears as soon as user sends
        if (this.textInput) this.textInput.value = '';

        try {
            if (this.pendingAttachments && this.pendingAttachments.length > 0) {
                const sending = this.pendingAttachments.slice();
                await this.analyzeFilesWithChatGPT(sending, message || 'Analyze these files');
                // Clear attachments after send and revoke blob URLs
                this.pendingAttachments.forEach(att => {
                    if (att && att._blobUrl) {
                        try { URL.revokeObjectURL(att._blobUrl); } catch (_) {}
                    }
                });
                this.pendingAttachments = [];
                this.renderAttachmentsBar();
            } else {
                await this.processMessage(message);
            }
        } catch (error) {
            console.error('sendMessage failed:', error);
        }
    }

    showNotification(text, isHTML = false) {
        if (!this.dragOutput) return;
        
        // If quiz is actively displayed, don't overwrite it with regular notifications
        // Allow error notifications (starting with ❌ or ⚠️) to pass through
        const textContent = String(text || '');
        const isError = textContent.startsWith('❌') || textContent.startsWith('⚠️');
        if (this.quizState && this.dragOutput.classList.contains('quiz-active') && !isError) {
            console.log('📝 Quiz active - skipping notification:', textContent.substring(0, 50));
            return;
        }
        
        // Stop any active loading animation
        this.stopLoadingAnimation();
        
        const content = textContent;
        
        // Don't show "message limit reached" notifications if user has premium
        if (this.hasPremiumAccess() && (content.includes('Message limit reached') || content.includes('message limit reached') || content.includes('Message Limit Reached') || content.includes('message limit') || (content.includes('Wait') && content.includes('subscribe')))) {
            console.log('🚫 Blocked message limit notification in showNotification - user has premium');
            return;
        }
        
        // Check if this is a long response and chunk it
        if (content.length > 800 && content.toLowerCase().includes('elaborate')) {
            this.showChunkedResponse(content, isHTML);
            return;
        }
        
        // Process content for links and math formatting
        const processedContent = this.processContent(content, isHTML);
        
        // Create current output message container (with resize handle) FIRST
        const currentOutput = document.createElement('div');
        currentOutput.className = 'drag-output';
        currentOutput.id = 'drag-output';
        currentOutput.draggable = true;
        currentOutput.title = 'Drag me to drop text into apps';
        currentOutput.innerHTML = processedContent;
        
        // Apply current theme if set
        if (this.currentTheme) {
            currentOutput.style.background = `rgba(${this.hexToRgb(this.currentTheme.bg)}, 0.95)`;
            currentOutput.style.color = this.currentTheme.text;
            currentOutput.style.border = 'none'; // No border
        }
        
        // Apply current opacity if set
        let opacityToApply = this.currentOpacity;
        if (opacityToApply === undefined) {
            // Default opacity if not set (95% = original fully visible)
            opacityToApply = parseInt(localStorage.getItem('jarvis-overlay-opacity') || '95');
        }
        const opacityValue = (opacityToApply / 100).toString();
        currentOutput.style.setProperty('opacity', opacityValue, 'important');
        currentOutput.setAttribute('data-opacity', opacityValue);
        
        // Render math with KaTeX after content is inserted (with delay to ensure DOM and KaTeX are ready)
        setTimeout(() => {
            this.renderMath(currentOutput);
        }, 200);
        
        // Add resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.id = 'resize-handle';
        resizeHandle.className = 'resize-handle';
        resizeHandle.title = 'Drag to resize';
        currentOutput.appendChild(resizeHandle);
        
        // Store clean text without markdown or HTML for dragging
        currentOutput.dataset.fullText = this.stripMarkdown(content).replace(/<[^>]*>/g, '');
        currentOutput.classList.remove('hidden');
        
        // Move drag-output into messages-container or replace if already there
        if (this.messagesContainer) {
            // Remove old drag-output if it exists elsewhere
            const oldDragOutput = document.getElementById('drag-output');
            if (oldDragOutput && oldDragOutput.parentNode !== this.messagesContainer) {
                oldDragOutput.remove();
            }
            
            // Replace or append current output FIRST (so it's at the bottom)
            if (oldDragOutput && oldDragOutput.parentNode === this.messagesContainer) {
                this.messagesContainer.replaceChild(currentOutput, oldDragOutput);
            } else {
                this.messagesContainer.appendChild(currentOutput);
            }
            
            // NOW render previous messages (they'll be inserted before currentOutput, above viewport)
            this.renderPreviousMessages();
            
            this.messagesContainer.classList.remove('hidden');
            
                        // Set initial height to fit just the current message
                        const currentMessage = this.messagesContainer.querySelector('#drag-output');
                        if (currentMessage) {
                            // Start with height matching just the current message + padding
                            // Use requestAnimationFrame to ensure DOM is ready
                            requestAnimationFrame(() => {
                                if (this.messagesContainer && currentMessage) {
                                    const currentHeight = currentMessage.offsetHeight;
                                    const padding = 0.5 * 16; // padding-bottom only (0.5rem = 8px)
                                    const initialHeight = currentHeight + padding;
                                    this.messagesContainer.style.height = `${initialHeight}px`;
                                    this.messagesContainer.style.maxHeight = '400px';
                                    
                                    // Ensure we're scrolled to bottom to hide previous messages
                                    requestAnimationFrame(() => {
                                        if (this.messagesContainer) {
                                            this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
                                        }
                                    });
                                }
                            });
                        }
            
            // Force scroll to bottom IMMEDIATELY to hide previous messages
            // Temporarily disable user scroll tracking
            this.isUserScrolling = false;
            
            // Do it synchronously first, then async to ensure it sticks
            const forceScroll = () => {
                if (this.messagesContainer) {
                    // Scroll to bottom to show the current message fully
                    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
                }
            };
            
            forceScroll();
            setTimeout(forceScroll, 0);
            setTimeout(forceScroll, 10);
            setTimeout(forceScroll, 50);
            
            // Show reveal history button only if there are previous messages AND output is visible
            const previousMessages = this.messagesContainer.querySelectorAll('.drag-output:not(#drag-output)');
            if (this.revealHistoryBtn && previousMessages.length > 0 && !this.messagesContainer.classList.contains('hidden')) {
                this.revealHistoryBtn.classList.remove('hidden');
            } else if (this.revealHistoryBtn) {
                this.revealHistoryBtn.classList.add('hidden');
            }
            
            // Show close button
            if (this.closeOutputFloating) {
                this.closeOutputFloating.classList.remove('hidden');
            }
            
            // Then ensure it stays at bottom with multiple attempts
            setTimeout(() => {
                this.scrollToBottom();
            }, 0);
        } else {
            // Fallback if messages-container doesn't exist
            currentOutput.classList.remove('hidden');
        }
        
        this.dragOutput = currentOutput;
        this.resizeHandle = resizeHandle;
        
        // Attach drag event listeners to the new drag-output element
        this.attachDragListeners();
        
        this.positionFloatingClose();
        
        // Ensure scroll stays at bottom after all rendering is complete
        this.scrollToBottom();
        
        // Show action buttons container first
        if (this.actionButtonsContainer) {
            this.actionButtonsContainer.classList.remove('hidden');
        }
        
        // Hide default answer button (under HUD) and show moved version in container
        if (this.answerThisBtn) {
            this.answerThisBtn.classList.add('hidden');
            // Show the moved version in the container
            const answerBtnMoved = document.getElementById('answer-this-btn-moved');
            if (answerBtnMoved) {
                answerBtnMoved.classList.remove('hidden');
            }
        }
        
        // Show humanize button
        if (this.humanizeBtn) {
            this.humanizeBtn.classList.remove('hidden');
        }
        
        // Reapply button colors based on current theme
        this.reapplyButtonColors();
        
        document.querySelectorAll('.notification').forEach(n => n.remove());
    }

    showLoadingNotification(message = null, context = 'default') {
        if (!this.dragOutput) return;
        
        // Clear any "message limit reached" notifications if user has premium
        if (this.hasPremiumAccess() && !this.dragOutput.classList.contains('hidden')) {
            const currentContent = this.dragOutput.innerHTML || this.dragOutput.textContent || '';
            if (currentContent.includes('Message limit reached') || currentContent.includes('message limit reached') || currentContent.includes('Message Limit Reached') || currentContent.includes('message limit')) {
                // Clear it before showing loading notification
                this.dragOutput.classList.add('hidden');
                this.dragOutput.innerHTML = '';
                this.dragOutput.textContent = '';
            }
        }
        
        // Stop any existing loading animation
        this.stopLoadingAnimation();
        
        // Context-specific loading messages that rotate
        const messageSets = {
            'default': ['analyzing', 'thinking', 'preparing', 'processing', 'answering', 'working'],
            'search': ['searching', 'querying', 'fetching', 'analyzing results', 'processing data', 'gathering information'],
            'claude': ['analyzing', 'reasoning', 'thinking deeply', 'processing', 'formulating', 'synthesizing']
        };
        
        const loadingMessages = messageSets[context] || messageSets['default'];
        
        // Use provided message or start with first loading message
        if (message) {
            this.currentLoadingMessage = message;
        } else {
            this.loadingMessageIndex = 0;
            this.currentLoadingMessage = loadingMessages[0];
        }
        
        // Create animated dots
        const dots = ['', '.', '..', '...'];
        let dotIndex = 0;
        
        // Function to update the display
        const updateDisplay = () => {
            if (!this.dragOutput) {
                this.stopLoadingAnimation();
                return;
            }
            
            // Cycle through dots every 500ms
            dotIndex = (dotIndex + 1) % dots.length;
            const animatedText = `${this.currentLoadingMessage}${dots[dotIndex]}`;
            const processedContent = this.processContent(animatedText, false);
            
            // Render previous messages, then add loading message
            this.renderPreviousMessages();
            
            // Create loading message container
            const loadingContainer = this.dragOutput ? this.dragOutput.cloneNode(false) : document.createElement('div');
            loadingContainer.className = 'drag-output';
            loadingContainer.id = 'drag-output';
            loadingContainer.innerHTML = processedContent;
            
            // Render math with KaTeX (with delay to ensure DOM and KaTeX are ready)
            setTimeout(() => {
                this.renderMath(loadingContainer);
            }, 200);
            
            // Replace or add loading container
            if (this.messagesContainer) {
                if (this.dragOutput && this.dragOutput.parentNode === this.messagesContainer) {
                    this.messagesContainer.replaceChild(loadingContainer, this.dragOutput);
                } else {
                    this.messagesContainer.appendChild(loadingContainer);
                }
                this.dragOutput = loadingContainer;
                this.messagesContainer.classList.remove('hidden');
                
                // Ensure container is visible and has proper height to show loading message
                requestAnimationFrame(() => {
                    if (this.messagesContainer && this.dragOutput) {
                        // Set container height to fit the loading message
                        const loadingHeight = this.dragOutput.offsetHeight || 60; // Default height if not calculated yet
                        const padding = 0.5 * 16; // padding-bottom
                        this.messagesContainer.style.height = `${loadingHeight + padding}px`;
                        this.messagesContainer.style.maxHeight = '400px';
                        this.messagesContainer.style.overflowY = 'visible'; // Don't scroll during loading
                        
                        // Set scroll to 0 to keep loading notification at top, visible
                        this.messagesContainer.scrollTop = 0;
                        
                        // Position close button after container is sized and layout is complete
                        setTimeout(() => {
                            this.positionFloatingClose();
                        }, 150);
                    }
                });
            } else {
                // Fallback
                loadingContainer.innerHTML = processedContent;
            }
        };
        
        // Initial display
        updateDisplay();
        if (this.dragOutput) {
            this.dragOutput.classList.add('loading-notification');
            this.dragOutput.classList.remove('hidden');
            // Ensure it's visible
            this.dragOutput.style.display = 'block';
            this.dragOutput.style.opacity = '1';
            this.dragOutput.style.visibility = 'visible';
        }
        // Position close button will be called after container is sized (in updateDisplay's requestAnimationFrame)
        
        // Hide buttons during loading
        if (this.answerThisBtn) {
            this.answerThisBtn.classList.add('hidden');
        }
        if (this.actionButtonsContainer) {
            this.actionButtonsContainer.classList.add('hidden');
        }
        if (this.humanizeBtn) {
            this.humanizeBtn.classList.add('hidden');
        }
        
        // Animate dots every 500ms
        this.loadingInterval = setInterval(updateDisplay, 500);
        
        // Rotate messages every 2 seconds if no specific message provided
        if (!message) {
            this.loadingMessageInterval = setInterval(() => {
                this.loadingMessageIndex = (this.loadingMessageIndex + 1) % loadingMessages.length;
                this.currentLoadingMessage = loadingMessages[this.loadingMessageIndex];
            }, 2000);
        }
    }

    stopLoadingAnimation() {
        if (this.loadingInterval) {
            clearInterval(this.loadingInterval);
            this.loadingInterval = null;
        }
        if (this.loadingMessageInterval) {
            clearInterval(this.loadingMessageInterval);
            this.loadingMessageInterval = null;
        }
        if (this.dragOutput) {
            this.dragOutput.classList.remove('loading-notification');
        }
    }

    showQuiz(topic, questions) {
        console.log('📝 showQuiz called with topic:', topic);
        console.log('📝 questions received:', JSON.stringify(questions, null, 2));
        
        // Stop any loading animation first
        this.stopLoadingAnimation();
        
        // Ensure dragOutput exists
        if (!this.dragOutput) {
            this.dragOutput = document.getElementById('drag-output');
        }
        
        if (!this.dragOutput) {
            console.error('📝 ERROR: Could not find drag-output element');
            const overlay = document.getElementById('jarvis-overlay');
            if (overlay) {
                const outputDiv = document.createElement('div');
                outputDiv.id = 'drag-output';
                outputDiv.className = 'drag-output';
                overlay.appendChild(outputDiv);
                this.dragOutput = outputDiv;
            } else {
                console.error('📝 ERROR: Could not find overlay element');
                return;
            }
        }
        
        // Validate questions array
        if (!questions || !Array.isArray(questions) || questions.length === 0) {
            console.error('📝 ERROR: Invalid questions array:', questions);
            this.dragOutput.innerHTML = `<div style="color: #fff; padding: 8px;">
                <p style="color: #ef4444; margin: 0;">❌ No quiz questions generated. Try asking again.</p>
            </div>`;
            this.dragOutput.classList.remove('hidden');
            this.dragOutput.classList.remove('loading-notification');
            this.dragOutput.style.display = 'block';
            return;
        }
        
        console.log('📝 Valid quiz data - creating quiz with', questions.length, 'questions');
        
        // Store quiz state and show type selection
        this.quizState = {
            topic: topic,
            questions: questions,
            currentIndex: 0,
            score: 0,
            answered: false,
            type: null // 'mcq' or 'frq'
        };
        
        this.showQuizTypeSelection();
    }
    
    showQuizTypeSelection() {
        if (!this.quizState) return;
        
        const { topic, questions } = this.quizState;
        
        // Ensure we have a dragOutput element
        if (!this.dragOutput) {
            this.dragOutput = document.getElementById('drag-output');
        }
        
        // If dragOutput is inside messagesContainer, we need to use messagesContainer directly
        // or move dragOutput outside. Let's use messagesContainer and show quiz there.
        if (this.messagesContainer) {
            // Clear previous messages and show quiz in the container
            this.messagesContainer.innerHTML = '';
            this.messagesContainer.classList.remove('hidden');
            
            // Create quiz output element
            const quizOutput = document.createElement('div');
            quizOutput.id = 'drag-output';
            quizOutput.className = 'drag-output quiz-active';
            quizOutput.style.display = 'block';
            quizOutput.innerHTML = `<div style="color:#fff;line-height:1.3;"><div style="font-size:12px;font-weight:600;margin-bottom:6px;">📝 ${topic} <span style="font-size:10px;color:rgba(255,255,255,0.5);font-weight:400;">(${questions.length})</span></div><div style="display:flex;gap:6px;"><button onclick="window.jarvisOverlay.startQuiz('mcq')" style="flex:1;padding:6px 10px;background:linear-gradient(135deg,#4A9EFF,#6366f1);border:none;border-radius:4px;color:#fff;font-size:11px;font-weight:600;cursor:pointer;">MCQ</button><button onclick="window.jarvisOverlay.startQuiz('frq')" style="flex:1;padding:6px 10px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:4px;color:#fff;font-size:11px;font-weight:600;cursor:pointer;">FRQ</button></div></div>`;
            
            this.messagesContainer.appendChild(quizOutput);
            this.dragOutput = quizOutput;
            
            // Set container height to fit content
            this.messagesContainer.style.height = 'auto';
            this.messagesContainer.style.maxHeight = '400px';
        } else if (this.dragOutput) {
            // Fallback if no messagesContainer
            this.dragOutput.innerHTML = `<div style="color:#fff;line-height:1.3;"><div style="font-size:12px;font-weight:600;margin-bottom:6px;">📝 ${topic} <span style="font-size:10px;color:rgba(255,255,255,0.5);font-weight:400;">(${questions.length})</span></div><div style="display:flex;gap:6px;"><button onclick="window.jarvisOverlay.startQuiz('mcq')" style="flex:1;padding:6px 10px;background:linear-gradient(135deg,#4A9EFF,#6366f1);border:none;border-radius:4px;color:#fff;font-size:11px;font-weight:600;cursor:pointer;">MCQ</button><button onclick="window.jarvisOverlay.startQuiz('frq')" style="flex:1;padding:6px 10px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:4px;color:#fff;font-size:11px;font-weight:600;cursor:pointer;">FRQ</button></div></div>`;
            this.dragOutput.classList.remove('hidden');
            this.dragOutput.classList.add('quiz-active');
            this.dragOutput.style.display = 'block';
        }
        
        // Hide action buttons during quiz
        if (this.answerThisBtn) this.answerThisBtn.classList.add('hidden');
        if (this.humanizeBtn) this.humanizeBtn.classList.add('hidden');
        if (this.actionButtonsContainer) this.actionButtonsContainer.classList.add('hidden');
    }
    
    startQuiz(type) {
        if (!this.quizState) return;
        this.quizState.type = type;
        this.quizState.currentIndex = 0;
        this.quizState.score = 0;
        this.quizState.answered = false;
        this.renderQuizQuestion();
    }
    
    renderQuizQuestion() {
        if (!this.quizState) return;
        
        // Ensure dragOutput exists
        if (!this.dragOutput || !document.body.contains(this.dragOutput)) {
            this.dragOutput = document.getElementById('drag-output');
            if (!this.dragOutput) {
                console.error('📝 renderQuizQuestion: No drag-output element found');
                return;
            }
        }
        
        const { topic, questions, currentIndex, score, type } = this.quizState;
        const question = questions[currentIndex];
        
        if (!question) {
            this.showQuizResults();
            return;
        }
        
        // MCQ Quiz
        if (type === 'mcq') {
            if (!question.options || !Array.isArray(question.options)) {
                this.dragOutput.innerHTML = `<div style="color:#ef4444;font-size:11px;">❌ Invalid question format</div>`;
                return;
            }
            
            const quizHTML = `<div style="color:#fff;line-height:1.35;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><span style="font-size:11px;font-weight:600;">📝 ${topic}</span><span style="font-size:9px;color:rgba(255,255,255,0.5);">Q${currentIndex + 1}/${questions.length} • ${score}</span></div><div style="font-size:12px;font-weight:500;margin-bottom:8px;">${question.question}</div><div style="display:flex;flex-direction:column;gap:4px;">${question.options.map((opt, i) => `<button class="quiz-option" data-index="${i}" onclick="window.jarvisOverlay.selectQuizAnswer(${i})" style="display:flex;align-items:center;gap:6px;padding:5px 8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:4px;cursor:pointer;text-align:left;color:#fff;font-size:11px;"><span style="display:flex;align-items:center;justify-content:center;min-width:18px;height:18px;background:rgba(255,255,255,0.1);border-radius:50%;font-weight:600;font-size:10px;">${String.fromCharCode(65 + i)}</span><span>${opt}</span></button>`).join('')}</div><div id="quiz-feedback" style="display:none;margin-top:6px;padding:6px;background:rgba(255,255,255,0.05);border-radius:4px;text-align:center;"></div></div>`;
            
            this.dragOutput.innerHTML = quizHTML;
        } else {
            // FRQ Quiz
            const quizHTML = `<div style="color:#fff;line-height:1.35;"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;"><span style="font-size:11px;font-weight:600;">📝 ${topic}</span><span style="font-size:9px;color:rgba(255,255,255,0.5);">Q${currentIndex + 1}/${questions.length} • ${score}</span></div><div style="font-size:12px;font-weight:500;margin-bottom:8px;">${question.question}</div><input type="text" id="frq-answer" placeholder="Type your answer..." style="width:100%;padding:6px 8px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.15);border-radius:4px;color:#fff;font-size:11px;outline:none;box-sizing:border-box;" onkeypress="if(event.key==='Enter')window.jarvisOverlay.submitFRQAnswer()"><button onclick="window.jarvisOverlay.submitFRQAnswer()" style="width:100%;margin-top:6px;padding:6px 8px;background:linear-gradient(135deg,#4A9EFF,#6366f1);border:none;border-radius:4px;color:#fff;font-size:11px;font-weight:600;cursor:pointer;">Submit</button><div id="quiz-feedback" style="display:none;margin-top:6px;padding:6px;background:rgba(255,255,255,0.05);border-radius:4px;text-align:center;"></div></div>`;
            
            this.dragOutput.innerHTML = quizHTML;
        }
        
        this.dragOutput.classList.remove('hidden');
        this.dragOutput.classList.add('quiz-active');
        this.dragOutput.removeAttribute('title');
        this.dragOutput.style.display = 'block';
        
        // Ensure messagesContainer is visible (quiz is inside it)
        if (this.messagesContainer) {
            this.messagesContainer.classList.remove('hidden');
            this.messagesContainer.style.height = 'auto';
            this.messagesContainer.style.maxHeight = '400px';
        }
        
        // Hide action buttons during quiz
        if (this.answerThisBtn) this.answerThisBtn.classList.add('hidden');
        if (this.humanizeBtn) this.humanizeBtn.classList.add('hidden');
        if (this.actionButtonsContainer) this.actionButtonsContainer.classList.add('hidden');
    }
    
    selectQuizAnswer(selectedIndex) {
        if (!this.quizState || this.quizState.answered) return;
        
        this.quizState.answered = true;
        const question = this.quizState.questions[this.quizState.currentIndex];
        const isCorrect = selectedIndex === question.correct_index;
        
        if (isCorrect) {
            this.quizState.score++;
        }
        
        // Update option styling
        const options = this.dragOutput.querySelectorAll('.quiz-option');
        options.forEach((opt, i) => {
            opt.disabled = true;
            opt.style.pointerEvents = 'none';
            if (i === question.correct_index) {
                opt.style.background = 'rgba(34, 197, 94, 0.2)';
                opt.style.borderColor = 'rgba(34, 197, 94, 0.5)';
            } else if (i === selectedIndex && !isCorrect) {
                opt.style.background = 'rgba(239, 68, 68, 0.2)';
                opt.style.borderColor = 'rgba(239, 68, 68, 0.5)';
            }
        });
        
        // Show feedback
        const feedback = document.getElementById('quiz-feedback');
        if (feedback) {
            feedback.style.display = 'block';
            feedback.innerHTML = `<div style="font-size:11px;font-weight:600;color:${isCorrect ? '#22c55e' : '#ef4444'};">${isCorrect ? '✅ Correct!' : '❌ Incorrect'}</div>${question.explanation ? `<div style="font-size:10px;color:rgba(255,255,255,0.6);margin-top:4px;">${question.explanation}</div>` : ''}<button onclick="window.jarvisOverlay.nextQuizQuestion()" style="padding:4px 12px;margin-top:6px;background:linear-gradient(135deg,#4A9EFF,#6366f1);border:none;border-radius:4px;color:#fff;font-size:10px;font-weight:600;cursor:pointer;">${this.quizState.currentIndex < this.quizState.questions.length - 1 ? 'Next →' : 'Results'}</button>`;
        }
    }
    
    submitFRQAnswer() {
        if (!this.quizState || this.quizState.answered) return;
        
        const input = document.getElementById('frq-answer');
        if (!input) return;
        
        const userAnswer = input.value.trim().toLowerCase();
        if (!userAnswer) return;
        
        this.quizState.answered = true;
        const question = this.quizState.questions[this.quizState.currentIndex];
        
        // Get correct answer from options (first option is usually correct for MCQ converted to FRQ)
        const correctAnswer = question.options[question.correct_index].toLowerCase();
        
        // Simple matching - check if user answer contains key words from correct answer
        const isCorrect = correctAnswer.includes(userAnswer) || userAnswer.includes(correctAnswer) || 
                          this.fuzzyMatch(userAnswer, correctAnswer);
        
        if (isCorrect) {
            this.quizState.score++;
        }
        
        input.disabled = true;
        input.style.opacity = '0.5';
        
        // Show feedback
        const feedback = document.getElementById('quiz-feedback');
        if (feedback) {
            feedback.style.display = 'block';
            feedback.innerHTML = `<div style="font-size:11px;font-weight:600;color:${isCorrect ? '#22c55e' : '#ef4444'};">${isCorrect ? '✅ Correct!' : '❌ Incorrect'}</div><div style="font-size:10px;color:rgba(255,255,255,0.6);margin-top:4px;">Answer: ${question.options[question.correct_index]}</div><button onclick="window.jarvisOverlay.nextQuizQuestion()" style="padding:4px 12px;margin-top:6px;background:linear-gradient(135deg,#4A9EFF,#6366f1);border:none;border-radius:4px;color:#fff;font-size:10px;font-weight:600;cursor:pointer;">${this.quizState.currentIndex < this.quizState.questions.length - 1 ? 'Next →' : 'Results'}</button>`;
        }
    }
    
    fuzzyMatch(str1, str2) {
        // Simple fuzzy matching - check if significant words match
        const words1 = str1.split(/\s+/).filter(w => w.length > 3);
        const words2 = str2.split(/\s+/).filter(w => w.length > 3);
        
        let matches = 0;
        for (const w1 of words1) {
            for (const w2 of words2) {
                if (w1.includes(w2) || w2.includes(w1)) {
                    matches++;
                    break;
                }
            }
        }
        
        return matches >= Math.min(words1.length, words2.length) * 0.5;
    }
    
    nextQuizQuestion() {
        if (!this.quizState) return;
        
        this.quizState.currentIndex++;
        this.quizState.answered = false;
        this.renderQuizQuestion();
    }
    
    showQuizResults() {
        if (!this.quizState) return;
        
        // Ensure dragOutput exists
        if (!this.dragOutput || !document.body.contains(this.dragOutput)) {
            this.dragOutput = document.getElementById('drag-output');
            if (!this.dragOutput) {
                console.error('📝 showQuizResults: No drag-output element found');
                return;
            }
        }
        
        const { topic, questions, score } = this.quizState;
        const percentage = Math.round((score / questions.length) * 100);
        
        let emoji;
        if (percentage >= 90) emoji = '🏆';
        else if (percentage >= 70) emoji = '🌟';
        else if (percentage >= 50) emoji = '👍';
        else emoji = '📚';
        
        const resultsHTML = `<div style="text-align:center;color:#fff;line-height:1.35;"><div style="font-size:18px;">${emoji}</div><div style="font-size:12px;font-weight:600;margin-top:4px;">${topic}</div><div style="font-size:16px;font-weight:700;color:#4A9EFF;margin-top:6px;">${score}/${questions.length} <span style="font-size:10px;color:rgba(255,255,255,0.5);">(${percentage}%)</span></div><div style="display:flex;gap:6px;justify-content:center;margin-top:8px;"><button onclick="window.jarvisOverlay.retakeQuiz()" style="padding:5px 10px;background:linear-gradient(135deg,#4A9EFF,#6366f1);border:none;border-radius:4px;color:#fff;font-size:10px;font-weight:600;cursor:pointer;">🔄 Retake</button><button onclick="window.jarvisOverlay.closeQuiz()" style="padding:5px 10px;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:4px;color:#fff;font-size:10px;font-weight:600;cursor:pointer;">✕ Close</button></div></div>`;
        
        this.dragOutput.innerHTML = resultsHTML;
        this.dragOutput.classList.add('quiz-active');
        this.dragOutput.style.display = 'block';
    }
    
    retakeQuiz() {
        if (!this.quizState) return;
        this.quizState.currentIndex = 0;
        this.quizState.score = 0;
        this.quizState.answered = false;
        this.quizState.type = null;
        this.showQuizTypeSelection();
    }
    
    closeQuiz() {
        this.quizState = null;
        if (this.dragOutput) {
            this.dragOutput.classList.add('hidden');
            this.dragOutput.classList.remove('quiz-active');
            this.dragOutput.innerHTML = '';
            this.dragOutput.style.cssText = ''; // Reset all inline styles
            this.dragOutput.title = 'Drag me to drop text into apps';
        }
        // Hide messages container (no output to show)
        if (this.messagesContainer) {
            this.messagesContainer.classList.add('hidden');
            this.messagesContainer.classList.remove('quiz-active');
            this.messagesContainer.style.cssText = ''; // Reset all inline styles
        }
        // Hide floating close button (X)
        if (this.closeOutputFloating) {
            this.closeOutputFloating.classList.add('hidden');
        }
        // Hide reveal history button
        if (this.revealHistoryBtn) {
            this.revealHistoryBtn.classList.add('hidden');
            this.revealHistoryBtn.classList.remove('rotated');
        }
        // Reset to default state - only show original Answer Screen button (no output visible)
        if (this.answerThisBtn) {
            this.answerThisBtn.classList.remove('hidden');
            this.answerThisBtn.classList.add('answer-this-default');
        }
        // Hide action buttons container since there's no output to act on
        if (this.actionButtonsContainer) this.actionButtonsContainer.classList.add('hidden');
        if (this.humanizeBtn) this.humanizeBtn.classList.add('hidden');
        // Hide moved answer button
        const answerBtnMoved = document.getElementById('answer-this-btn-moved');
        if (answerBtnMoved) answerBtnMoved.classList.add('hidden');
        // Hide output toolbar
        this.hideOutputToolbar();
    }

    addMessage(sender, content, role = 'user') {
        // Add message to conversation history
        this.conversationHistory.push({
            role: role,
            content: content
        });
        
        // Show notification with the message
        this.showNotification(content, true);
    }

    toggleSettingsMenu() {
        if (this.settingsMenu) {
            if (this.settingsMenu.classList.contains('hidden')) {
                this.settingsMenu.classList.remove('hidden');
                // Attach opacity slider listener when menu opens
                this.attachOpacitySliderWhenReady();
            } else {
                this.settingsMenu.classList.add('hidden');
            }
        }
    }

    hideSettingsMenu() {
        if (this.settingsMenu) {
            this.settingsMenu.classList.add('hidden');
        }
    }
    
    attachOpacitySliderWhenReady() {
        // Simply update the slider value - inline handlers in HTML will do the work
        const slider = document.getElementById('opacity-slider');
        if (!slider) {
            console.warn('❌ Opacity slider not found');
            return;
        }
        
        // Set the saved value (default 95% = original fully visible)
        const savedOpacity = localStorage.getItem('jarvis-overlay-opacity') || '95';
        slider.value = savedOpacity;
        
        // Update display
        const display = document.getElementById('opacity-value-display');
        if (display) {
            display.textContent = savedOpacity + '%';
        }
        
        console.log('✅ Opacity slider ready, value:', savedOpacity + '%');
    }

    toggleModelSubmenu() {
        if (this.modelSubmenu) {
            const isHidden = this.modelSubmenu.classList.contains('hidden');
            if (isHidden) {
                this.modelSubmenu.classList.remove('hidden');
                // Update locked state for models based on premium status
                this.updateModelLockedState();
            } else {
                this.modelSubmenu.classList.add('hidden');
            }
        }
    }
    
    updateModelLockedState() {
        if (!this.modelSubmenu) return;
        
        const hasPremium = this.hasPremiumAccess();
        const modelItems = this.modelSubmenu.querySelectorAll('.model-item');
        
        modelItems.forEach(item => {
            const model = item.getAttribute('data-model');
            // Only the default Jarvis model is free - all others require premium
            if (model !== 'default') {
                if (hasPremium) {
                    item.classList.remove('locked');
                } else {
                    item.classList.add('locked');
                }
            }
        });
    }

    hideModelSubmenu() {
        if (this.modelSubmenu) {
            this.modelSubmenu.classList.add('hidden');
        }
    }
    
    toggleSettingsSubmenu() {
        if (this.settingsSubmenu) {
            const isHidden = this.settingsSubmenu.classList.contains('hidden');
            if (isHidden) {
                this.settingsSubmenu.classList.remove('hidden');
                // Attach opacity slider listener when submenu opens
                setTimeout(() => this.attachOpacitySliderWhenReady(), 50);
            } else {
                this.settingsSubmenu.classList.add('hidden');
            }
        }
    }
    
    
    hideSettingsSubmenu() {
        if (this.settingsSubmenu) {
            this.settingsSubmenu.classList.add('hidden');
        }
    }
    
    toggleColorSubmenu() {
        if (this.colorSubmenu) {
            const isHidden = this.colorSubmenu.classList.contains('hidden');
            if (isHidden) {
                this.colorSubmenu.classList.remove('hidden');
            } else {
                this.colorSubmenu.classList.add('hidden');
            }
        }
    }
    
    hideColorSubmenu() {
        if (this.colorSubmenu) {
            this.colorSubmenu.classList.add('hidden');
        }
    }
    
    
    setOverlayOpacity(opacity) {
        console.log(`setOverlayOpacity called with: ${opacity}%`);
        // Store opacity for new messages
        this.currentOpacity = opacity;
        const opacityValue = (opacity / 100).toString();
        
        // Apply opacity to ALL visible UI elements
        
        // Add a CSS rule to ensure opacity is applied
        let opacityStyle = document.getElementById('overlay-opacity-style');
        if (!opacityStyle) {
            opacityStyle = document.createElement('style');
            opacityStyle.id = 'overlay-opacity-style';
            document.head.appendChild(opacityStyle);
        }
        
        // Apply to all overlay elements: HUD, output, buttons, history
        opacityStyle.textContent = `
            .minimal-hud { opacity: ${opacityValue} !important; }
            .drag-output { opacity: ${opacityValue} !important; }
            #drag-output { opacity: ${opacityValue} !important; }
            .messages-container { opacity: ${opacityValue} !important; }
            .answer-this-btn { opacity: ${opacityValue} !important; }
            .humanize-btn { opacity: ${opacityValue} !important; }
            .reveal-history-btn { opacity: ${opacityValue} !important; }
            .action-buttons-container { opacity: ${opacityValue} !important; }
        `;
        
        // Apply directly to elements
        const elements = [
            '.minimal-hud',
            '.drag-output',
            '.messages-container',
            '.answer-this-btn',
            '.humanize-btn',
            '.reveal-history-btn',
            '.action-buttons-container'
        ];
        
        elements.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
                el.style.setProperty('opacity', opacityValue, 'important');
            });
        });
        
        console.log(`Opacity set to ${opacity}% for all overlay elements`);
    }
    
    setOverlayColor(color) {
        if (!this.overlay) return;
        
        const colors = {
            white: { bg: '#ffffff', text: '#000000', border: 'rgba(0, 0, 0, 0.2)' },
            '#ffffff': { bg: '#ffffff', text: '#000000', border: 'rgba(0, 0, 0, 0.2)' },
            black: { bg: '#000000', text: '#ffffff', border: 'rgba(255, 255, 255, 0.2)' },
            '#000000': { bg: '#000000', text: '#ffffff', border: 'rgba(255, 255, 255, 0.2)' },
            pink: { bg: '#ec4899', text: '#ffffff', border: 'rgba(255, 255, 255, 0.2)' },
            '#ec4899': { bg: '#ec4899', text: '#ffffff', border: 'rgba(255, 255, 255, 0.2)' },
            blue: { bg: '#4A9EFF', text: '#ffffff', border: 'rgba(255, 255, 255, 0.2)' },
            '#4A9EFF': { bg: '#4A9EFF', text: '#ffffff', border: 'rgba(255, 255, 255, 0.2)' }
        };
        
        const theme = colors[color] || colors.black;
        
        // Store current theme for new messages
        this.currentTheme = theme;
        this.currentColor = color;
        
        // Update minimal-hud background
        const minimalHud = this.overlay.querySelector('.minimal-hud');
        if (minimalHud) {
            minimalHud.style.background = `rgba(${this.hexToRgb(theme.bg)}, 0.9)`;
            minimalHud.style.borderColor = theme.border;
        }
        
        // Update all drag-output elements (all message outputs)
        const allDragOutputs = this.overlay.querySelectorAll('.drag-output');
        allDragOutputs.forEach(output => {
            output.style.background = `rgba(${this.hexToRgb(theme.bg)}, 0.95)`;
            output.style.color = theme.text;
            output.style.border = 'none'; // Remove border
            
            // Update all text inside
            const textElements = output.querySelectorAll('*');
            textElements.forEach(el => {
                if (el.tagName !== 'SVG' && !el.classList.contains('action-btn')) {
                    el.style.color = theme.text;
                }
            });
        });
        
        // Update text input field - keep it transparent, only change text color
        const textInput = this.overlay.querySelector('#text-input');
        const isWhiteTheme = color === 'white' || color === '#ffffff';
        if (textInput) {
            textInput.style.background = 'transparent'; // Keep transparent
            if (isWhiteTheme) {
                textInput.style.color = '#333333'; // Dark gray for white overlay
                textInput.style.setProperty('color', '#333333', 'important');
            } else {
                textInput.style.color = theme.text;
                textInput.style.setProperty('color', theme.text, 'important');
            }
            textInput.style.border = 'none'; // No border
            
            // Update placeholder color with a style tag
            let placeholderStyle = document.getElementById('text-input-placeholder-style');
            if (!placeholderStyle) {
                placeholderStyle = document.createElement('style');
                placeholderStyle.id = 'text-input-placeholder-style';
                document.head.appendChild(placeholderStyle);
            }
            if (isWhiteTheme) {
                placeholderStyle.textContent = `#text-input::placeholder { color: rgba(0, 0, 0, 0.4) !important; }`;
            } else {
                placeholderStyle.textContent = `#text-input::placeholder { color: rgba(255, 255, 255, 0.5) !important; }`;
            }
        }
        
        // Update color preview
        if (this.colorPreview) {
            this.colorPreview.style.background = theme.bg;
        }
        
        // Update icons (drag handle, paperclip, hamburger menu)
        const isWhite = color === 'white' || color === '#ffffff';
        const iconColor = isWhite ? '#333333' : 'rgba(255, 255, 255, 0.7)';
        const iconHoverColor = isWhite ? '#000000' : 'rgba(255, 255, 255, 1)';
        
        // Update drag handle color
        const dragHandle = this.overlay.querySelector('.drag-handle');
        if (dragHandle) {
            dragHandle.style.color = iconColor;
            const dots = dragHandle.querySelectorAll('.dot');
            dots.forEach(dot => {
                dot.style.background = iconColor;
            });
        }
        
        // Update paperclip (add button) color
        const addBtn = this.overlay.querySelector('.add-btn');
        if (addBtn) {
            addBtn.style.color = iconColor;
        }
        
        // Update hamburger menu (settings button) color
        const settingsBtn = this.overlay.querySelector('.settings-btn');
        if (settingsBtn) {
            settingsBtn.style.color = iconColor;
            const menuIcon = settingsBtn.querySelector('.menu-icon');
            if (menuIcon) {
                const spans = menuIcon.querySelectorAll('span');
                spans.forEach(span => {
                    span.style.background = iconColor;
                });
            }
        }
        
        // Update Answer Screen button - use theme color for colored themes
        const answerBtn = this.overlay.querySelector('.answer-this-btn');
        if (answerBtn) {
            if (isWhite) {
                // White theme: white button with black text
                answerBtn.style.background = 'rgba(255, 255, 255, 0.95)';
                answerBtn.style.color = '#000000';
                answerBtn.style.borderColor = 'rgba(0, 0, 0, 0.2)';
            } else if (color === 'pink' || color === '#ec4899') {
                // Pink theme: pink button
                answerBtn.style.background = 'rgba(236, 72, 153, 0.9)';
                answerBtn.style.color = '#ffffff';
                answerBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            } else if (color === 'blue' || color === '#4A9EFF') {
                // Blue theme: blue button
                answerBtn.style.background = 'rgba(74, 158, 255, 0.9)';
                answerBtn.style.color = '#ffffff';
                answerBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            } else {
                // Black/default theme
                answerBtn.style.background = `rgba(${this.hexToRgb(theme.bg)}, 0.9)`;
                answerBtn.style.color = theme.text;
                answerBtn.style.borderColor = theme.border;
            }
        }
        
        // Update Humanize button - same logic
        const humanizeBtn = this.overlay.querySelector('.humanize-btn');
        if (humanizeBtn) {
            if (isWhite) {
                humanizeBtn.style.background = 'rgba(255, 255, 255, 0.95)';
                humanizeBtn.style.color = '#000000';
                humanizeBtn.style.borderColor = 'rgba(0, 0, 0, 0.2)';
            } else if (color === 'pink' || color === '#ec4899') {
                humanizeBtn.style.background = 'rgba(236, 72, 153, 0.9)';
                humanizeBtn.style.color = '#ffffff';
                humanizeBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            } else if (color === 'blue' || color === '#4A9EFF') {
                humanizeBtn.style.background = 'rgba(74, 158, 255, 0.9)';
                humanizeBtn.style.color = '#ffffff';
                humanizeBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            } else {
                humanizeBtn.style.background = `rgba(${this.hexToRgb(theme.bg)}, 0.9)`;
                humanizeBtn.style.color = theme.text;
                humanizeBtn.style.borderColor = theme.border;
            }
        }
        
        // Update reveal history button
        const revealHistoryBtn = this.overlay.querySelector('.reveal-history-btn');
        if (revealHistoryBtn) {
            if (isWhite) {
                revealHistoryBtn.style.background = 'rgba(255, 255, 255, 0.95)';
                revealHistoryBtn.style.color = '#000000';
                revealHistoryBtn.style.borderColor = 'rgba(0, 0, 0, 0.2)';
            } else if (color === 'pink' || color === '#ec4899') {
                revealHistoryBtn.style.background = 'rgba(236, 72, 153, 0.9)';
                revealHistoryBtn.style.color = '#ffffff';
                revealHistoryBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            } else if (color === 'blue' || color === '#4A9EFF') {
                revealHistoryBtn.style.background = 'rgba(74, 158, 255, 0.9)';
                revealHistoryBtn.style.color = '#ffffff';
                revealHistoryBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            } else {
                revealHistoryBtn.style.background = `rgba(${this.hexToRgb(theme.bg)}, 0.9)`;
                revealHistoryBtn.style.color = theme.text;
                revealHistoryBtn.style.borderColor = theme.border;
            }
        }
        
        // Save to localStorage
        localStorage.setItem('jarvis-overlay-color', color);
    }
    
    reapplyButtonColors() {
        // Reapply button colors based on current color theme
        const color = this.currentColor || localStorage.getItem('jarvis-overlay-color') || 'black';
        const isWhite = color === 'white' || color === '#ffffff';
        
        // Update Answer Screen button
        const answerBtn = this.overlay?.querySelector('.answer-this-btn');
        const answerBtnMoved = document.getElementById('answer-this-btn-moved');
        
        [answerBtn, answerBtnMoved].forEach(btn => {
            if (btn) {
                if (isWhite) {
                    btn.style.background = 'rgba(255, 255, 255, 0.95)';
                    btn.style.color = '#000000';
                    btn.style.borderColor = 'rgba(0, 0, 0, 0.2)';
                } else if (color === 'pink' || color === '#ec4899') {
                    btn.style.background = 'rgba(236, 72, 153, 0.9)';
                    btn.style.color = '#ffffff';
                    btn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                } else if (color === 'blue' || color === '#4A9EFF') {
                    btn.style.background = 'rgba(74, 158, 255, 0.9)';
                    btn.style.color = '#ffffff';
                    btn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                } else {
                    // Black/default theme
                    btn.style.background = 'rgba(0, 0, 0, 0.9)';
                    btn.style.color = '#ffffff';
                    btn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                }
            }
        });
        
        // Update Humanize button
        const humanizeBtn = this.overlay?.querySelector('.humanize-btn');
        if (humanizeBtn) {
            if (isWhite) {
                humanizeBtn.style.background = 'rgba(255, 255, 255, 0.95)';
                humanizeBtn.style.color = '#000000';
                humanizeBtn.style.borderColor = 'rgba(0, 0, 0, 0.2)';
            } else if (color === 'pink' || color === '#ec4899') {
                humanizeBtn.style.background = 'rgba(236, 72, 153, 0.9)';
                humanizeBtn.style.color = '#ffffff';
                humanizeBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            } else if (color === 'blue' || color === '#4A9EFF') {
                humanizeBtn.style.background = 'rgba(74, 158, 255, 0.9)';
                humanizeBtn.style.color = '#ffffff';
                humanizeBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            } else {
                humanizeBtn.style.background = 'rgba(0, 0, 0, 0.9)';
                humanizeBtn.style.color = '#ffffff';
                humanizeBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            }
        }
        
        // Update reveal history button
        const revealHistoryBtn = this.overlay?.querySelector('.reveal-history-btn');
        if (revealHistoryBtn) {
            if (isWhite) {
                revealHistoryBtn.style.background = 'rgba(255, 255, 255, 0.95)';
                revealHistoryBtn.style.color = '#000000';
                revealHistoryBtn.style.borderColor = 'rgba(0, 0, 0, 0.2)';
            } else if (color === 'pink' || color === '#ec4899') {
                revealHistoryBtn.style.background = 'rgba(236, 72, 153, 0.9)';
                revealHistoryBtn.style.color = '#ffffff';
                revealHistoryBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            } else if (color === 'blue' || color === '#4A9EFF') {
                revealHistoryBtn.style.background = 'rgba(74, 158, 255, 0.9)';
                revealHistoryBtn.style.color = '#ffffff';
                revealHistoryBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            } else {
                revealHistoryBtn.style.background = 'rgba(0, 0, 0, 0.9)';
                revealHistoryBtn.style.color = '#ffffff';
                revealHistoryBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            }
        }
    }
    
    hexToRgb(hex) {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '255, 255, 255';
    }

    selectModel(model, modelName) {
        console.log(`🤖 [MODEL SWITCHER] selectModel called: ${modelName} (${model})`);
        console.log(`🤖 [MODEL SWITCHER] Previous model: ${this.selectedModel} (${this.selectedModelName})`);
        console.log(`🤖 [MODEL SWITCHER] Has premium: ${this.hasPremiumAccess()}`);
        console.log(`🤖 [MODEL SWITCHER] OpenRouter API key present: ${!!this.openrouterApiKey}`);
        
        // Free users can only use the default Jarvis model (with Low/High toggle)
        // Block selection of any other model
        if (model !== 'default' && !this.hasPremiumAccess()) {
            this.showNotification('🔒 This model requires Jarvis Premium. Upgrade to access all AI models!', false);
            this.showUpgradePrompt();
            return;
        }
        
        // If selecting a non-low model, clear the forced low model mode
        if (model !== 'jarvis-low') {
            this.isLowModelMode = false;
        }
        
        this.selectedModel = model;
        this.selectedModelName = modelName;
        
        // Update tier toggle UI
        this.updateTierToggleUI();
        
        // Update the display in the hamburger menu
        if (this.currentModelDisplay) {
            this.currentModelDisplay.textContent = modelName;
            console.log(`🤖 [MODEL SWITCHER] Updated display to: ${modelName}`);
        } else {
            console.warn(`🤖 [MODEL SWITCHER] currentModelDisplay element not found!`);
        }
        
        // Update active state
        if (this.modelSubmenu) {
            const modelItems = this.modelSubmenu.querySelectorAll('.model-item');
            modelItems.forEach(item => {
                if (item.getAttribute('data-model') === model) {
                    item.classList.add('active');
                } else {
                    item.classList.remove('active');
                }
            });
        }
        
        // Hide voice button and reset freaky/voice mode when switching away from Grok
        if (model !== 'x-ai/grok-4.1-fast') {
            const voiceBtn = document.getElementById('grok-voice-btn');
            const voiceSelectBtn = document.getElementById('voice-select-btn');
            const freakyCheckbox = document.getElementById('freaky-toggle-checkbox');
            const freakyEmoji = document.getElementById('freaky-emoji');
            if (voiceBtn) {
                voiceBtn.classList.add('hidden');
                voiceBtn.classList.remove('active');
            }
            if (voiceSelectBtn) {
                voiceSelectBtn.classList.add('hidden');
            }
            if (freakyCheckbox) {
                freakyCheckbox.checked = false;
            }
            if (freakyEmoji) {
                freakyEmoji.textContent = '😇';
            }
            this.grokFreakyMode = false;
            this.grokVoiceMode = false;
        }
        
        console.log(`🤖 [MODEL SWITCHER] Successfully switched to ${modelName} (${model})`);
    }

    clearChatHistory() {
        // Clear conversation history
        this.conversationHistory = [];
        
        // Clear from localStorage
        try {
            localStorage.removeItem('jarvis_conversation_history');
        } catch (e) {
            console.error('Failed to clear conversation history from localStorage:', e);
        }
        
        // Clear the messages container
        if (this.messagesContainer) {
            this.messagesContainer.innerHTML = '';
            this.messagesContainer.classList.add('hidden');
        }
        
        // Hide reveal history button
        if (this.revealHistoryBtn) {
            this.revealHistoryBtn.classList.add('hidden');
            this.revealHistoryBtn.classList.remove('rotated');
        }
        
        // Clear the drag output if it's visible
        if (this.dragOutput) {
            this.dragOutput.innerHTML = '';
            this.dragOutput.classList.add('hidden');
        }
        
        // Hide settings menu
        this.hideSettingsMenu();
        
        // Show confirmation
        this.showNotification('Chat history cleared! 🗑️', true);
    }
    
    toggleChatHistory() {
        if (!this.revealHistoryBtn || !this.messagesContainer) return;
        
        const previousMessages = this.messagesContainer.querySelectorAll('.drag-output:not(#drag-output)');
        if (previousMessages.length === 0) return;
        
        // Toggle the rotated class for visual feedback
        const isExpanded = this.revealHistoryBtn.classList.contains('rotated');
        
        if (isExpanded) {
            // Collapse: hide previous messages only (keep current output visible)
            this.revealHistoryBtn.classList.remove('rotated');
            
            // Hide all previous messages (not the current output)
            previousMessages.forEach(msg => {
                msg.style.display = 'none';
            });
            
            // Reset container to just show current message
            const currentMessage = this.messagesContainer.querySelector('#drag-output');
            if (currentMessage) {
                // Ensure current message stays visible
                currentMessage.style.opacity = '1';
                currentMessage.style.pointerEvents = 'auto';
                currentMessage.style.height = 'auto';
                currentMessage.style.overflow = 'visible';
                currentMessage.style.margin = '';
                currentMessage.style.padding = '';
                
                const currentHeight = currentMessage.offsetHeight;
                const padding = 0.5 * 16;
                this.messagesContainer.style.height = `${currentHeight + padding}px`;
                this.messagesContainer.style.overflowY = 'hidden';
            }
        } else {
            // Expand: reveal all previous messages
            this.revealHistoryBtn.classList.add('rotated');
            
            // Show all previous messages
            previousMessages.forEach(msg => {
                msg.style.display = 'block';
                msg.style.opacity = '1';
                msg.style.pointerEvents = 'auto';
            });
            
            // Expand container to show all messages with scrolling
            this.messagesContainer.style.height = '400px'; // Max height
            this.messagesContainer.style.maxHeight = '400px';
            this.messagesContainer.style.overflowY = 'auto';
            
            // Scroll to bottom to show current message
            requestAnimationFrame(() => {
                this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
            });
        }
    }

    showAccountModal() {
        if (this.accountModal) {
            this.updateAccountInfo();
            this.updateGoogleServicesStatus();
            this.accountModal.classList.remove('hidden');
            this.hideSettingsMenu();
        }
    }

    hideAccountModal() {
        if (this.accountModal) {
            this.accountModal.classList.add('hidden');
        }
    }
    
    toggleStealthMode(enabled, showNotification = true) {
        if (!this.isElectron || !window.require) {
            console.warn('Stealth mode toggle: Not in Electron environment');
            return;
        }
        
        // Update stealth mode state
        this.stealthModeEnabled = enabled;
        
        // Apply CSS to disable click sounds when stealth mode is enabled
        this.applyStealthModeStyles(enabled);
        
        try {
            const { ipcRenderer } = window.require('electron');
            console.log(`🔄 Calling IPC to toggle stealth mode to: ${enabled}`);
            ipcRenderer.invoke('toggle-stealth-mode', enabled).then((success) => {
                console.log(`✅ Stealth mode IPC result: ${success}, enabled: ${enabled}`);
                if (success && showNotification) {
                    const message = enabled ? 'Stealth Mode: ON 🥷 (Hidden from screen share, sounds disabled)' : 'Stealth Mode: OFF 👁️ (Visible in screen share)';
                    this.showNotification(message, true);
                } else if (!success) {
                    console.error('❌ IPC returned false');
                    if (showNotification) {
                        this.showNotification('Failed to toggle stealth mode', false);
                    }
                }
            }).catch((error) => {
                console.error('❌ IPC call failed:', error);
                if (showNotification) {
                    this.showNotification('Failed to toggle stealth mode: ' + error.message, false);
                }
            });
        } catch (error) {
            console.error('❌ Error in toggleStealthMode:', error);
            if (showNotification) {
                this.showNotification('Error toggling stealth mode: ' + error.message, false);
            }
        }
    }
    
    applyStealthModeStyles(enabled) {
        // Add or remove CSS to disable click sounds and visual feedback
        const styleId = 'stealth-mode-styles';
        let styleElement = document.getElementById(styleId);
        
        if (enabled) {
            // Create style element to disable sounds and reduce click feedback
            if (!styleElement) {
                styleElement = document.createElement('style');
                styleElement.id = styleId;
                document.head.appendChild(styleElement);
            }
            
            styleElement.textContent = `
                /* Disable system click sounds and reduce visual feedback in stealth mode */
                button, .file-btn, .settings-btn, .model-item, .settings-item, 
                .drag-handle, .answer-this-btn, .humanize-btn, .close-output-floating {
                    -webkit-tap-highlight-color: transparent !important;
                    tap-highlight-color: transparent !important;
                    outline: none !important;
                }
                
                /* Prevent audio playback */
                audio {
                    display: none !important;
                }
            `;
            
            // Override Audio constructor to prevent sound playback in stealth mode
            if (!window._originalAudio) {
                window._originalAudio = window.Audio;
                window.Audio = function(...args) {
                    const audio = new window._originalAudio(...args);
                    const originalPlay = audio.play.bind(audio);
                    audio.play = function() {
                        console.log('🔇 Audio playback blocked in stealth mode');
                        return Promise.resolve(); // Return resolved promise to prevent errors
                    };
                    return audio;
                };
            }
            
            // Disable system beep/alert sounds via Electron IPC if available
            if (this.isElectron && window.require) {
                try {
                    const { ipcRenderer } = window.require('electron');
                    ipcRenderer.invoke('disable-system-sounds', true).catch(() => {
                        // Ignore if IPC handler doesn't exist
                    });
                } catch (e) {
                    // Ignore errors
                }
            }
        } else {
            // Remove stealth mode styles
            if (styleElement) {
                styleElement.remove();
            }
            
            // Restore original Audio constructor
            if (window._originalAudio) {
                window.Audio = window._originalAudio;
                delete window._originalAudio;
            }
            
            // Re-enable system sounds
            if (this.isElectron && window.require) {
                try {
                    const { ipcRenderer } = window.require('electron');
                    ipcRenderer.invoke('disable-system-sounds', false).catch(() => {
                        // Ignore if IPC handler doesn't exist
                    });
                } catch (e) {
                    // Ignore errors
                }
            }
        }
    }

    showAccountWindow() {
        if (this.isElectron && window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.invoke('open-account-window');
        }
    }
    
    showHotkeysWindow() {
        if (this.isElectron && window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.invoke('open-hotkeys-window');
        }
    }

    async handleSelectedFiles(files) {
        try {
            const newAttachments = [];
            for (const file of files) {
                const pf = await this.processFile(file);
                if (pf) newAttachments.push(pf);
            }
            if (newAttachments.length === 0) {
                this.showNotification('No supported files found. Please select images, PDFs, or text files.', false);
                return;
            }
            // Add to pending and show bar
            this.pendingAttachments.push(...newAttachments);
            this.renderAttachmentsBar();
            this.showNotification(`Attached ${newAttachments.length} file${newAttachments.length>1?'s':''}. Type a message and press Send.`, false);
        } catch (error) {
            console.error('Add file error:', error);
            this.showNotification(`Error processing files: ${error.message}`, false);
        }
    }

    renderAttachmentsBar() {
        if (!this.attachmentsBar) return;
        // Clear
        this.attachmentsBar.innerHTML = '';
        if (!this.pendingAttachments || this.pendingAttachments.length === 0) {
            this.attachmentsBar.classList.add('hidden');
            return;
        }
        this.attachmentsBar.classList.remove('hidden');
        // Render minimal chips (square with X)
        this.pendingAttachments.forEach((att, idx) => {
            const chip = document.createElement('div');
            chip.className = 'attachment-chip';
            chip.title = (att && att.name) ? att.name : 'attachment';
            // Click chip to open if previewable
            if ((att.type === 'pdf' && att.url) || (att.type === 'image' && att.data && att.data.startsWith('data:image/'))) {
                chip.addEventListener('click', () => {
                    try {
                        const openUrl = att.type === 'image' ? att.data : att.url;
                        if (openUrl) window.open(openUrl, '_blank');
                    } catch (_) {}
                });
            }
            const remove = document.createElement('button');
            remove.className = 'attachment-remove';
            remove.textContent = '×';
            remove.title = 'Remove';
            remove.addEventListener('click', (e) => {
                e.stopPropagation();
                const removed = this.pendingAttachments.splice(idx, 1)[0];
                if (removed && removed._blobUrl) {
                    try { URL.revokeObjectURL(removed._blobUrl); } catch (_) {}
                }
                this.renderAttachmentsBar();
            });
            chip.appendChild(remove);
            this.attachmentsBar.appendChild(chip);
        });
    }

    async processFile(file) {
        const fileType = file.type || '';
        const fileName = file.name || 'file';
        const fileExtension = (fileName.split('.').pop() || '').toLowerCase();

        // Treat common image extensions as images even if type is missing
        const imageExts = ['png','jpg','jpeg','gif','bmp','webp','tif','tiff','heic','heif'];
        if (fileType.startsWith('image/') || imageExts.includes(fileExtension)) {
            return await this.processImageFile(file);
        }

        if (fileType === 'application/pdf' || fileExtension === 'pdf') {
            return await this.processPDFFile(file);
        }

        // Read as text if likely text
        const textExts = ['txt','md','json','csv','xml','html','css','js','ts','jsx','tsx','log'];
        if (fileType.startsWith('text/') || textExts.includes(fileExtension)) {
            return await this.processTextFile(file);
        }

        // Best-effort: try to read as text for unknown small files (<1MB)
        if (file.size <= 1024 * 1024) {
            try { return await this.processTextFile(file); } catch (_) {}
        }

        // Unsupported binary for direct analysis; include as filename reference only
        return { type: 'unknown', name: fileName, mimeType: fileType };
    }

    async processImageFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                resolve({ type: 'image', name: file.name, data: e.target.result, mimeType: file.type });
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    async processTextFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                resolve({ type: 'text', name: file.name, content: e.target.result, mimeType: file.type });
            };
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    async processPDFFile(file) {
        // Create a blob URL so we can open the PDF for viewing and try to extract text with pdf.js
        try {
            const url = URL.createObjectURL(file);
            let content = null;
            try {
                const arrayBuffer = await file.arrayBuffer();
                content = await this.extractTextFromPdfArrayBuffer(arrayBuffer);
            } catch (_) {}
            return { type: 'pdf', name: file.name, url, mimeType: file.type, _blobUrl: url, content };
        } catch (_) {
            // Fallback if blob URL creation fails
            let content = null;
            try {
                const arrayBuffer = await file.arrayBuffer();
                content = await this.extractTextFromPdfArrayBuffer(arrayBuffer);
            } catch (_) {}
            return { type: 'pdf', name: file.name, mimeType: file.type, content };
        }
    }

    async loadPdfJs() {
        if (window.pdfjsLib) return;
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
            script.async = true;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
        try {
            // Set worker source for pdf.js
            if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            }
        } catch (_) {}
    }

    async extractTextFromPdfArrayBuffer(arrayBuffer) {
        try {
            await this.loadPdfJs();
            if (!window.pdfjsLib) throw new Error('pdf.js not available');
            const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const maxPages = Math.min(pdf.numPages || 1, 20); // cap pages to avoid huge texts
            let text = '';
            for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
                const page = await pdf.getPage(pageNum);
                const content = await page.getTextContent();
                const pageText = content.items.map(it => it.str).join(' ').replace(/\s+/g, ' ').trim();
                if (pageText) {
                    text += (text ? '\n\n' : '') + pageText;
                }
                // Hard cap to avoid enormous payloads
                if (text.length > 20000) break;
            }
            // Trim to a safe length for prompt inclusion
            if (text.length > 20000) text = text.slice(0, 20000) + '\n...';
            return text || null;
        } catch (_) {
            return null;
        }
    }

    async processDocumentFile(file) {
        // Best-effort: try reading as text
        try {
            return await this.processTextFile(file);
        } catch (_) {
            return null;
        }
    }

    async analyzeFilesWithChatGPT(files, prompt) {
        try {
            // Re-check subscription status before processing (in case it was cancelled or activated)
            await this.checkLicense();
            
            // Clear any existing "message limit reached" notification if user now has premium
            if (this.hasPremiumAccess() && this.dragOutput && !this.dragOutput.classList.contains('hidden')) {
                const currentContent = this.dragOutput.innerHTML || '';
                if (currentContent.includes('Message Limit Reached') || currentContent.includes('message limit')) {
                    this.dragOutput.classList.add('hidden');
                }
            }
            
            // Check message limit for free users
            // Block if premium or subscription just activated
            const shouldBlockLimit = this.hasPremiumAccess() || 
                                    (this.subscriptionJustActivated && this.subscriptionActivatedTime && (Date.now() - this.subscriptionActivatedTime < 30000));
            
            if (!shouldBlockLimit && this.hasReachedMessageLimit()) {
                // Final check before showing
                if (this.hasPremiumAccess() || this.subscriptionJustActivated) {
                    console.log('🚫 Blocked in analyzeFilesWithChatGPT - premium detected');
                    return;
                }
                this.showMessageLimitReached();
                return;
            }

            const fileNames = files.map(f => f.name).join(', ');
            const displayFiles = fileNames.length > 50 ? fileNames.substring(0, 50) + '...' : fileNames;
            this.showNotification(`📄 Analyzing ${files.length} file${files.length > 1 ? 's' : ''}: ${displayFiles}`, false);
            this.showNotification('🧠 Processing file content with AI...', false);
            const content = [];
            let userPrompt = prompt;
            if (files.length === 1) {
                userPrompt += `\n\nFile: ${files[0].name}`;
            } else {
                userPrompt += `\n\nFiles (${files.length}): ${files.map(f => f.name).join(', ')}`;
            }
            content.push({ type: 'input_text', text: userPrompt });
            for (const file of files) {
                if (file.type === 'image') {
                    content.push({ type: 'input_image', image_url: file.data });
                } else if (file.type === 'text') {
                    content.push({ type: 'input_text', text: `\n\n--- Content of ${file.name} ---\n${file.content}` });
                } else if (file.type === 'pdf') {
                    if (file.content && typeof file.content === 'string' && file.content.trim().length > 0) {
                        content.push({ type: 'input_text', text: `\n\n--- Extracted text from PDF: ${file.name} ---\n${file.content}` });
                    } else {
                        // Reference the PDF so the model knows what was attached
                        content.push({ type: 'input_text', text: `\n\n[PDF attached (not rendered): ${file.name}]` });
                    }
                } else if (file.type === 'unknown') {
                    content.push({ type: 'input_text', text: `\n\n[Attachment: ${file.name} (${file.mimeType || 'unknown type'})]` });
                }
            }
            let analysis;
            
            // If using OpenRouter model, send to OpenRouter with file attachments
            if (this.selectedModel && this.selectedModel !== 'default') {
                // Check if this is a Claude model - route to Claude API directly
                if (this.selectedModel.startsWith('anthropic/claude-')) {
                    console.log(`🤖 Detected Claude model for file analysis: ${this.selectedModel}`);
                    
                    // Check if this is a quiz request
                    const lowerPrompt = prompt.toLowerCase();
                    const isQuizRequest = lowerPrompt.includes('quiz') || lowerPrompt.includes('test me') || 
                                         lowerPrompt.includes('question') || lowerPrompt.includes('practice');
                    
                    // Combine all file content into a single message
                    let combinedMessage = prompt;
                    if (isQuizRequest) {
                        combinedMessage = `IMPORTANT: You MUST respond with ONLY a JSON object for this quiz request. No other text before or after.

The user wants a QUIZ based on this content. Respond with ONLY this JSON format:
{"quiz": true, "topic": "Topic Name", "questions": [{"question": "Q1", "options": ["A", "B", "C", "D"], "correct_index": 0, "explanation": "Why"}]}

Generate 5 questions (or the number they specified) based on the following content:

User request: ${prompt}`;
                    }
                    
                    for (const item of content) {
                        if (item.type === 'input_text') {
                            combinedMessage += '\n\n' + item.text;
                        }
                        // Note: Claude API image support would need base64 encoding
                    }
                    
                    const claudeResponse = await this.callClaudeDirect(combinedMessage, this.selectedModel);
                    
                    // Check if Claude response contains quiz JSON
                    if (isQuizRequest) {
                        try {
                            const quizMatch = claudeResponse.match(/\{[\s\S]*"quiz"\s*:\s*true[\s\S]*\}/);
                            if (quizMatch) {
                                const quizData = JSON.parse(quizMatch[0]);
                                if (quizData.quiz && quizData.questions && quizData.questions.length > 0) {
                                    console.log('📝 Quiz detected in Claude response!');
                                    this.stopLoadingAnimation();
                                    if (this.dragOutput) {
                                        this.dragOutput.classList.remove('loading-notification');
                                    }
                                    this.showQuiz(quizData.topic || 'Document Quiz', quizData.questions);
                                    const userMessage = `${prompt} [Attached ${files.length} file(s): ${files.map(f => f.name).join(', ')}]`;
                                    this.conversationHistory.push({ role: 'user', content: userMessage });
                                    this.conversationHistory.push({ role: 'assistant', content: `Created quiz: ${quizData.topic} with ${quizData.questions.length} questions`, model: this.selectedModelName || 'Claude' });
                                    if (this.conversationHistory.length > 30) this.conversationHistory = this.conversationHistory.slice(-30);
                                    this.saveConversationHistory();
                                    if (!this.hasPremiumAccess()) this.incrementMessageCount();
                                    return; // Exit early - quiz is displayed
                                }
                            }
                        } catch (parseError) {
                            console.log('No quiz JSON found in Claude response, treating as regular analysis');
                        }
                    }
                    
                    analysis = claudeResponse;
                } else {
                    // Check if this is a quiz request
                    const lowerPrompt = prompt.toLowerCase();
                    const isQuizRequest = lowerPrompt.includes('quiz') || lowerPrompt.includes('test me') || 
                                         lowerPrompt.includes('question') || lowerPrompt.includes('practice');
                    
                    // Build message for OpenRouter chat format
                    let systemContent = 'Analyze the provided files and respond to the user succinctly and clearly.';
                    if (isQuizRequest) {
                        systemContent = `The user wants a QUIZ based on the attached file content. You MUST respond with ONLY a JSON object in this exact format (no other text): {"quiz": true, "topic": "Topic Name", "questions": [{"question": "Q1", "options": ["A", "B", "C", "D"], "correct_index": 0, "explanation": "Why"}]}. Generate questions based on the file content. Default to 5 questions unless user specifies a different number.`;
                    }
                    const messages = [
                        { role: 'system', content: systemContent }
                    ];
                    
                    // Convert content to OpenRouter format
                    let textParts = [];
                    let imageUrls = [];
                    for (const item of content) {
                        if (item.type === 'input_text') {
                            textParts.push(item.text);
                        } else if (item.type === 'input_image') {
                            imageUrls.push(item.image_url);
                        }
                    }
                    
                    // Build user message with text and images
                    if (imageUrls.length > 0) {
                        const userContent = [
                            { type: 'text', text: textParts.join('\n') }
                        ];
                        imageUrls.forEach(url => {
                            userContent.push({ type: 'image_url', image_url: { url } });
                        });
                        messages.push({ role: 'user', content: userContent });
                    } else {
                        messages.push({ role: 'user', content: textParts.join('\n') });
                    }
                    
                    // Always use Edge Function - no direct API keys allowed
                    if (!this.apiProxyUrl || !this.supabaseAnonKey) {
                        throw new Error('Supabase Edge Function not available. API keys must be stored in Supabase Edge Function Secrets.');
                    }
                    
                    const response = await fetch(this.apiProxyUrl, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${this.supabaseAnonKey}`,
                            'Content-Type': 'application/json',
                            'apikey': this.supabaseAnonKey
                        },
                        body: JSON.stringify({
                            provider: 'openrouter',
                            endpoint: 'chat/completions',
                            payload: {
                                model: this.selectedModel,
                                messages: messages
                            }
                        })
                    });
                    
                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
                    }
                    
                    const data = await response.json();
                    const responseContent = data.choices[0].message.content;
                    
                    // Check if response contains quiz JSON
                    try {
                        const quizMatch = responseContent.match(/\{[\s\S]*"quiz"\s*:\s*true[\s\S]*\}/);
                        if (quizMatch) {
                            const quizData = JSON.parse(quizMatch[0]);
                            if (quizData.quiz && quizData.questions && quizData.questions.length > 0) {
                                console.log('📝 Quiz detected in OpenRouter response!');
                                this.stopLoadingAnimation();
                                if (this.dragOutput) {
                                    this.dragOutput.classList.remove('loading-notification');
                                }
                                this.showQuiz(quizData.topic || 'Document Quiz', quizData.questions);
                                // Save to history
                                const userMessage = `${prompt} [Attached ${files.length} file(s): ${files.map(f => f.name).join(', ')}]`;
                                this.conversationHistory.push({ role: 'user', content: userMessage });
                                this.conversationHistory.push({ role: 'assistant', content: `Created quiz: ${quizData.topic} with ${quizData.questions.length} questions`, model: this.selectedModelName || 'AI' });
                                if (this.conversationHistory.length > 30) this.conversationHistory = this.conversationHistory.slice(-30);
                                this.saveConversationHistory();
                                if (!this.hasPremiumAccess()) this.incrementMessageCount();
                                return; // Exit early - quiz is displayed
                            }
                        }
                    } catch (parseError) {
                        console.log('No quiz JSON found in response, treating as regular analysis');
                    }
                    
                    analysis = responseContent;
                }
            } else {
                // Use default Jarvis model (GPT-5 Mini via IPC or proxy)
                // Check if this is a quiz request
                const lowerPrompt = prompt.toLowerCase();
                const isQuizRequest = lowerPrompt.includes('quiz') || lowerPrompt.includes('test me') || 
                                     lowerPrompt.includes('question') || lowerPrompt.includes('practice');
                
                // Include strong quiz instructions if quiz-related words detected
                let instructions = 'Analyze the provided files and respond to the user succinctly and clearly.';
                if (isQuizRequest) {
                    instructions = `The user wants a QUIZ based on the attached file content. You MUST use the create_quiz tool immediately to create an interactive quiz. Do NOT write out questions as text - ONLY use the create_quiz tool. Generate questions based on the file content. Default to 5 questions unless user specifies a different number.`;
                }
                
                const requestPayload = {
                    model: this.currentModel,
                    instructions: instructions,
                    input: [{ role: 'user', content }],
                    tools: this.tools // Include tools for quiz functionality
                };
                
                let response;
                let apiData = null;
                // Try IPC first (most reliable in Electron)
                if (this.isElectron && window.require) {
                    try {
                        const { ipcRenderer } = window.require('electron');
                        console.log('🔒 Using IPC to main process for file analysis');
                        const result = await ipcRenderer.invoke('call-openai-api', requestPayload);
                        
                        if (result && result.ok && result.data) {
                            console.log('✅ Main process file analysis succeeded');
                            apiData = result.data;
                        } else {
                            // Check if it's a limit exceeded error
                            if (result?.status === 429 && result?.data?.costLimitDollars !== undefined) {
                                console.error('🚫 File analysis blocked - limit exceeded');
                                this.showLimitExceededNotification();
                                throw new Error('LIMIT_EXCEEDED');
                            }
                            throw new Error(`IPC call failed: ${JSON.stringify(result)}`);
                        }
                    } catch (ipcError) {
                        if (ipcError.message === 'LIMIT_EXCEEDED') {
                            return "⚠️ Switched to Jarvis Low. Add credits for other models.";
                        }
                        console.error('❌ IPC file analysis failed, falling back to proxy:', ipcError);
                        response = null;
                    }
                }
                
                // Fallback to API proxy if IPC didn't work
                if (!apiData && !response) {
                    if (this.apiProxyUrl && this.supabaseAnonKey) {
                        console.log('🔒 Using Supabase proxy for file analysis');
                        response = await fetch(this.apiProxyUrl, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Bearer ${this.supabaseAnonKey}`,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                provider: 'openai',
                                endpoint: 'responses',
                                payload: requestPayload
                            })
                        });
                        
                        if (!response.ok) {
                            const errorData = await response.json().catch(() => ({}));
                            throw new Error(errorData.error?.message || `API error: ${response.status}`);
                        }
                        apiData = await response.json();
                    } else {
                        throw new Error('No API access method available. Please ensure the app is properly configured.');
                    }
                }
                
                // Check for tool calls (especially create_quiz)
                if (apiData) {
                    const toolCalls = (apiData.output || []).filter(item => item.type === 'function_call');
                    const quizCall = toolCalls.find(tc => tc.name === 'create_quiz');
                    
                    if (quizCall) {
                        console.log('📝 Quiz tool called from file analysis!', quizCall);
                        try {
                            // Parse arguments if they're a string
                            let args = quizCall.arguments;
                            if (typeof args === 'string') {
                                args = JSON.parse(args);
                            }
                            const topic = args?.topic || 'Document Quiz';
                            const questions = args?.questions || [];
                            
                            if (questions.length > 0) {
                                this.stopLoadingAnimation();
                                if (this.dragOutput) {
                                    this.dragOutput.classList.remove('loading-notification');
                                }
                                this.showQuiz(topic, questions);
                                // Save to history
                                const userMessage = `${prompt} [Attached ${files.length} file(s): ${files.map(f => f.name).join(', ')}]`;
                                this.conversationHistory.push({ role: 'user', content: userMessage });
                                this.conversationHistory.push({ role: 'assistant', content: `Created quiz: ${topic} with ${questions.length} questions`, model: 'Jarvis' });
                                if (this.conversationHistory.length > 30) this.conversationHistory = this.conversationHistory.slice(-30);
                                this.saveConversationHistory();
                                if (!this.hasPremiumAccess()) this.incrementMessageCount();
                                return; // Exit early - quiz is displayed
                            } else {
                                // Quiz tool called but no questions - treat as regular response
                                console.log('📝 Quiz tool called but no questions generated');
                            }
                        } catch (quizError) {
                            console.error('📝 Error creating quiz:', quizError);
                        }
                    }
                    
                    // Extract text response - check if there's any text content
                    const textResponse = this.extractTextSafe(apiData);
                    if (textResponse) {
                        analysis = textResponse;
                    } else if (isQuizRequest && toolCalls.length > 0) {
                        // Quiz was requested but tool didn't work - try again by returning early
                        // This forces the user to see the loading finished without weird message
                        this.stopLoadingAnimation();
                        if (this.dragOutput) {
                            this.dragOutput.classList.remove('loading-notification');
                        }
                        this.showNotification('Quiz generation failed. Please try again.', false);
                        return;
                    } else if (toolCalls.length > 0) {
                        // Only tool calls, no text - this is an error case for non-quiz tools
                        analysis = 'File analysis complete. The AI processed your request.';
                    } else {
                        analysis = 'Unable to analyze files - no response from AI.';
                    }
                }
            }
            const userMessage = `${prompt} [Attached ${files.length} file(s): ${files.map(f => f.name).join(', ')}]`;
            this.conversationHistory.push({ role: 'user', content: userMessage });
            this.conversationHistory.push({ 
                role: 'assistant', 
                content: analysis,
                model: this.selectedModelName || 'Jarvis'
            });
            if (this.conversationHistory.length > 30) this.conversationHistory = this.conversationHistory.slice(-30);
            this.saveConversationHistory();
            if (!this.hasPremiumAccess()) this.incrementMessageCount();
            if (this.textInput) this.textInput.value = '';
            this.showNotification(analysis, true);
        } catch (error) {
            console.error('Error analyzing files:', error);
            this.showNotification(`Error analyzing files: ${error.message}`, false);
        }
    }


    async loadAccountInfo() {
        try {
            // Re-check subscription status before loading account info
            await this.checkLicense();
            
            if (this.isElectron && window.require) {
                const { ipcRenderer } = window.require('electron');
                const accountInfo = await ipcRenderer.invoke('get-account-info');
                this.updateAccountInfo(accountInfo);
            }
        } catch (error) {
            console.error('Failed to load account info:', error);
            this.updateAccountInfo({
                email: 'Not signed in',
                premiumStatus: 'Free'
            });
        }
    }

    updateAccountInfo(info) {
        // Get user email
        const userEmail = this.getUserEmail();
        if (this.userEmailElement) {
            this.userEmailElement.textContent = userEmail || 'Not signed in';
        }

        // Update premium status
        if (this.premiumStatusElement) {
            const isFreeAccess = this.checkFreeAccessStatus();
            const hasValidLicense = this.licenseStatus && this.licenseStatus.valid;
            
            if (isFreeAccess) {
                this.premiumStatusElement.textContent = 'Free Access (aaron2)';
                this.premiumStatusElement.style.color = '#4CAF50';
            } else if (hasValidLicense) {
                this.premiumStatusElement.textContent = 'Premium';
                this.premiumStatusElement.style.color = '#FFD700';
            } else {
                this.premiumStatusElement.textContent = 'Free';
                this.premiumStatusElement.style.color = '#888';
            }
        }

        // Update feature list
        if (this.featureListElement) {
            const isFreeAccess = this.checkFreeAccessStatus();
            const hasValidLicense = this.licenseStatus && this.licenseStatus.valid;
            const hasAccess = isFreeAccess || hasValidLicense;

            this.featureListElement.innerHTML = `
                <div class="feature-item">✅ Voice Recording</div>
                <div class="feature-item">✅ Screenshot Analysis</div>
                <div class="feature-item">✅ Web Search</div>
                <div class="feature-item">${hasAccess ? '✅' : '❌'} Document Processing</div>
                <div class="feature-item">${hasAccess ? '✅' : '❌'} Advanced AI Features</div>
                <div class="feature-item">${hasAccess ? '✅' : '❌'} Priority Support</div>
            `;
        }
    }

    checkFreeAccessStatus() {
        try {
            const freeAccess = localStorage.getItem('jarvis_free_access');
            return freeAccess === 'true';
        } catch (e) {
            return false;
        }
    }

    setupGoogleServices() {
        if (!this.isElectron || !window.require) return;

        const { ipcRenderer } = window.require('electron');

        // Docs
        const docsConnectBtn = document.getElementById('docs-connect-btn');
        const docsDisconnectBtn = document.getElementById('docs-disconnect-btn');
        if (docsConnectBtn) {
            docsConnectBtn.addEventListener('click', async () => {
                try {
                    const result = await ipcRenderer.invoke('google-docs-authenticate');
                    if (result.success) {
                        this.showNotification('✅ Connected to Google Docs!', true);
                        this.updateGoogleServicesStatus();
                    } else {
                        this.showNotification(`❌ Failed to connect: ${result.error || 'Unknown error'}`, false);
                    }
                } catch (error) {
                    this.showNotification(`❌ Error connecting to Google Docs: ${error.message}`, false);
                }
            });
        }
        if (docsDisconnectBtn) {
            docsDisconnectBtn.addEventListener('click', async () => {
                try {
                    const result = await ipcRenderer.invoke('google-docs-sign-out');
                    if (result.success) {
                        this.showNotification('✅ Disconnected from Google Docs', true);
                        this.updateGoogleServicesStatus();
                    } else {
                        this.showNotification(`❌ Failed to disconnect: ${result.error || 'Unknown error'}`, false);
                    }
                } catch (error) {
                    this.showNotification(`❌ Error disconnecting: ${error.message}`, false);
                }
            });
        }

        // Sheets (shares auth with Docs)
        const sheetsConnectBtn = document.getElementById('sheets-connect-btn');
        const sheetsDisconnectBtn = document.getElementById('sheets-disconnect-btn');
        if (sheetsConnectBtn) {
            sheetsConnectBtn.addEventListener('click', async () => {
                try {
                    const result = await ipcRenderer.invoke('google-docs-authenticate');
                    if (result.success) {
                        this.showNotification('✅ Connected to Google Sheets!', true);
                        this.updateGoogleServicesStatus();
                    } else {
                        this.showNotification(`❌ Failed to connect: ${result.error || 'Unknown error'}`, false);
                    }
                } catch (error) {
                    this.showNotification(`❌ Error connecting to Google Sheets: ${error.message}`, false);
                }
            });
        }
        if (sheetsDisconnectBtn) {
            sheetsDisconnectBtn.addEventListener('click', async () => {
                try {
                    const result = await ipcRenderer.invoke('google-docs-sign-out');
                    if (result.success) {
                        this.showNotification('✅ Disconnected from Google Sheets', true);
                        this.updateGoogleServicesStatus();
                    } else {
                        this.showNotification(`❌ Failed to disconnect: ${result.error || 'Unknown error'}`, false);
                    }
                } catch (error) {
                    this.showNotification(`❌ Error disconnecting: ${error.message}`, false);
                }
            });
        }

        // Drive (shares auth with Docs)
        const driveConnectBtn = document.getElementById('drive-connect-btn');
        const driveDisconnectBtn = document.getElementById('drive-disconnect-btn');
        if (driveConnectBtn) {
            driveConnectBtn.addEventListener('click', async () => {
                try {
                    const result = await ipcRenderer.invoke('google-docs-authenticate');
                    if (result.success) {
                        this.showNotification('✅ Connected to Google Drive!', true);
                        this.updateGoogleServicesStatus();
                    } else {
                        this.showNotification(`❌ Failed to connect: ${result.error || 'Unknown error'}`, false);
                    }
                } catch (error) {
                    this.showNotification(`❌ Error connecting to Google Drive: ${error.message}`, false);
                }
            });
        }
        if (driveDisconnectBtn) {
            driveDisconnectBtn.addEventListener('click', async () => {
                try {
                    const result = await ipcRenderer.invoke('google-docs-sign-out');
                    if (result.success) {
                        this.showNotification('✅ Disconnected from Google Drive', true);
                        this.updateGoogleServicesStatus();
                    } else {
                        this.showNotification(`❌ Failed to disconnect: ${result.error || 'Unknown error'}`, false);
                    }
                } catch (error) {
                    this.showNotification(`❌ Error disconnecting: ${error.message}`, false);
                }
            });
        }

        // Gmail
        const gmailConnectBtn = document.getElementById('gmail-connect-btn');
        const gmailDisconnectBtn = document.getElementById('gmail-disconnect-btn');
        if (gmailConnectBtn) {
            gmailConnectBtn.addEventListener('click', async () => {
                try {
                    const result = await ipcRenderer.invoke('gmail-authenticate');
                    if (result.success) {
                        this.showNotification('✅ Connected to Gmail!', true);
                        this.updateGoogleServicesStatus();
                    } else {
                        this.showNotification(`❌ Failed to connect: ${result.error || 'Unknown error'}`, false);
                    }
                } catch (error) {
                    this.showNotification(`❌ Error connecting to Gmail: ${error.message}`, false);
                }
            });
        }
        if (gmailDisconnectBtn) {
            gmailDisconnectBtn.addEventListener('click', async () => {
                try {
                    const result = await ipcRenderer.invoke('gmail-sign-out');
                    if (result.success) {
                        this.showNotification('✅ Disconnected from Gmail', true);
                        this.updateGoogleServicesStatus();
                    } else {
                        this.showNotification(`❌ Failed to disconnect: ${result.error || 'Unknown error'}`, false);
                    }
                } catch (error) {
                    this.showNotification(`❌ Error disconnecting: ${error.message}`, false);
                }
            });
        }

        // Calendar
        const calendarConnectBtn = document.getElementById('calendar-connect-btn');
        const calendarDisconnectBtn = document.getElementById('calendar-disconnect-btn');
        if (calendarConnectBtn) {
            calendarConnectBtn.addEventListener('click', async () => {
                try {
                    const result = await ipcRenderer.invoke('google-calendar-authenticate');
                    if (result.success) {
                        this.showNotification('✅ Connected to Google Calendar!', true);
                        this.updateGoogleServicesStatus();
                    } else {
                        this.showNotification(`❌ Failed to connect: ${result.error || 'Unknown error'}`, false);
                    }
                } catch (error) {
                    this.showNotification(`❌ Error connecting to Google Calendar: ${error.message}`, false);
                }
            });
        }
        if (calendarDisconnectBtn) {
            calendarDisconnectBtn.addEventListener('click', async () => {
                try {
                    const result = await ipcRenderer.invoke('google-calendar-sign-out');
                    if (result.success) {
                        this.showNotification('✅ Disconnected from Google Calendar', true);
                        this.updateGoogleServicesStatus();
                    } else {
                        this.showNotification(`❌ Failed to disconnect: ${result.error || 'Unknown error'}`, false);
                    }
                } catch (error) {
                    this.showNotification(`❌ Error disconnecting: ${error.message}`, false);
                }
            });
        }
    }

    async updateGoogleServicesStatus() {
        if (!this.isElectron || !window.require) return;

        const { ipcRenderer } = window.require('electron');

        try {
            // Check Docs status
            const docsStatus = await ipcRenderer.invoke('google-docs-auth-status');
            this.updateServiceStatus('docs', docsStatus.authenticated);

            // Check Drive/Sheets status (shares tokens with Docs)
            const driveStatus = await ipcRenderer.invoke('google-drive-auth-status');
            this.updateServiceStatus('drive', driveStatus.authenticated);
            this.updateServiceStatus('sheets', driveStatus.authenticated);

            // Check Gmail status
            const gmailStatus = await ipcRenderer.invoke('gmail-auth-status');
            this.updateServiceStatus('gmail', gmailStatus.authenticated);

            // Check Calendar status
            const calendarStatus = await ipcRenderer.invoke('google-calendar-auth-status');
            this.updateServiceStatus('calendar', calendarStatus.authenticated);
        } catch (error) {
            console.error('Error updating Google Services status:', error);
        }
    }

    updateServiceStatus(service, isConnected) {
        const statusElement = document.getElementById(`${service}-status`);
        const connectBtn = document.getElementById(`${service}-connect-btn`);
        const disconnectBtn = document.getElementById(`${service}-disconnect-btn`);

        if (statusElement) {
            statusElement.textContent = isConnected ? 'Connected' : 'Not connected';
            statusElement.style.color = isConnected ? '#4CAF50' : '#888';
        }

        if (connectBtn) {
            connectBtn.classList.toggle('hidden', isConnected);
        }

        if (disconnectBtn) {
            disconnectBtn.classList.toggle('hidden', !isConnected);
        }
    }

    togglePinkMode() {
        const minimalHud = document.querySelector('.minimal-hud');
        const dragOutput = document.getElementById('drag-output');
        const answerThisBtn = document.getElementById('answer-this-btn');
        
        // Toggle the pink mode state
        this.isPinkMode = !this.isPinkMode;
        
        if (this.isPinkMode) {
            // Change input area to pink
            minimalHud.style.background = 'rgba(255, 192, 203, 0.95)';
            
            // Change chat window to pink
            if (dragOutput) {
                dragOutput.style.background = 'rgba(255, 192, 203, 0.95)';
            }
            
            // Change Answer This button to pink
            if (answerThisBtn) {
                answerThisBtn.style.background = 'rgba(255, 192, 203, 0.95)';
            }
            
            this.addMessage('Jarvis', 'Pink mode activated! 💖', 'assistant');
        } else {
            // Change back to original colors
            minimalHud.style.background = 'rgba(0, 0, 0, 0.85)';
            
            if (dragOutput) {
                dragOutput.style.background = '';
            }
            
            if (answerThisBtn) {
                answerThisBtn.style.background = '';
            }
            
            this.addMessage('Jarvis', 'Pink mode deactivated! 🖤', 'assistant');
        }
    }

    toggleMoreModels() {
        const moreBtn = document.getElementById('model-more-btn');
        const moreSection = document.getElementById('more-models-section');
        
        if (moreBtn && moreSection) {
            const isExpanded = moreBtn.classList.toggle('expanded');
            moreSection.classList.toggle('hidden', !isExpanded);
            
            // Update button text
            moreBtn.querySelector('span').textContent = isExpanded ? 'Less models' : 'More models';
        }
    }

    toggleGrokFreakyMode(isFreaky = null) {
        const freakyCheckbox = document.getElementById('freaky-toggle-checkbox');
        const freakyEmoji = document.getElementById('freaky-emoji');
        const voiceBtn = document.getElementById('grok-voice-btn');
        const voiceSelectBtn = document.getElementById('voice-select-btn');
        
        // If isFreaky is provided, use it; otherwise toggle
        this.grokFreakyMode = isFreaky !== null ? isFreaky : !this.grokFreakyMode;
        
        // Update checkbox state
        if (freakyCheckbox) {
            freakyCheckbox.checked = this.grokFreakyMode;
        }
        
        // Update emoji
        if (freakyEmoji) {
            freakyEmoji.textContent = this.grokFreakyMode ? '😈' : '😇';
        }
        
        // Show/hide voice buttons based on freaky mode
        if (voiceBtn) {
            if (this.grokFreakyMode) {
                voiceBtn.classList.remove('hidden');
            } else {
                voiceBtn.classList.add('hidden');
                // Also disable voice mode when freaky mode is turned off
                this.grokVoiceMode = false;
                voiceBtn.classList.remove('active');
            }
        }
        
        // Show/hide voice select button based on freaky mode
        if (voiceSelectBtn) {
            if (this.grokFreakyMode) {
                voiceSelectBtn.classList.remove('hidden');
            } else {
                voiceSelectBtn.classList.add('hidden');
            }
        }
        
        // Select Grok model if not already selected
        if (this.selectedModel !== 'x-ai/grok-4.1-fast') {
            this.selectModel('x-ai/grok-4.1-fast', 'Grok 4.1 Fast');
        }
        
        // Send the freaky mode toggle message
        const message = this.grokFreakyMode ? 'turn on freaky mode' : 'turn off freaky mode';
        this.processMessage(message);
        
        // Hide the model submenu
        this.hideModelSubmenu();
    }
    
    toggleVoiceSelection() {
        const voiceSelectBtn = document.getElementById('voice-select-btn');
        this.useSecondVoice = !this.useSecondVoice;
        
        if (voiceSelectBtn) {
            if (this.useSecondVoice) {
                voiceSelectBtn.classList.add('voice-male');
                voiceSelectBtn.querySelector('.voice-icon').textContent = '♂';
                voiceSelectBtn.title = 'Switch to female voice';
            } else {
                voiceSelectBtn.classList.remove('voice-male');
                voiceSelectBtn.querySelector('.voice-icon').textContent = '♀';
                voiceSelectBtn.title = 'Switch to male voice';
            }
        }
    }
    
    toggleGrokVoiceMode() {
        const voiceBtn = document.getElementById('grok-voice-btn');
        this.grokVoiceMode = !this.grokVoiceMode;
        
        if (voiceBtn) {
            if (this.grokVoiceMode) {
                voiceBtn.classList.add('active');
            } else {
                voiceBtn.classList.remove('active');
            }
        }
    }
    
    async speakWithElevenLabs(text) {
        try {
            // Clean up the text - remove emojis and special characters for cleaner speech
            const cleanText = text.replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, '').trim();
            
            if (!cleanText) return;
            
            // Use selected voice
            const voiceId = this.useSecondVoice ? this.elevenLabsVoiceId2 : this.elevenLabsVoiceId;
            
            // Always use Edge Function - API keys stored in Supabase Secrets
            if (!this.apiProxyUrl || !this.supabaseAnonKey) {
                throw new Error('API keys must be stored in Supabase Edge Function Secrets.');
            }
            
            const response = await fetch(this.apiProxyUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.supabaseAnonKey}`,
                    'Content-Type': 'application/json',
                    'apikey': this.supabaseAnonKey
                },
                body: JSON.stringify({
                    provider: 'elevenlabs',
                    endpoint: `text-to-speech/${voiceId}`,
                    payload: {
                        text: cleanText,
                        model_id: 'eleven_turbo_v2_5',
                        voice_settings: {
                            stability: 0.5,
                            similarity_boost: 0.75,
                            style: 0.0,
                            use_speaker_boost: true
                        }
                    }
                })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('ElevenLabs API error:', response.status, errorText);
                return;
            }
            
            const audioBlob = await response.blob();
            console.log('🔊 Audio blob received, size:', audioBlob.size);
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);
            audio.volume = 1.0;
            await audio.play().catch(e => console.error('Audio play error:', e));
            
            // Clean up the URL after playing
            audio.onended = () => {
                URL.revokeObjectURL(audioUrl);
            };
        } catch (error) {
            console.error('ElevenLabs TTS error:', error);
        }
    }

    /**
     * Determines if a URL in a message should trigger document loading
     * Returns true only if the user clearly wants to load/read the document
     * Returns false if the URL is just part of a question or statement
     */
    shouldLoadDocumentFromUrl(message, url) {
        // Remove the URL from the message to analyze the remaining text
        const textWithoutUrl = message.replace(url, '').trim().toLowerCase();
        
        // Case 1: URL is the ONLY thing in the message (just pasted a link)
        if (textWithoutUrl.length === 0) {
            console.log('📄 URL is alone - will load document');
            return true;
        }
        
        // Case 2: Very short text with document-loading intent
        // Words/phrases that indicate user wants to load/read the document
        const loadIntentPatterns = [
            /^read\s*(this)?$/,
            /^load\s*(this)?$/,
            /^open\s*(this)?$/,
            /^extract\s*(this)?$/,
            /^summarize\s*(this)?$/,
            /^summary$/,
            /^analyze\s*(this)?$/,
            /^check\s*(this)?\s*(out)?$/,
            /^what('?s| is)\s*(this|in this|on this|here)(\?)?$/,
            /^tell me about\s*(this)?$/,
            /^what does (this|it) say(\?)?$/,
            /^can you (read|load|summarize|analyze)\s*(this)?(\?)?$/,
            /^please (read|load|summarize|analyze)\s*(this)?$/,
            /^(read|load|summarize|analyze) (this|the) (page|article|document|website|link|site)$/,
        ];
        
        for (const pattern of loadIntentPatterns) {
            if (pattern.test(textWithoutUrl)) {
                console.log('📄 Detected document loading intent - will load document');
                return true;
            }
        }
        
        // Case 3: Check if the text is very short (likely just "summarize" or similar)
        const words = textWithoutUrl.split(/\s+/).filter(w => w.length > 0);
        if (words.length <= 3) {
            // Short messages with certain keywords suggest document loading
            const loadKeywords = ['read', 'load', 'open', 'extract', 'summarize', 'summary', 'analyze', 'check', 'article', 'page', 'document'];
            if (words.some(word => loadKeywords.includes(word))) {
                console.log('📄 Short message with load keyword - will load document');
                return true;
            }
        }
        
        // Case 4: If text is longer or asks a specific question about the URL content
        // Don't auto-load - let the AI handle the message naturally
        // This handles cases like:
        // - "what is the price on https://..."
        // - "is https://... a good source?"
        // - "compare https://... with ..."
        console.log('📄 URL is part of a larger message - will NOT auto-load document');
        return false;
    }

    async extractAndProcessDocument(url, originalMessage) {
        try {
            this.isProcessingDocument = true;
            this.showDocumentProcessingIndicator();
            
            // Extract content using Exa API
            const document = await this.extractWebsiteContent(url);
            this.currentDocument = document;
            
            // Show success message
            this.addMessage('Jarvis', `📄 Document loaded: "${document.title}"\n\nI can now answer questions about this document. What would you like to know?`, 'assistant');
            
            // If there's a question in the original message, process it
            const question = originalMessage.replace(url, '').trim();
            if (question && question.length > 0) {
                await this.processDocumentQuestion(question);
            }
            
        } catch (error) {
            console.error('Failed to extract document:', error);
            this.addMessage('Jarvis', 'Sorry, I couldn\'t extract content from that website. Please try a different URL.', 'assistant');
        } finally {
            this.isProcessingDocument = false;
            this.hideDocumentProcessingIndicator();
        }
    }

    async extractWebsiteContent(url) {
        if (this.isElectron && window.require) {
            const { ipcRenderer } = window.require('electron');
            return await ipcRenderer.invoke('extract-website-content', url);
        } else {
            throw new Error('Exa API requires Electron environment');
        }
    }

    async processDocumentQuestion(question) {
        try {
            if (!this.currentDocument) {
                this.addMessage('Jarvis', 'No document is currently loaded. Please provide a URL first.', 'assistant');
                return;
            }

            this.showDocumentProcessingIndicator();
            
            // Create context with document content
            const documentContext = `DOCUMENT CONTEXT:
Title: ${this.currentDocument.title}
URL: ${this.currentDocument.url}
Content: ${this.currentDocument.content.substring(0, 4000)}...`;

            const response = await this.callChatGPTWithDocument(question, documentContext);
            this.addMessage('Jarvis', response, 'assistant');
            
            // Increment message count for free users
            if (!this.hasPremiumAccess()) {
                this.incrementMessageCount();
            }
            
        } catch (error) {
            console.error('Failed to process document question:', error);
            this.addMessage('Jarvis', 'Sorry, I couldn\'t process your question about the document.', 'assistant');
        } finally {
            this.hideDocumentProcessingIndicator();
        }
    }

    async callChatGPTWithDocument(question, documentContext) {
        try {
            const instructions = `You are Jarvis. Answer the user's question based on the provided document context. Answer directly without any preface, introduction, or phrases like "here's the answer" or "the answer is". Just provide the answer immediately. Be specific and cite relevant parts of the document when possible.

${documentContext}

User Question: ${question}`;

            // Always use Edge Function - API keys stored in Supabase Secrets
            if (!this.apiProxyUrl || !this.supabaseAnonKey) {
                throw new Error('API keys must be stored in Supabase Edge Function Secrets.');
            }
            
            const response = await fetch(this.apiProxyUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.supabaseAnonKey}`,
                    'Content-Type': 'application/json',
                    'apikey': this.supabaseAnonKey
                },
                body: JSON.stringify({
                    provider: 'openai',
                    endpoint: 'chat/completions',
                    payload: {
                        model: this.currentModel,
                        messages: [
                            { role: 'system', content: instructions },
                            { role: 'user', content: question }
                        ],
                        max_tokens: 1000,
                        temperature: 0.7
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`API request failed: ${response.status}`);
            }

            const data = await response.json();
            return data.choices[0].message.content;
        } catch (error) {
            console.error('ChatGPT API error:', error);
            throw error;
        }
    }

    showDocumentProcessingIndicator() {
        const indicator = document.createElement('div');
        indicator.id = 'document-processing-indicator';
        indicator.innerHTML = '📄 processing...';
        indicator.style.cssText = `
            position: fixed;
            top: 12px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.85);
            color: white;
            padding: 6px 14px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 600;
            z-index: 10000;
            animation: docPulse 1.5s infinite;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.15);
        `;
        document.body.appendChild(indicator);
    }

    hideDocumentProcessingIndicator() {
        const indicator = document.getElementById('document-processing-indicator');
        if (indicator) {
            indicator.remove();
        }
    }

    checkFreeAccess() {
        // Check if free access has been granted
        if (typeof Storage !== 'undefined') {
            const hasFreeAccess = localStorage.getItem('jarvis_free_access') === 'true';
            if (hasFreeAccess) {
                const savedFeatures = localStorage.getItem('jarvis_features');
                if (savedFeatures) {
                    this.features = JSON.parse(savedFeatures);
                }
            }
        }
    }

    loadMessageCount() {
        try {
            const count = localStorage.getItem('jarvis_message_count');
            return count ? parseInt(count) : 0;
        } catch (e) {
            console.error('Failed to load message count:', e);
            return 0;
        }
    }

    loadMessageResetTimestamp() {
        try {
            const timestamp = localStorage.getItem('jarvis_message_reset_timestamp');
            return timestamp ? parseInt(timestamp) : null;
        } catch (e) {
            console.error('Failed to load message reset timestamp:', e);
            return null;
        }
    }

    saveMessageResetTimestamp() {
        try {
            const timestamp = Date.now();
            localStorage.setItem('jarvis_message_reset_timestamp', timestamp.toString());
        } catch (e) {
            console.error('Failed to save message reset timestamp:', e);
        }
    }

    checkAndResetMessageCount() {
        try {
            // If user has premium, don't track messages
            if (this.hasPremiumAccess()) {
                return;
            }

            const resetTimestamp = this.loadMessageResetTimestamp();
            const now = Date.now();
            const twentyFourHours = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

            // If no timestamp exists, set it now and reset count
            if (!resetTimestamp) {
                this.messageCount = 0;
                this.saveMessageCount();
                this.saveMessageResetTimestamp();
                this.updateMessageCounter();
                return;
            }

            // If 24 hours have passed, reset the count
            if (now - resetTimestamp >= twentyFourHours) {
                this.messageCount = 0;
                this.saveMessageCount();
                this.saveMessageResetTimestamp();
                this.updateMessageCounter();
                console.log('Message count reset after 24 hours');
            }
        } catch (e) {
            console.error('Failed to check and reset message count:', e);
        }
    }

    saveMessageCount() {
        try {
            localStorage.setItem('jarvis_message_count', this.messageCount.toString());
        } catch (e) {
            console.error('Failed to save message count:', e);
        }
    }

    incrementMessageCount() {
        // Check if 24 hours have passed before incrementing
        this.checkAndResetMessageCount();
        
        this.messageCount++;
        this.saveMessageCount();
        this.updateMessageCounter();
        
        // Ensure timestamp is set if it doesn't exist
        if (!this.loadMessageResetTimestamp()) {
            this.saveMessageResetTimestamp();
        }
    }

    resetMessageCount() {
        this.messageCount = 0;
        this.saveMessageCount();
        this.saveMessageResetTimestamp();
        this.updateMessageCounter();
    }

    hasReachedMessageLimit() {
        // Premium users never hit message limit
        if (this.hasPremiumAccess()) {
            return false;
        }
        
        // Don't show limit if subscription was just activated (within last 30 seconds)
        if (this.subscriptionJustActivated && this.subscriptionActivatedTime) {
            const timeSinceActivation = Date.now() - this.subscriptionActivatedTime;
            if (timeSinceActivation < 30000) { // 30 seconds grace period
                console.log('⏱️ Subscription just activated, blocking message limit check');
                return false;
            } else {
                // Clear flag after grace period
                this.subscriptionJustActivated = false;
            }
        }
        
        return this.messageCount >= this.maxFreeMessages;
    }

    getRemainingMessages() {
        return Math.max(0, this.maxFreeMessages - this.messageCount);
    }

    // ============ Low Model (GPT-5 Mini) Tracking ============
    
    loadLowMessageCount() {
        try {
            const count = localStorage.getItem('jarvis_low_message_count');
            return count ? parseInt(count) : 0;
        } catch (e) {
            console.error('Failed to load low message count:', e);
            return 0;
        }
    }

    loadLowMessageResetTimestamp() {
        try {
            const timestamp = localStorage.getItem('jarvis_low_message_reset_timestamp');
            return timestamp ? parseInt(timestamp) : null;
        } catch (e) {
            console.error('Failed to load low message reset timestamp:', e);
            return null;
        }
    }

    saveLowMessageResetTimestamp() {
        try {
            const timestamp = Date.now();
            localStorage.setItem('jarvis_low_message_reset_timestamp', timestamp.toString());
        } catch (e) {
            console.error('Failed to save low message reset timestamp:', e);
        }
    }

    saveLowMessageCount() {
        try {
            localStorage.setItem('jarvis_low_message_count', this.lowMessageCount.toString());
        } catch (e) {
            console.error('Failed to save low message count:', e);
        }
    }

    checkAndResetLowMessageCount() {
        try {
            // Premium users have unlimited low messages
            if (this.hasPremiumAccess()) {
                return;
            }

            const resetTimestamp = this.loadLowMessageResetTimestamp();
            const now = Date.now();
            const twentyFourHours = 24 * 60 * 60 * 1000;

            if (!resetTimestamp) {
                this.lowMessageCount = 0;
                this.saveLowMessageCount();
                this.saveLowMessageResetTimestamp();
                return;
            }

            if (now - resetTimestamp >= twentyFourHours) {
                this.lowMessageCount = 0;
                this.saveLowMessageCount();
                this.saveLowMessageResetTimestamp();
                console.log('Low model message count reset after 24 hours');
            }
        } catch (e) {
            console.error('Failed to check and reset low message count:', e);
        }
    }

    incrementLowMessageCount() {
        this.checkAndResetLowMessageCount();
        this.lowMessageCount++;
        this.saveLowMessageCount();
        
        if (!this.loadLowMessageResetTimestamp()) {
            this.saveLowMessageResetTimestamp();
        }
    }

    hasReachedLowMessageLimit() {
        // Premium users have unlimited low messages
        if (this.hasPremiumAccess()) {
            return false;
        }
        return this.lowMessageCount >= this.maxFreeLowMessages;
    }

    getRemainingLowMessages() {
        return Math.max(0, this.maxFreeLowMessages - this.lowMessageCount);
    }

    isUsingLowModel() {
        return this.selectedModel === 'jarvis-low' || this.isLowModelMode;
    }

    switchToLowModel(silent = false) {
        console.log('🔄 Switching to Jarvis Low');
        this.selectedModel = 'jarvis-low';
        this.selectedModelName = 'Jarvis Low';
        this.isLowModelMode = true;
        
        // Update UI
        if (this.currentModelDisplay) {
            this.currentModelDisplay.textContent = 'Jarvis Low';
        }
        
        // Update tier toggle UI
        this.updateTierToggleUI();
        
        if (!silent) {
            this.showNotification('Switched to Jarvis Low', true);
        }
    }

    updateTierToggleUI() {
        const isLow = this.isUsingLowModel();
        
        // Update checkbox state (checked = High, unchecked = Low)
        const checkbox = document.getElementById('tier-toggle-checkbox');
        if (checkbox) {
            checkbox.checked = !isLow;
        }
    }

    setupTierToggle() {
        // Get elements
        const checkbox = document.getElementById('tier-toggle-checkbox');
        const toggleContainer = document.getElementById('jarvis-tier-toggle');
        
        if (!checkbox) return;
        
        // Initialize toggle state
        this.updateTierToggleUI();
        
        // Handle checkbox change
        checkbox.addEventListener('change', (e) => {
            e.stopPropagation();
            const isHigh = e.target.checked;
            console.log(`🔄 Tier toggle changed to: ${isHigh ? 'High' : 'Low'}`);
            
            if (isHigh) {
                // Switch to High (default Jarvis)
                this.isLowModelMode = false;
                this.selectModel('default', 'Jarvis');
            } else {
                // Switch to Low (GPT-5 Mini)
                this.switchToLowModel(true);
            }
            
            this.updateTierToggleUI();
            this.hideModelSubmenu();
        });
        
        // Prevent clicks on toggle from triggering model selection
        if (toggleContainer) {
            toggleContainer.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
    }

    // ============ End Low Model Tracking ============

    updateMessageCounter() {
        if (!this.messageCounter || !this.messageCountText) {
            console.warn('Message counter elements not found');
            return;
        }
        
        // Only show counter for free users
        if (this.hasPremiumAccess()) {
            this.messageCounter.classList.add('hidden');
            this.messageCounter.classList.remove('upgrade-btn');
            console.log('Premium access - hiding message counter');
            return;
        }
        
        // Check and reset if 24 hours have passed
        this.checkAndResetMessageCount();
        
        // Show counter for free users
        this.messageCounter.classList.remove('hidden');
        const remaining = this.getRemainingMessages();
        
        // Update styling based on remaining messages
        this.messageCounter.classList.remove('warning', 'critical', 'upgrade-btn');
        
        if (remaining === 0) {
            // Show upgrade button when out of messages
            this.messageCountText.textContent = '⬆ Upgrade';
            this.messageCounter.classList.add('upgrade-btn');
            this.messageCounter.style.cursor = 'pointer';
            
            // Add click handler for upgrade (remove old one first)
            this.messageCounter.onclick = async () => {
                if (this.isElectron) {
                    try {
                        const { ipcRenderer } = window.require('electron');
                        this.showNotification('Opening checkout page...', 'info');
                        const result = await ipcRenderer.invoke('create-checkout-session');
                        if (!result || !result.success) {
                            this.showNotification('Failed to open checkout. Please try again.', 'error');
                        }
                    } catch (e) {
                        console.error('Error opening checkout:', e);
                        this.showNotification('Failed to open checkout. Please try again.', 'error');
                    }
                }
            };
            console.log('Free tier - showing upgrade button (0 messages remaining)');
        } else {
            this.messageCountText.textContent = `${remaining}/${this.maxFreeMessages}`;
            this.messageCounter.style.cursor = 'default';
            this.messageCounter.onclick = null;
            console.log(`Free tier - showing ${remaining}/${this.maxFreeMessages} messages remaining`);
        
        if (remaining <= 2) {
            this.messageCounter.classList.add('critical');
        } else if (remaining <= 5) {
            this.messageCounter.classList.add('warning');
            }
        }
    }

    hasPremiumAccess() {
        // Check if user has premium subscription
        // If licenseStatus is null or invalid, assume free (conservative approach)
        if (!this.licenseStatus) {
            return false;
        }
        return this.licenseStatus.valid && 
               (this.licenseStatus.type === 'premium' || this.licenseStatus.type === 'active');
    }

    getTimeUntilReset() {
        const resetTimestamp = this.loadMessageResetTimestamp();
        if (!resetTimestamp) return null;
        
        const now = Date.now();
        const twentyFourHours = 24 * 60 * 60 * 1000;
        const timeUntilReset = (resetTimestamp + twentyFourHours) - now;
        
        if (timeUntilReset <= 0) return null; // Reset should happen now
        
        return timeUntilReset;
    }

    formatTimeUntilReset(ms) {
        const hours = Math.floor(ms / (1000 * 60 * 60));
        const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((ms % (1000 * 60)) / 1000);
        
        if (hours > 0) {
            return `${hours}h ${minutes}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        } else {
            return `${seconds}s`;
        }
    }

    showMessageLimitReached() {
        // AGGRESSIVE MULTI-LAYER BLOCKING
        
        // Block 1: Check premium access (synchronous check)
        if (this.hasPremiumAccess()) {
            console.log('🚫 Block 1: Blocked - user has premium access');
            return;
        }
        
        // Block 2: Check grace period flag
        if (this.subscriptionJustActivated) {
            if (this.subscriptionActivatedTime) {
                const timeSinceActivation = Date.now() - this.subscriptionActivatedTime;
                if (timeSinceActivation < 30000) {
                    console.log('🚫 Block 2: Blocked - subscription just activated (grace period)');
                    return;
                }
            } else {
                // Flag is set but no time - still block
                console.log('🚫 Block 2b: Blocked - subscription activation flag set');
                return;
            }
        }
        
        // Block 3: Check license status directly
        if (this.licenseStatus && this.licenseStatus.valid && 
            (this.licenseStatus.type === 'premium' || this.licenseStatus.type === 'active')) {
            console.log('🚫 Block 3: Blocked - license status shows premium');
            return;
        }
        
        // Block 4: Stop countdown timer if it's running
        if (this.countdownTimerInterval) {
            console.log('🛑 Stopping countdown timer before showing notification');
            clearInterval(this.countdownTimerInterval);
            this.countdownTimerInterval = null;
        }
        
        console.log('⚠️ Showing message limit notification - free tier user (all blocks passed)');
        
        const timeUntilReset = this.getTimeUntilReset();
        const resetTimeText = timeUntilReset ? this.formatTimeUntilReset(timeUntilReset) : 'soon';
        
        // Display as a simple text message (like normal AI responses)
        const message = `Message limit reached. Wait ${resetTimeText} or upgrade`;
        
        this.showNotification(message, false);
        
        // Start countdown timer if reset time exists
        if (timeUntilReset && timeUntilReset > 0) {
            setTimeout(() => {
                this.startCountdownTimer(timeUntilReset);
            }, 100);
        }
    }

    startCountdownTimer(initialTime) {
        // Stop any existing countdown timer
        if (this.countdownTimerInterval) {
            clearInterval(this.countdownTimerInterval);
            this.countdownTimerInterval = null;
        }
        
        let remainingTime = initialTime;
        
        const updateCountdown = () => {
            // Stop countdown if user has premium access
            if (this.hasPremiumAccess() || this.subscriptionJustActivated) {
                console.log('🛑 Stopping countdown timer - user has premium');
                if (this.countdownTimerInterval) {
                    clearInterval(this.countdownTimerInterval);
                    this.countdownTimerInterval = null;
                }
                // Clear the notification
                if (this.dragOutput && !this.dragOutput.classList.contains('hidden')) {
                    const currentContent = this.dragOutput.innerHTML || this.dragOutput.textContent || '';
                    if (currentContent.includes('Message limit reached') || currentContent.includes('message limit')) {
                        this.dragOutput.classList.add('hidden');
                        this.dragOutput.innerHTML = '';
                        this.dragOutput.textContent = '';
                    }
                }
                return;
            }
            
            if (remainingTime <= 0) {
                // Reset happened, refresh subscription status
                this.checkAndResetMessageCount();
                this.updateMessageCounter();
                // Update the notification text
                const dragOutput = this.dragOutput;
                if (dragOutput && !dragOutput.classList.contains('hidden')) {
                    dragOutput.textContent = 'Messages reset! You now have 5 free messages available.';
                }
                if (this.countdownTimerInterval) {
                    clearInterval(this.countdownTimerInterval);
                    this.countdownTimerInterval = null;
                }
                return;
            }
            
            // Update the notification text with new countdown
            const dragOutput = this.dragOutput;
            if (dragOutput && !dragOutput.classList.contains('hidden')) {
                const resetTimeText = this.formatTimeUntilReset(remainingTime);
                // Update as simple text message
                dragOutput.textContent = `Message limit reached. Wait ${resetTimeText} or upgrade`;
            }
            
            remainingTime -= 1000; // Decrease by 1 second
        };
        
        // Use setInterval instead of recursive setTimeout for easier cleanup
        this.countdownTimerInterval = setInterval(updateCountdown, 1000);
        updateCountdown(); // Run immediately
    }

    grantFreeAccess() {
        // Grant free access to all features
        this.features = {
            screenshotAnalysis: true,
            voiceCommands: true,
            appControl: true,
            cloudSync: true,
            unlimitedConversations: true
        };
        
        // Store the free access in localStorage
        if (typeof Storage !== 'undefined') {
            localStorage.setItem('jarvis_free_access', 'true');
            localStorage.setItem('jarvis_features', JSON.stringify(this.features));
        }
        
        // Reset message count for premium users
        this.resetMessageCount();
        this.updateMessageCounter();
        
        // Also notify the main process about free access
        if (this.isElectron) {
            const { ipcRenderer } = require('electron');
            ipcRenderer.send('grant-free-access');
        }
        
        this.addMessage('Jarvis', 'Free access granted! All Pro features are now unlocked! 🎉', 'assistant');
    }

    stripMarkdown(text) {
        // Remove markdown formatting for plain text (used for dragging)
        let clean = text;
        
        // Remove headers (keep the text, remove markers)
        clean = clean.replace(/^### (.+)$/gm, '$1');
        clean = clean.replace(/^## (.+)$/gm, '$1');
        clean = clean.replace(/^# (.+)$/gm, '$1');
        
        // Remove bold (**text** and __text__)
        clean = clean.replace(/\*\*(.+?)\*\*/g, '$1');
        clean = clean.replace(/__(.+?)__/g, '$1');
        
        // Remove italic (*text* or _text_) - do this AFTER bold
        clean = clean.replace(/\*(.+?)\*/g, '$1');
        clean = clean.replace(/_(.+?)_/g, '$1');
        
        // Remove code blocks
        clean = clean.replace(/```[^\n]*\n([^`]+)```/g, '$1');
        
        // Remove inline code
        clean = clean.replace(/`([^`]+)`/g, '$1');
        
        // Remove links [text](url) -> text
        clean = clean.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
        
        // Remove images ![alt](url)
        clean = clean.replace(/!\[([^\]]*)\]\([^\)]+\)/g, '');
        
        // Clean bullet points - convert markdown bullets to simple bullet
        clean = clean.replace(/^[\-\*]\s+/gm, '• ');
        
        // Preserve paragraph breaks - ensure double newlines stay as double newlines
        // This is important for maintaining spacing between paragraphs
        clean = clean.replace(/\n{3,}/g, '\n\n'); // Normalize excessive breaks but keep double
        
        // Process markdown tables - convert to tab-separated format for better transferability
        // Match table pattern: header row, separator row, data rows
        clean = clean.replace(/(\|[^\n]+\|\n\|[:\-\s\|]+\|\n(?:\|[^\n]+\|\n?)+)/g, (match) => {
            const lines = match.trim().split('\n');
            if (lines.length < 2) return match;
            
            // Parse header row
            const headerRow = lines[0].split('|').map(cell => cell.trim()).filter(cell => cell);
            // Skip separator row (line 1)
            // Parse data rows
            const dataRows = lines.slice(2).map(line => 
                line.split('|').map(cell => cell.trim()).filter(cell => cell)
            );
            
            // Build tab-separated table (works well when copied to Google Docs)
            let tableText = '\n';
            // Header row
            if (headerRow.length > 0) {
                tableText += headerRow.join('\t') + '\n';
            }
            // Data rows
            dataRows.forEach(row => {
                // Pad row to match header length
                while (row.length < headerRow.length) {
                    row.push('');
                }
                tableText += row.slice(0, headerRow.length).join('\t') + '\n';
            });
            tableText += '\n';
            return tableText;
        });
        
        // Clean up multiple consecutive spaces (but NOT newlines)
        clean = clean.replace(/ {2,}/g, ' ');
        
        // Clean up excessive line breaks (more than 2 consecutive)
        clean = clean.replace(/\n{3,}/g, '\n\n');
        
        // Remove HTML tags if any leaked through
        clean = clean.replace(/<[^>]*>/g, '');
        
        // Remove leading/trailing whitespace
        clean = clean.trim();
        
        return clean;
    }

    processContent(content, isHTML) {
        let processed = content;
        
        // Process markdown formatting FIRST (before other replacements)
        // Headers (## or ###)
        processed = processed.replace(/^### (.+)$/gm, '<h3 style="font-size: 1.1em; font-weight: 600; margin: 0.8em 0 0.4em 0;">$1</h3>');
        processed = processed.replace(/^## (.+)$/gm, '<h2 style="font-size: 1.2em; font-weight: 600; margin: 1em 0 0.5em 0;">$1</h2>');
        processed = processed.replace(/^# (.+)$/gm, '<h1 style="font-size: 1.3em; font-weight: 600; margin: 1em 0 0.5em 0;">$1</h1>');
        
        // Bold text (**text**)
        processed = processed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        
        // Italic text (*text* or _text_)
        processed = processed.replace(/\*(.+?)\*/g, '<em>$1</em>');
        processed = processed.replace(/_(.+?)_/g, '<em>$1</em>');
        
        // Code blocks (```code```)
        processed = processed.replace(/```([^`]+)```/g, '<code style="display: block; background: rgba(255,255,255,0.1); padding: 8px; border-radius: 4px; margin: 8px 0; font-family: monospace; white-space: pre-wrap;">$1</code>');
        
        // Inline code (`code`)
        processed = processed.replace(/`([^`]+)`/g, '<code style="background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 3px; font-family: monospace;">$1</code>');
        
        // Bullet lists (- item or * item)
        processed = processed.replace(/^[•\-\*] (.+)$/gm, '<div style="margin-left: 1.2em; margin-top: 0.3em;">• $1</div>');
        
        // Process paragraphs - convert double newlines to paragraph tags with blank lines between
        // But preserve tables and other block elements
        // First, temporarily mark tables to protect them
        const tablePlaceholders = [];
        let tableIndex = 0;
        processed = processed.replace(/<table[\s\S]*?<\/table>/gi, (match) => {
            const placeholder = `__TABLE_PLACEHOLDER_${tableIndex}__`;
            tablePlaceholders.push(match);
            tableIndex++;
            return placeholder;
        });
        
        // Now process paragraphs (tables are protected)
        // Split by double newlines and wrap each paragraph
        // Also handle single newlines that might separate paragraphs in the original text
        let paragraphBreaks = processed.split(/\n\s*\n/);
        
        // If we only got one paragraph, check for single newlines that might indicate paragraph breaks
        // (but not within code blocks or tables)
        if (paragraphBreaks.length === 1) {
            // Try splitting by single newlines, but be careful not to break code blocks
            const lines = processed.split('\n');
            const newParagraphs = [];
            let currentParagraph = [];
            
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                const trimmed = line.trim();
                
                // Skip empty lines - they indicate paragraph breaks
                if (trimmed === '' && currentParagraph.length > 0) {
                    newParagraphs.push(currentParagraph.join('\n'));
                    currentParagraph = [];
                } else if (trimmed !== '' || currentParagraph.length > 0) {
                    currentParagraph.push(line);
                }
            }
            
            if (currentParagraph.length > 0) {
                newParagraphs.push(currentParagraph.join('\n'));
            }
            
            if (newParagraphs.length > 1) {
                paragraphBreaks = newParagraphs;
            }
        }
        
        const paragraphs = paragraphBreaks.filter(p => p.trim());
        if (paragraphs.length > 1) {
            // Wrap each paragraph in <p> tags - separate block elements, no <br> needed
            processed = paragraphs.map(p => {
                const trimmed = p.trim();
                // Don't wrap if already wrapped or if it's a placeholder/other block element
                if (trimmed.includes('__TABLE_PLACEHOLDER_') || 
                    (trimmed.startsWith('<') && (trimmed.startsWith('<p') || trimmed.startsWith('<div') || trimmed.startsWith('<h')))) {
                    return trimmed;
                }
                return `<p style="line-height: 1.6; margin: 0; padding: 0; display: block;">${trimmed}</p>`;
            }).join('\n'); // Use newline between paragraphs, not <br>
        } else if (paragraphs.length === 1 && !paragraphs[0].includes('<p') && !paragraphs[0].includes('<div') && !paragraphs[0].includes('<h') && !paragraphs[0].includes('__TABLE_PLACEHOLDER_')) {
            // Single paragraph that's not already wrapped - wrap it
            processed = `<p style="line-height: 1.6; margin: 0; padding: 0; display: block;">${paragraphs[0].trim()}</p>`;
        }
        
        // Restore tables
        tablePlaceholders.forEach((table, idx) => {
            processed = processed.replace(`__TABLE_PLACEHOLDER_${idx}__`, table);
        });
        
        // Make URLs clickable
        processed = processed.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" style="color: #4A9EFF; text-decoration: underline;">$1</a>');
        
        // Process LaTeX math blocks first (\[ ... \] or $$ ... $$)
        // These should be rendered as display math - keep delimiters for auto-render
        processed = processed.replace(/\\\[([\s\S]*?)\\\]/g, '<div class="math-display">\\[$1\\]</div>');
        processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, '<div class="math-display">$$$1$$</div>');
        
        // Process inline LaTeX math (\( ... \) or $ ... $)
        // Use a more careful regex that doesn't match inside code blocks
        processed = processed.replace(/\\\(([\s\S]*?)\\\)/g, '<span class="math-inline">\\($1\\)</span>');
        // Match $...$ but not $$...$$ (inline math) - be careful not to match inside code blocks
        // Allow backslashes inside math for LaTeX commands like \int, \sqrt, etc.
        processed = processed.replace(/(?<!`)(?<!\$)(?<!\\)\$([^$\n`]+?)\$(?!\$)(?!`)/g, '<span class="math-inline">$$$1$$</span>');
        
        // Format powers (only if not already in LaTeX)
        processed = processed.replace(/(?<!\\[()])([a-zA-Z])\^(\d+)(?![\\[()])/g, '$1<sup>$2</sup>');
        processed = processed.replace(/(?<!\\[()])\^(\d+)(?![\\[()])/g, '<sup>$1</sup>');
        
        // Format simple fractions (only if not already in LaTeX)
        // Don't replace fractions that are inside LaTeX blocks
        processed = processed.replace(/(?<!\\[()])(\d+)\/(\d+)(?![\\[()])/g, '<span style="display: inline-block; vertical-align: middle; text-align: center; margin: 0 2px;"><span style="border-bottom: 1px solid; padding-bottom: 1px;">$1</span><br><span>$2</span></span>');
        
        // Process markdown tables (| col1 | col2 | col3 |)
        // Match table pattern: header row, separator row, data rows
        processed = processed.replace(/(\|[^\n]+\|\n\|[:\-\s\|]+\|\n(?:\|[^\n]+\|\n?)+)/g, (match) => {
            const lines = match.trim().split('\n');
            if (lines.length < 2) return match;
            
            // Helper function to process cell content (without recursion)
            const processCell = (cell) => {
                let cellContent = cell;
                // Process bold
                cellContent = cellContent.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
                // Process italic
                cellContent = cellContent.replace(/\*(.+?)\*/g, '<em>$1</em>');
                // Process inline code
                cellContent = cellContent.replace(/`([^`]+)`/g, '<code style="background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 3px; font-family: monospace;">$1</code>');
                return cellContent;
            };
            
            // Parse header row
            const headerRow = lines[0].split('|').map(cell => cell.trim()).filter(cell => cell);
            // Skip separator row (line 1)
            // Parse data rows
            const dataRows = lines.slice(2).map(line => 
                line.split('|').map(cell => cell.trim()).filter(cell => cell)
            );
            
            // Build HTML table
            let html = '<table style="border-collapse: collapse; width: 100%; margin: 1em 0; border: 1px solid rgba(255,255,255,0.2);">';
            
            // Header row
            if (headerRow.length > 0) {
                html += '<thead><tr style="background: rgba(255,255,255,0.1);">';
                headerRow.forEach(cell => {
                    html += `<th style="border: 1px solid rgba(255,255,255,0.2); padding: 10px 12px; text-align: left; font-weight: 600;">${processCell(cell)}</th>`;
                });
                html += '</tr></thead>';
            }
            
            // Data rows
            if (dataRows.length > 0) {
                html += '<tbody>';
                dataRows.forEach(row => {
                    html += '<tr>';
                    row.forEach((cell, idx) => {
                        const cellContent = idx < headerRow.length ? cell : '';
                        html += `<td style="border: 1px solid rgba(255,255,255,0.2); padding: 10px 12px; text-align: left;">${processCell(cellContent)}</td>`;
                    });
                    html += '</tr>';
                });
                html += '</tbody>';
            }
            
            html += '</table>';
            return html;
        });
        
        // Format common math symbols (only if not in LaTeX)
        processed = processed.replace(/(?<!\\[()])\bpi\b(?![\\[()])/g, 'π');
        processed = processed.replace(/(?<!\\[()])\binfinity\b(?![\\[()])/g, '∞');
        processed = processed.replace(/(?<!\\[()])\balpha\b(?![\\[()])/g, 'α');
        processed = processed.replace(/(?<!\\[()])\bbeta\b(?![\\[()])/g, 'β');
        processed = processed.replace(/(?<!\\[()])\bgamma\b(?![\\[()])/g, 'γ');
        processed = processed.replace(/(?<!\\[()])\bdelta\b(?![\\[()])/g, 'δ');
        processed = processed.replace(/(?<!\\[()])\btheta\b(?![\\[()])/g, 'θ');
        processed = processed.replace(/(?<!\\[()])\blambda\b(?![\\[()])/g, 'λ');
        processed = processed.replace(/(?<!\\[()])\bmu\b(?![\\[()])/g, 'μ');
        processed = processed.replace(/(?<!\\[()])\bsigma\b(?![\\[()])/g, 'σ');
        
        return processed;
    }

    renderMath(element) {
        if (!element) return;
        
        // Wait for KaTeX to load - check multiple times with increasing delays
        if (typeof window.katex === 'undefined') {
            setTimeout(() => this.renderMath(element), 200);
            return;
        }

        try {
            // Use auto-render first - it's the most reliable method
            if (typeof window.renderMathInElement !== 'undefined') {
                try {
                    window.renderMathInElement(element, {
                        delimiters: [
                            {left: '$$', right: '$$', display: true},
                            {left: '\\[', right: '\\]', display: true},
                            {left: '$', right: '$', display: false},
                            {left: '\\(', right: '\\)', display: false}
                        ],
                        throwOnError: false,
                        strict: false,
                        ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code']
                    });
                } catch (e) {
                    console.warn('Auto-render error:', e);
                }
            }

            // Also manually render wrapped math elements as backup
            const displayMathElements = element.querySelectorAll('.math-display');
            displayMathElements.forEach(el => {
                // Skip if already rendered by auto-render (has katex class)
                if (el.querySelector('.katex')) return;
                
                let mathText = el.textContent.trim();
                // Remove delimiters if present
                mathText = mathText.replace(/^\\\[|\\\]$/g, '').replace(/^\$\$|\$\$$/g, '').trim();
                if (mathText) {
                    try {
                        // Clear the element first
                        el.textContent = '';
                        window.katex.render(mathText, el, {
                            displayMode: true,
                            throwOnError: false
                        });
                    } catch (e) {
                        console.warn('KaTeX render error:', e, mathText);
                    }
                }
            });

            // Render inline math (\( ... \) or $ ... $)
            const inlineMathElements = element.querySelectorAll('.math-inline');
            inlineMathElements.forEach(el => {
                // Skip if already rendered by auto-render (has katex class)
                if (el.querySelector('.katex')) return;
                
                let mathText = el.textContent.trim();
                // Remove delimiters if present
                mathText = mathText.replace(/^\\\(|\\\)$/g, '').replace(/^\$|\$$/g, '').trim();
                if (mathText) {
                    try {
                        // Clear the element first
                        el.textContent = '';
                        window.katex.render(mathText, el, {
                            displayMode: false,
                            throwOnError: false
                        });
                    } catch (e) {
                        console.warn('KaTeX render error:', e, mathText);
                    }
                }
            });
        } catch (error) {
            console.warn('Error rendering math:', error);
        }
    }

    showChunkedResponse(content, isHTML = false) {
        // Split content into chunks of ~400 characters at sentence boundaries
        const chunks = this.chunkText(content, 400);
        
        // Display first chunk immediately
        const firstChunk = chunks[0];
        const processedFirstChunk = this.processContent(firstChunk, isHTML);
        
        this.dragOutput.innerHTML = processedFirstChunk;
        this.dragOutput.dataset.fullText = this.stripMarkdown(firstChunk).replace(/<[^>]*>/g, '');
        
        // Render math with KaTeX (with delay to ensure DOM and KaTeX are ready)
        setTimeout(() => {
            this.renderMath(this.dragOutput);
        }, 200);
        
        this.dragOutput.classList.remove('hidden');
        this.positionFloatingClose();
        
        
        // Move answer this button (remove default positioning)
        if (this.answerThisBtn) {
            this.answerThisBtn.classList.remove('hidden');
            this.answerThisBtn.classList.remove('answer-this-default');
        }
        
        // Show humanize button
        if (this.humanizeBtn) {
            this.humanizeBtn.classList.remove('hidden');
        }
        
        // Reapply button colors based on current theme
        this.reapplyButtonColors();
        
        document.querySelectorAll('.notification').forEach(n => n.remove());
        
        // Add "Continue" button if there are more chunks
        if (chunks.length > 1) {
            this.addContinueButton(chunks, 1, isHTML);
        }
    }

    chunkText(text, maxLength) {
        const sentences = text.split(/[.!?]+/).filter(s => s.trim());
        const chunks = [];
        let currentChunk = '';
        
        for (const sentence of sentences) {
            const trimmedSentence = sentence.trim() + '.';
            
            if (currentChunk.length + trimmedSentence.length <= maxLength) {
                currentChunk += (currentChunk ? ' ' : '') + trimmedSentence;
            } else {
                if (currentChunk) {
                    chunks.push(currentChunk);
                }
                currentChunk = trimmedSentence;
            }
        }
        
        if (currentChunk) {
            chunks.push(currentChunk);
        }
        
        return chunks;
    }

    addContinueButton(chunks, currentIndex, isHTML) {
        const continueBtn = document.createElement('button');
        continueBtn.textContent = `Continue (${currentIndex}/${chunks.length})`;
        continueBtn.className = 'continue-btn';
        continueBtn.style.cssText = `
            position: absolute;
            bottom: -35px;
            right: 10px;
            background: rgba(60, 60, 70, 0.8);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 6px;
            color: #fff;
            font-size: 10px;
            padding: 4px 12px;
            cursor: pointer;
            transition: all 0.2s ease;
            z-index: 1000;
        `;
        
        continueBtn.addEventListener('click', () => {
            const nextChunk = chunks[currentIndex];
            const processedNextChunk = this.processContent(nextChunk, isHTML);
            
            this.dragOutput.innerHTML = processedNextChunk;
            this.dragOutput.dataset.fullText = this.stripMarkdown(nextChunk).replace(/<[^>]*>/g, '');
            
            // Render math with KaTeX (with delay to ensure DOM and KaTeX are ready)
            setTimeout(() => {
                this.renderMath(this.dragOutput);
            }, 200);
            
            continueBtn.remove();
            
            // Add continue button for next chunk if available
            if (currentIndex + 1 < chunks.length) {
                this.addContinueButton(chunks, currentIndex + 1, isHTML);
            }
        });
        
        continueBtn.addEventListener('mouseenter', () => {
            continueBtn.style.background = 'rgba(80, 80, 90, 0.9)';
            continueBtn.style.borderColor = 'rgba(255, 255, 255, 0.3)';
        });
        
        continueBtn.addEventListener('mouseleave', () => {
            continueBtn.style.background = 'rgba(60, 60, 70, 0.8)';
            continueBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        });
        
        this.dragOutput.appendChild(continueBtn);
    }


    async answerThis() {
        // Track for tutorial
        this.advanceTutorial('answer-screen');
        
        try {
            // Check if user has reached message limit for free users
            // Re-check subscription status before processing (in case it was cancelled or activated)
            await this.checkLicense();
            
            // Clear any existing "message limit reached" notification if user now has premium
            if (this.hasPremiumAccess() && this.dragOutput && !this.dragOutput.classList.contains('hidden')) {
                const currentContent = this.dragOutput.innerHTML || '';
                if (currentContent.includes('Message Limit Reached') || currentContent.includes('message limit')) {
                    this.dragOutput.classList.add('hidden');
                }
            }
            
            // Block if premium or subscription just activated
            const shouldBlockAnswerThis = this.hasPremiumAccess() || 
                                         (this.subscriptionJustActivated && this.subscriptionActivatedTime && (Date.now() - this.subscriptionActivatedTime < 30000));
            
            if (!shouldBlockAnswerThis && this.hasReachedMessageLimit()) {
                // Final check before showing
                if (this.hasPremiumAccess() || this.subscriptionJustActivated) {
                    console.log('🚫 Blocked in answerThis - premium detected');
                    return;
                }
                this.showNotification('You\'ve reached your free message limit. Upgrade to Pro for unlimited messages!', 'error');
                return;
            }

            this.showNotification('📸 Step 1: Initiating screen capture...');
            this.showNotification('📸 Step 2: Capturing screenshot of your screen...');
            
            // Take screenshot directly
            await this.captureScreen();
            
            if (!this.currentScreenCapture) {
                this.showNotification('❌ Failed to capture screenshot');
                return;
            }

            this.showNotification('✅ Step 3: Screenshot captured successfully');
            this.showNotification('🔍 Step 4: Processing screenshot image data...');

            // Validate screenshot before proceeding
            if (!this.currentScreenCapture || typeof this.currentScreenCapture !== 'string' || !this.currentScreenCapture.startsWith('data:image/')) {
                console.error('❌ Invalid screenshot format:', {
                    exists: !!this.currentScreenCapture,
                    type: typeof this.currentScreenCapture,
                    preview: this.currentScreenCapture ? this.currentScreenCapture.substring(0, 50) : 'null'
                });
                this.showNotification('❌ Failed to capture screenshot. Please try again.');
                return;
            }

            // Store screenshot in a local variable to prevent it from being cleared
            const screenshotData = this.currentScreenCapture;
            console.log('📸 Screenshot validated, length:', screenshotData.length, 'starts with:', screenshotData.substring(0, 30));

            this.showLoadingNotification();
            
            let response;
            // Use OpenAI API (callChatGPT) for Jarvis/default model, OpenRouter for other models
            if (!this.selectedModel || this.selectedModel === 'default') {
                console.log(`🤖 Answer Screen using OpenAI API (Jarvis model) with screenshot`);
                // Call ChatGPT with screenshot - pass screenshot as second parameter (use local copy)
                response = await this.callChatGPT(
                    'answer this (it is just a practice question, not a test)',
                    screenshotData
                );
            } else {
                // Use OpenRouter for non-default models
                const modelToUse = this.selectedModel;
                console.log(`🤖 Answer Screen using OpenRouter model: ${modelToUse}`);
                // Set currentScreenCapture back so OpenRouter can use it
                this.currentScreenCapture = screenshotData;
                response = await this.callOpenRouter(
                    'answer this (it is just a practice question, not a test)',
                    modelToUse,
                    screenshotData
                );
            }
            
            // Clear screenshot after use
            this.currentScreenCapture = null;
            
            // Stop loading animation
            this.stopLoadingAnimation();
            
            // Update conversation history
            this.conversationHistory.push({
                role: 'user',
                content: 'answer this (it is just a practice question, not a test)'
            });
            this.conversationHistory.push({
                role: 'assistant',
                content: response
            });
            
            if (this.conversationHistory.length > 30) {
                this.conversationHistory = this.conversationHistory.slice(-30);
            }
            
            this.saveConversationHistory();
            
            // Increment message count for free users
            if (!this.hasPremiumAccess()) {
                this.incrementMessageCount();
            }
            
            this.showNotification(response, true);
        } catch (error) {
            console.error('Answer this error:', error);
            this.showNotification(`Error: ${error.message || "Couldn't analyze the screen"}`);
        }
    }

    renderPreviousMessages() {
        if (!this.messagesContainer) return;
        
        // Remove all existing message containers except the current drag-output
        const existingMessages = Array.from(this.messagesContainer.children).filter(
            child => child.id !== 'drag-output'
        );
        existingMessages.forEach(msg => msg.remove());
        
        // Render all messages from conversationHistory except the last one (current output)
        if (this.conversationHistory && this.conversationHistory.length > 0) {
            const messagesToShow = [];
            const lastMessage = this.conversationHistory[this.conversationHistory.length - 1];
            
            // If last message is assistant, exclude it (it's the current output we'll add separately)
            const endIndex = (lastMessage && lastMessage.role === 'assistant') 
                ? this.conversationHistory.length - 1 
                : this.conversationHistory.length;
            
            for (let i = 0; i < endIndex; i++) {
                messagesToShow.push(this.conversationHistory[i]);
            }
            
            // Render previous messages as separate containers
            // These will be hidden by default and only visible when scrolling up
            // Render in chronological order (oldest first) so DOM order is: oldest -> newest -> current
            const currentDragOutput = this.messagesContainer.querySelector('#drag-output');
            
            // Render messages in chronological order (oldest first, newest last before current)
            messagesToShow.forEach((msg, index) => {
                // Create a separate container for each message
                const messageContainer = document.createElement('div');
                messageContainer.className = 'drag-output';
                messageContainer.style.cursor = 'default'; // Not draggable for old messages
                messageContainer.draggable = false; // Old messages not draggable
                messageContainer.style.opacity = '0'; // Hidden but takes up space
                messageContainer.style.pointerEvents = 'none'; // Can't interact with hidden messages
                // Store reverse index: 0 = oldest, higher = newer (closer to current)
                messageContainer.dataset.messageIndex = messagesToShow.length - 1 - index;
                messageContainer.dataset.role = msg.role || 'assistant'; // Store role for styling
                
                // Ensure container has proper structure - content should be directly in container
                const msgContent = msg.content || '';
                if (msgContent.includes('<') && msgContent.includes('>')) {
                    messageContainer.innerHTML = msgContent;
                } else {
                    messageContainer.textContent = msgContent;
                }
                
                // Add model tag for assistant messages at the end of content (will stick to bottom when scrolling)
                if (msg.role === 'assistant') {
                    const modelTag = document.createElement('div');
                    modelTag.className = 'model-tag';
                    modelTag.textContent = msg.model || this.selectedModelName || 'Jarvis';
                    messageContainer.appendChild(modelTag);
                }
                
                // Messages keep their full size - just fade in/out
                // Don't collapse height, just control opacity
                
                // Insert before current output (if it exists) or append
                // Insert in chronological order: oldest messages first, newest messages last (right before current)
                if (currentDragOutput) {
                    this.messagesContainer.insertBefore(messageContainer, currentDragOutput);
                } else {
                    this.messagesContainer.appendChild(messageContainer);
                }
            });
        }
    }
    
    scrollToBottom() {
        if (!this.messagesContainer) return;
        
        // Don't scroll if loading notification is active - keep it visible above HUD
        if (this.dragOutput && this.dragOutput.classList.contains('loading-notification')) {
            return;
        }
        
        // Force scroll to absolute bottom to hide all previous messages
        const scrollToBottom = () => {
            if (this.messagesContainer) {
                const container = this.messagesContainer;
                
                // Don't scroll if loading notification is active
                const loadingNotification = container.querySelector('.loading-notification');
                if (loadingNotification) {
                    return;
                }
                
                // Force scroll to absolute bottom
                container.scrollTop = container.scrollHeight;
                
                // Hide previous messages when at bottom
                container.classList.add('at-bottom');
                const previousMessages = container.querySelectorAll('.drag-output:not(#drag-output)');
                previousMessages.forEach(msg => {
                    msg.style.opacity = '0';
                    msg.style.pointerEvents = 'none';
                });
                
                // Verify we're at the bottom
                const maxScroll = container.scrollHeight - container.clientHeight;
                if (container.scrollTop < maxScroll - 1) {
                    // Force it again if not at bottom
                    container.scrollTop = container.scrollHeight;
                }
            }
        };
        
        // Try multiple times with different delays to ensure it sticks
        scrollToBottom();
        setTimeout(scrollToBottom, 0);
        setTimeout(scrollToBottom, 10);
        setTimeout(scrollToBottom, 50);
        setTimeout(scrollToBottom, 100);
        setTimeout(scrollToBottom, 200);
        requestAnimationFrame(() => {
            scrollToBottom();
            setTimeout(scrollToBottom, 0);
            setTimeout(scrollToBottom, 50);
        });
    }
    
    setupScrollObserver() {
        if (!this.messagesContainer) return;
        
        // Track if user is manually scrolling (to prevent auto-scroll when they scroll up)
        this.isUserScrolling = false;
        
        // Cache for message heights to prevent recalculations
        let cachedMessageHeights = new Map();
        
        // Track scroll accumulator for wheel events (shared between wheel handler and updateMessageVisibility)
        let scrollAccumulator = 0;
        let previousScrollAccumulator = -1; // Initialize to -1 to detect first scroll
        let maxAccumulatorReached = 0; // Track the maximum accumulator value reached
        let wheelRafId = null;
        
        // Function to update visibility of previous messages based on scroll position
        const updateMessageVisibility = () => {
            if (!this.messagesContainer) return;
            const container = this.messagesContainer;
            
            // Don't update visibility if loading notification is active - keep it visible above HUD
            const loadingNotification = container.querySelector('.loading-notification');
            if (loadingNotification) {
                container.scrollTop = 0; // Keep loading notification at top
                return;
            }
            
            const scrollTop = container.scrollTop;
            const scrollHeight = container.scrollHeight;
            const clientHeight = container.clientHeight;
            const isAtBottom = scrollHeight - scrollTop <= clientHeight + 50;
            
            const previousMessages = Array.from(container.querySelectorAll('.drag-output:not(#drag-output)'));
            const currentMessage = container.querySelector('#drag-output');
            
            if (!currentMessage) return;
            
            if (isAtBottom) {
                // At bottom - hide all previous messages
                if (!container.classList.contains('at-bottom')) {
                    container.classList.add('at-bottom');
                    previousMessages.forEach((msg) => {
                        msg.style.opacity = '0';
                        msg.style.pointerEvents = 'none';
                    });
                    
                    // Set container height to just current message
                    const currentHeight = currentMessage.offsetHeight;
                    const padding = 0.5 * 16;
                    container.style.height = `${currentHeight + padding}px`;
                    container.scrollTop = container.scrollHeight;
                    
                    // Reset scroll accumulator when at bottom
                    scrollAccumulator = 0;
                    if (wheelRafId !== null) {
                        cancelAnimationFrame(wheelRafId);
                        wheelRafId = null;
                    }
                }
            } else {
                // Scrolled up - show messages above output chat
                container.classList.remove('at-bottom');
                
                // Keep output chat fixed at bottom - prevent container from scrolling
                // Instead, expand container upward to reveal messages
                // Don't scroll if loading notification is active
                if (!container.querySelector('.loading-notification')) {
                    container.scrollTop = container.scrollHeight; // Always stay at bottom
                }
                
                // Calculate which messages to show based on container expansion
                const currentContainerHeight = parseFloat(container.style.height) || currentMessage.offsetHeight;
                const currentMessageHeight = currentMessage.offsetHeight;
                const padding = 0.5 * 16;
                
                // Calculate how many messages can fit based on current height
                let availableHeight = currentContainerHeight - currentMessageHeight - padding;
                let messagesToShow = 0;
                let accumulatedHeight = 0;
                
                // Show messages from newest to oldest (reverse order)
                for (let i = previousMessages.length - 1; i >= 0; i--) {
                    const msg = previousMessages[i];
                    msg.style.height = 'auto';
                    void msg.offsetHeight;
                    let msgHeight = cachedMessageHeights.get(msg);
                    if (!msgHeight) {
                        msgHeight = msg.offsetHeight || msg.scrollHeight || msg.clientHeight;
                        cachedMessageHeights.set(msg, msgHeight);
                    }
                    
                    if (accumulatedHeight + msgHeight <= availableHeight) {
                        accumulatedHeight += msgHeight;
                        messagesToShow++;
                    } else {
                        break;
                    }
                }
                
                // Ensure at least 1 message shows if there are any
                if (previousMessages.length > 0 && messagesToShow === 0) {
                    messagesToShow = 1;
                }
                
                // Calculate heights once and cache them
                let currentHeight = currentMessage.offsetHeight;
                let totalHeight = currentHeight;
                
                // Show/hide messages and calculate height
                previousMessages.forEach((msg, index) => {
                    const reverseIndex = previousMessages.length - 1 - index;
                    const shouldShow = reverseIndex < messagesToShow;
                    
                    if (shouldShow) {
                        // Ensure message is visible and expanded
                        msg.style.removeProperty('height');
                        msg.style.removeProperty('min-height');
                        msg.style.height = 'auto';
                        void msg.offsetHeight; // Force reflow
                        
                        msg.style.opacity = '1';
                        msg.style.pointerEvents = 'auto';
                        msg.style.transition = 'none';
                        
                        // Get height (use cache if available)
                        let msgHeight = cachedMessageHeights.get(msg);
                        if (!msgHeight) {
                            msgHeight = msg.offsetHeight || msg.scrollHeight || msg.clientHeight;
                            cachedMessageHeights.set(msg, msgHeight);
                        }
                        totalHeight += msgHeight;
                    } else {
                        msg.style.opacity = '0';
                        msg.style.pointerEvents = 'none';
                        msg.style.transition = 'none';
                    }
                });
                
                // Update container height - cap at 400px max
                const maxHeight = 400;
                const targetHeight = Math.min(totalHeight + padding, maxHeight);
                
                // Only update height if it changed to prevent glitches
                const existingHeight = parseFloat(container.style.height) || 0;
                if (Math.abs(existingHeight - targetHeight) > 1) {
                    container.style.height = `${targetHeight}px`;
                }
            }
        };
        
        // Observe changes to the messages container
        this.scrollObserver = new MutationObserver(() => {
            // Clear height cache when messages change
            cachedMessageHeights.clear();
            
            // When content changes, scroll to bottom after a brief delay
            // But only if user hasn't manually scrolled up
            if (!this.isUserScrolling) {
                requestAnimationFrame(() => {
                    if (this.messagesContainer) {
                        const container = this.messagesContainer;
                        
                        // Don't scroll if loading notification is active - keep it visible above HUD
                        const loadingNotification = container.querySelector('.loading-notification');
                        if (loadingNotification) {
                            container.scrollTop = 0; // Keep loading notification at top
                            return;
                        }
                        
                        // Only auto-scroll if we're near the bottom
                        const isNearBottom = container.scrollHeight - container.scrollTop <= container.clientHeight + 50;
                        if (isNearBottom) {
                            container.scrollTop = container.scrollHeight;
                            updateMessageVisibility();
                        }
                    }
                });
            }
        });
        
        // Start observing
        this.scrollObserver.observe(this.messagesContainer, {
            childList: true,
            subtree: true
        });
        
        // Track user scrolling to prevent auto-scroll when they scroll up
        let scrollTimeout;
        let lastScrollTop = this.messagesContainer.scrollTop;
        
        // Track scroll wheel events to expand container instead of scrolling
        // scrollAccumulator, targetAccumulator, wheelRafId, and isAnimating are declared above
        
        const updateMessagesFromAccumulator = () => {
            // Get current messages
            const previousMessages = Array.from(this.messagesContainer.querySelectorAll('.drag-output:not(#drag-output)'));
            if (previousMessages.length === 0) return;
            
            const currentMessage = this.messagesContainer.querySelector('#drag-output');
            if (!currentMessage) return;
            
            const padding = 0.5 * 16;
            let targetHeight = currentMessage.offsetHeight + padding;
            
            // Three phases:
            // Phase 1 (0 to maxScroll): Scroll DOWN → messages appear newest→oldest, output moves down
            // Phase 2 (maxScroll to maxScroll*2): Scroll DOWN → messages scroll behind button (newest first) to reveal older ones
            // Scrolling UP: Messages disappear oldest→newest, sliding back behind HUD
            const maxScroll = previousMessages.length * 50;
            const maxScrollWithHide = maxScroll * 2;
            
            // Detect scroll direction based on accumulator change
            // Scroll DOWN (deltaY > 0) → accumulator increases → isScrollingUp = false
            // Scroll UP (deltaY < 0) → accumulator decreases → isScrollingUp = true
            const isScrollingUp = previousScrollAccumulator >= 0 && scrollAccumulator < previousScrollAccumulator;
            // Phase 2: scrolling DOWN beyond maxScroll (accumulator > maxScroll AND increasing)
            const isScrollingDown = previousScrollAccumulator >= 0 && scrollAccumulator > previousScrollAccumulator;
            const isPhase2 = scrollAccumulator > maxScroll && isScrollingDown;
            
            // Debug logging (only log significant changes)
            if (Math.abs(scrollAccumulator - previousScrollAccumulator) > 5) {
                console.log('Scroll:', {
                    acc: scrollAccumulator.toFixed(0),
                    prev: previousScrollAccumulator.toFixed(0),
                    maxScroll,
                    isScrollingUp,
                    isScrollingDown,
                    isPhase2,
                    msgCount: previousMessages.length
                });
            }
            
            // When scrolling up, ensure we don't go below 0
            // But allow negative values temporarily for smooth animation
            if (isScrollingUp && scrollAccumulator < 0) {
                // Clamp to 0 only after all messages are hidden
                // For now, allow negative to animate oldest message disappearing
            }
            
            let accumulatedHeight = 0;
            
            // Messages are in DOM order: oldest (index 0) → newest (index length-1)
            // forwardIndex: 0 = oldest (farthest from output), length-1 = newest (closest to output)
            // reverseIndex: 0 = newest (closest to output), length-1 = oldest (farthest from output)
            
            for (let i = 0; i < previousMessages.length; i++) {
                const forwardIndex = i; // 0 = oldest, length-1 = newest
                const reverseIndex = previousMessages.length - 1 - i; // 0 = newest, length-1 = oldest
                const msg = previousMessages[i];
                
                let progress;
                
                if (isScrollingUp) {
                    // Scrolling UP: Messages slide up behind HUD oldest→newest (top to bottom)
                    // This is the EXACT REVERSE of Phase 1 (scrolling DOWN)
                    // 
                    // In Phase 1 (scrolling DOWN), messages appear using reverseIndex:
                    //   - reverseIndex=0 (newest) appears at accumulator 0→50
                    //   - reverseIndex=1 appears at accumulator 50→100
                    //   - reverseIndex=2 appears at accumulator 100→150, etc.
                    //
                    // When scrolling UP, we reverse this:
                    //   - forwardIndex=0 (oldest) disappears when accumulator goes from 50→0
                    //   - forwardIndex=1 disappears when accumulator goes from 100→50
                    //   - forwardIndex=2 disappears when accumulator goes from 150→100, etc.
                    //
                    // So: message at forwardIndex should be visible when accumulator > (forwardIndex + 1) * 50
                    //     and should disappear progressively as accumulator decreases below that
                    const disappearStart = (forwardIndex + 1) * 50; // When accumulator < this, start disappearing
                    const disappearEnd = forwardIndex * 50; // When accumulator < this, fully hidden
                    
                    if (scrollAccumulator >= disappearStart) {
                        progress = 1; // Fully visible
                    } else if (scrollAccumulator <= disappearEnd) {
                        progress = 0; // Fully hidden behind HUD
                    } else {
                        // Transitioning from visible to hidden as accumulator decreases
                        progress = (scrollAccumulator - disappearEnd) / 50;
                    }
                } else if (isPhase2) {
                    // Phase 2 (scrolling DOWN beyond maxScroll): Messages scroll behind Answer Screen button
                    // reverseIndex=0 (newest, closest to output) scrolls behind button first
                    // This reveals older messages above
                    const hideStart = maxScroll + (reverseIndex * 50);
                    const hideEnd = hideStart + 50;
                    
                    if (scrollAccumulator <= hideStart) {
                        progress = 1; // Still visible
                    } else if (scrollAccumulator >= hideEnd) {
                        progress = 0; // Hidden behind button
                    } else {
                        progress = 1 - ((scrollAccumulator - hideStart) / 50); // Transitioning 1→0
                    }
                } else {
                    // Phase 1 (scrolling DOWN): Messages appear newest→oldest
                    // reverseIndex=0 (newest) appears first when accumulator goes 0→50
                    // reverseIndex=1 appears second when accumulator goes 50→100
                    const appearStart = reverseIndex * 50;
                    const appearEnd = appearStart + 50;
                    
                    if (scrollAccumulator <= appearStart) {
                        progress = 0; // Hidden
                    } else if (scrollAccumulator >= appearEnd) {
                        progress = 1; // Fully visible
                    } else {
                        progress = (scrollAccumulator - appearStart) / 50; // Transitioning 0→1
                    }
                }
                
                // Always expand message for height calculation
                msg.style.removeProperty('height');
                msg.style.removeProperty('min-height');
                msg.style.height = 'auto';
                void msg.offsetHeight;
                
                // Get message height for smooth sliding animation
                let msgHeight = cachedMessageHeights.get(msg);
                if (!msgHeight) {
                    msgHeight = msg.offsetHeight || msg.scrollHeight || msg.clientHeight || 50;
                    cachedMessageHeights.set(msg, msgHeight);
                }
                
                // Apply animation
                // Progress: 0 = hidden above HUD/behind button, 1 = fully visible
                let translateY = 0;
                
                if (isScrollingUp) {
                    // Scrolling UP: Messages slide UP behind HUD (negative translateY)
                    // This is the EXACT OPPOSITE of scrolling DOWN Phase 1
                    // When scrolling DOWN: messages slide DOWN (positive translateY) as they appear
                    // When scrolling UP: messages slide UP (negative translateY) as they disappear
                    // Oldest messages (forwardIndex=0) slide up first, exactly like they slid down last
                    translateY = -(1 - progress) * 30; // Slide up smoothly behind HUD (opposite of Phase 1)
                } else if (isPhase2) {
                    // Phase 2: Messages slide DOWN behind Answer Screen button (positive translateY)
                    translateY = (1 - progress) * (msgHeight + 40); // Slide down smoothly behind button
                } else {
                    // Phase 1: Messages slide DOWN into view (positive translateY)
                    translateY = (1 - progress) * 30; // Small slide down when appearing
                }
                
                msg.style.opacity = progress > 0 ? '1' : '0';
                msg.style.transform = `translateY(${translateY}px)`;
                msg.style.pointerEvents = progress > 0 ? 'auto' : 'none';
                msg.style.transition = 'none';
                
                // Count height for visible messages only
                // When scrolling up, messages slide up visually but maintain layout space until fully hidden
                // This prevents the appearance of messages "moving to the bottom"
                if (progress > 0) {
                    // Only count height for messages that are at least partially visible
                    // This ensures smooth container height decrease as messages hide
                    accumulatedHeight += msgHeight * progress;
                }
            }
            
            targetHeight += accumulatedHeight;
            // Cap height during Phase 1
            if (!isPhase2 && !isScrollingUp) {
                targetHeight = Math.min(targetHeight, 400); // Cap at 400px during Phase 1
            }
            
            // Update container height
            this.messagesContainer.style.height = `${targetHeight}px`;
        };
        
        // Make updateMessagesFromAccumulator globally accessible for the toggle button
        window.updateMessagesFromAccumulator = updateMessagesFromAccumulator;
        
        this.messagesContainer.addEventListener('wheel', (e) => {
            // Check if scrolling inside a drag-output element
            const targetIsOutput = e.target.closest('.drag-output');
            if (targetIsOutput) {
                // Allow normal scrolling inside individual chat boxes
                return;
            }
            
            // Allow normal scrolling - don't prevent default
            // e.preventDefault(); // Commented out to allow normal scrolling
            return; // Skip custom scroll handling
            
            // Get current messages
            const previousMessages = Array.from(this.messagesContainer.querySelectorAll('.drag-output:not(#drag-output)'));
            if (previousMessages.length === 0) return;
            
            // Store previous accumulator BEFORE updating
            const prevAccumulator = scrollAccumulator;
            
            // Update accumulator directly
            // e.deltaY: positive = scroll DOWN, negative = scroll UP
            // Scroll DOWN (deltaY > 0) → increase accumulator → reveal messages
            // Scroll UP (deltaY < 0) → decrease accumulator → hide messages
            const maxScroll = previousMessages.length * 50; // 50px per message
            const maxScrollWithHide = maxScroll * 2; // Allow scrolling beyond max to hide messages behind button
            const minScroll = -50; // Allow going negative to hide oldest message smoothly
            
            // Add deltaY directly (positive deltaY increases accumulator)
            scrollAccumulator = scrollAccumulator + e.deltaY;
            scrollAccumulator = Math.max(minScroll, Math.min(scrollAccumulator, maxScrollWithHide));
            
            // Update max accumulator reached
            maxAccumulatorReached = Math.max(maxAccumulatorReached, scrollAccumulator);
            
            // Update previousScrollAccumulator BEFORE calling updateMessagesFromAccumulator
            previousScrollAccumulator = prevAccumulator;
            
            // Cancel any pending animation
            if (wheelRafId !== null) {
                cancelAnimationFrame(wheelRafId);
            }
            
            // Update messages immediately for smooth, responsive scrolling
            wheelRafId = requestAnimationFrame(() => {
                updateMessagesFromAccumulator();
                wheelRafId = null;
            });
        }, { passive: true });
        
        // Allow normal scrolling
        this.messagesContainer.addEventListener('scroll', () => {
            // Normal scroll behavior - no custom handling
        }, { passive: true });
        
        // Initial visibility update
        updateMessageVisibility();
    }

    async humanize() {
        // Get the current output text
        const dragOutput = document.getElementById('drag-output');
        if (!dragOutput) {
            this.showNotification('No text to humanize', false);
            return;
        }
        
        // Get the text content (strip HTML)
        let text = dragOutput.innerText || dragOutput.textContent;
        if (!text || text.trim().length === 0) {
            this.showNotification('No text to humanize', false);
            return;
        }
        
        // Show loading
        this.showLoadingNotification('Humanizing text...');
        
        try {
            // Apply humanization transformations
            const humanizedText = this.humanizeText(text);
            
            // Display the humanized text
            this.showNotification(humanizedText, false);
            
            // Add to conversation history
            this.conversationHistory.push({
                role: 'assistant',
                content: humanizedText
            });
        } catch (error) {
            console.error('Humanize error:', error);
            this.showNotification('❌ Error humanizing text: ' + error.message, false);
        }
    }
    
    /**
     * Humanize text to make it sound more natural and less AI-generated
     * Inspired by https://github.com/DadaNanjesha/AI-Text-Humanizer-App
     */
    humanizeText(text) {
        let result = text;
        
        // 1. Expand contractions (makes text more formal/academic)
        const contractions = {
            "don't": "do not",
            "doesn't": "does not",
            "didn't": "did not",
            "won't": "will not",
            "wouldn't": "would not",
            "couldn't": "could not",
            "shouldn't": "should not",
            "can't": "cannot",
            "isn't": "is not",
            "aren't": "are not",
            "wasn't": "was not",
            "weren't": "were not",
            "haven't": "have not",
            "hasn't": "has not",
            "hadn't": "had not",
            "it's": "it is",
            "that's": "that is",
            "there's": "there is",
            "here's": "here is",
            "what's": "what is",
            "who's": "who is",
            "let's": "let us",
            "I'm": "I am",
            "you're": "you are",
            "we're": "we are",
            "they're": "they are",
            "I've": "I have",
            "you've": "you have",
            "we've": "we have",
            "they've": "they have",
            "I'll": "I will",
            "you'll": "you will",
            "we'll": "we will",
            "they'll": "they will",
            "I'd": "I would",
            "you'd": "you would",
            "we'd": "we would",
            "they'd": "they would"
        };
        
        for (const [contraction, expansion] of Object.entries(contractions)) {
            const regex = new RegExp(contraction.replace("'", "'"), 'gi');
            result = result.replace(regex, (match) => {
                // Preserve case
                if (match[0] === match[0].toUpperCase()) {
                    return expansion.charAt(0).toUpperCase() + expansion.slice(1);
                }
                return expansion;
            });
        }
        
        // 2. Replace common AI-sounding words with more natural alternatives
        const aiWordReplacements = {
            'utilize': 'use',
            'utilizes': 'uses',
            'utilized': 'used',
            'utilizing': 'using',
            'implementation': 'setup',
            'implement': 'set up',
            'implements': 'sets up',
            'implemented': 'set up',
            'facilitate': 'help',
            'facilitates': 'helps',
            'facilitated': 'helped',
            'leveraging': 'using',
            'leverage': 'use',
            'leveraged': 'used',
            'subsequently': 'then',
            'furthermore': 'also',
            'additionally': 'also',
            'consequently': 'so',
            'nevertheless': 'but',
            'nonetheless': 'still',
            'henceforth': 'from now on',
            'whereby': 'where',
            'thereof': 'of it',
            'therein': 'in it',
            'aforementioned': 'mentioned',
            'pertaining to': 'about',
            'in order to': 'to',
            'due to the fact that': 'because',
            'in the event that': 'if',
            'at this point in time': 'now',
            'in close proximity to': 'near',
            'a large number of': 'many',
            'a significant amount of': 'much',
            'in spite of the fact that': 'although',
            'with regard to': 'about',
            'in reference to': 'about',
            'it is important to note that': '',
            'it should be noted that': '',
            'it is worth mentioning that': '',
            'as a matter of fact': 'actually',
            'in essence': 'basically',
            'in conclusion': 'finally',
            'to summarize': 'in short',
            'delve': 'explore',
            'delves': 'explores',
            'delving': 'exploring',
            'delved': 'explored',
            'crucial': 'important',
            'pivotal': 'key',
            'paramount': 'essential',
            'endeavor': 'try',
            'endeavors': 'tries',
            'endeavored': 'tried',
            'endeavoring': 'trying',
            'plethora': 'many',
            'myriad': 'many',
            'multitude': 'many',
            'commence': 'start',
            'commences': 'starts',
            'commenced': 'started',
            'terminate': 'end',
            'terminates': 'ends',
            'terminated': 'ended',
            'ascertain': 'find out',
            'elucidate': 'explain',
            'elucidates': 'explains',
            'elucidated': 'explained',
            'substantiate': 'prove',
            'substantiates': 'proves',
            'substantiated': 'proved',
            'delineate': 'describe',
            'delineates': 'describes',
            'delineated': 'described',
            'extrapolate': 'extend',
            'extrapolates': 'extends',
            'extrapolated': 'extended'
        };
        
        for (const [aiWord, replacement] of Object.entries(aiWordReplacements)) {
            const regex = new RegExp('\\b' + aiWord + '\\b', 'gi');
            result = result.replace(regex, (match) => {
                if (match[0] === match[0].toUpperCase()) {
                    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
                }
                return replacement;
            });
        }
        
        // 3. Remove redundant AI phrases
        const redundantPhrases = [
            /\bAs an AI( language model)?,?\s*/gi,
            /\bI('m| am) an AI( assistant)?,?\s*/gi,
            /\bAs a language model,?\s*/gi,
            /\bBased on my training( data)?,?\s*/gi,
            /\bI don't have personal (opinions|experiences|feelings),? but\s*/gi,
            /\bCertainly!\s*/gi,
            /\bOf course!\s*/gi,
            /\bAbsolutely!\s*/gi,
            /\bGreat question!\s*/gi,
            /\bThat's a great question!\s*/gi,
            /\bI'd be happy to help( with that)?[.!]?\s*/gi,
            /\bSure thing!\s*/gi,
            /\bHere's (the|my|a) (answer|response|explanation)[.:]\s*/gi,
            /\bLet me (explain|help you understand)[.:]\s*/gi
        ];
        
        for (const phrase of redundantPhrases) {
            result = result.replace(phrase, '');
        }
        
        // 4. Add natural sentence starters (randomly to some sentences)
        const sentences = result.split(/(?<=[.!?])\s+/);
        const naturalStarters = [
            'Actually, ',
            'In fact, ',
            'Well, ',
            'You see, ',
            'The thing is, ',
            'Honestly, ',
            'To be fair, ',
            'From what I understand, ',
            'As far as I know, '
        ];
        
        // Only add starters to 20% of sentences (randomly)
        const processedSentences = sentences.map((sentence, index) => {
            if (index > 0 && Math.random() < 0.15 && sentence.length > 30) {
                // Don't add if sentence already starts with a transition
                const hasTransition = /^(However|Moreover|Furthermore|Additionally|Therefore|Thus|Hence|Consequently|Nevertheless|Also|Besides|Meanwhile|Otherwise|Nonetheless|Still|Yet|So|But|And|Or|Well|Actually|In fact|You see)/i.test(sentence);
                if (!hasTransition) {
                    const starter = naturalStarters[Math.floor(Math.random() * naturalStarters.length)];
                    // Lowercase the first letter of the original sentence
                    return starter + sentence.charAt(0).toLowerCase() + sentence.slice(1);
                }
            }
            return sentence;
        });
        
        result = processedSentences.join(' ');
        
        // 5. Vary sentence length (split very long sentences occasionally)
        result = result.replace(/([^.!?]{150,}?)(,\s*)(and|but|so|because|which|that|where|when)\s/gi, '$1. $3 ');
        
        // 6. Add occasional filler words for naturalness
        const fillerInsertions = [
            { pattern: /\bI think\b/gi, replacements: ['I believe', 'I feel', 'My sense is', 'It seems to me'] },
            { pattern: /\bvery\b/gi, replacements: ['quite', 'really', 'pretty', 'fairly'] },
            { pattern: /\bimportant\b/gi, replacements: ['key', 'significant', 'notable', 'essential'] },
            { pattern: /\bgood\b/gi, replacements: ['solid', 'great', 'decent', 'fine'] },
            { pattern: /\bbad\b/gi, replacements: ['poor', 'not great', 'problematic', 'rough'] }
        ];
        
        for (const { pattern, replacements } of fillerInsertions) {
            result = result.replace(pattern, (match) => {
                // 50% chance to replace
                if (Math.random() < 0.5) {
                    const replacement = replacements[Math.floor(Math.random() * replacements.length)];
                    if (match[0] === match[0].toUpperCase()) {
                        return replacement.charAt(0).toUpperCase() + replacement.slice(1);
                    }
                    return replacement;
                }
                return match;
            });
        }
        
        // 7. Clean up any double spaces or weird punctuation
        result = result.replace(/\s+/g, ' ').trim();
        result = result.replace(/\s+([.,!?;:])/g, '$1');
        result = result.replace(/([.,!?;:])\s*([.,!?;:])/g, '$1');
        
        // Capitalize first letter
        if (result.length > 0) {
            result = result.charAt(0).toUpperCase() + result.slice(1);
        }
        
        return result;
    }

    // ========== OUTPUT TOOLBAR FUNCTIONS ==========
    
    initializeOutputToolbar() {
        // Copy button
        if (this.toolbarCopyBtn) {
            this.toolbarCopyBtn.addEventListener('click', () => this.copyOutputToClipboard());
        }
        
        // Add to Docs button
        if (this.toolbarDocsBtn) {
            this.toolbarDocsBtn.addEventListener('click', () => this.addOutputToDocs());
        }
        
        // Resend/Try again button
        if (this.toolbarRetryBtn) {
            this.toolbarRetryBtn.addEventListener('click', () => this.retryLastQuery());
        }
        
        // Double-click on output to show toolbar
        if (this.messagesContainer) {
            this.messagesContainer.addEventListener('dblclick', (e) => {
                // Only trigger if double-clicking on the drag-output
                const output = e.target.closest('#drag-output');
                if (output) {
                    this.toggleOutputToolbar();
                }
            });
        }
        
        // Hide toolbar when clicking outside
        document.addEventListener('click', (e) => {
            if (this.outputToolbar && !this.outputToolbar.classList.contains('hidden')) {
                if (!e.target.closest('#output-toolbar') && !e.target.closest('#drag-output')) {
                    this.hideOutputToolbar();
                }
            }
        });
    }
    
    toggleOutputToolbar() {
        if (!this.outputToolbar) return;
        
        if (this.outputToolbar.classList.contains('hidden')) {
            this.showOutputToolbar();
        } else {
            this.hideOutputToolbar();
        }
    }
    
    showOutputToolbar() {
        if (!this.outputToolbar || !this.messagesContainer) return;
        
        // Position the toolbar below the messages container
        const containerRect = this.messagesContainer.getBoundingClientRect();
        const overlayRect = this.overlay.getBoundingClientRect();
        
        // Position relative to overlay
        this.outputToolbar.style.top = `${containerRect.bottom - overlayRect.top + 8}px`;
        this.outputToolbar.style.left = '50%';
        this.outputToolbar.style.transform = 'translateX(-50%)';
        
        this.outputToolbar.classList.remove('hidden');
    }
    
    hideOutputToolbar() {
        if (this.outputToolbar) {
            this.outputToolbar.classList.add('hidden');
        }
    }
    
    async copyOutputToClipboard() {
        if (!this.dragOutput) return;
        
        try {
            // Get the text content from the output
            const text = this.dragOutput.dataset.fullText || this.dragOutput.innerText || '';
            
            let success = false;
            
            // Use Electron IPC to copy (most reliable in Electron apps)
            if (this.isElectron && window.require) {
                const { ipcRenderer } = window.require('electron');
                success = await ipcRenderer.invoke('copy-to-clipboard', text);
            } else {
                // Fallback to web clipboard API
                await navigator.clipboard.writeText(text);
                success = true;
            }
            
            if (success) {
                // Show visual feedback
                if (this.toolbarCopyBtn) {
                    this.toolbarCopyBtn.classList.add('copied');
                    setTimeout(() => {
                        this.toolbarCopyBtn.classList.remove('copied');
                    }, 1500);
                }
            } else {
                throw new Error('IPC copy failed');
            }
        } catch (error) {
            console.error('Failed to copy:', error);
            this.showNotification('Failed to copy to clipboard', false);
        }
    }
    
    async retryLastQuery() {
        if (!this.lastUserQuery) {
            this.showNotification('No previous query to retry', false);
            return;
        }
        
        // Hide toolbar before resending
        this.hideOutputToolbar();
        
        // Re-send the last query
        if (this.textInput) {
            this.textInput.value = this.lastUserQuery;
        }
        await this.sendMessage();
    }
    
    async addOutputToDocs() {
        if (!this.dragOutput) {
            this.showNotification('No output to add to docs', false);
            return;
        }
        
        // Hide toolbar
        this.hideOutputToolbar();
        
        // Get the content from the output
        const htmlContent = this.dragOutput.innerHTML;
        const textContent = this.dragOutput.dataset.fullText || this.dragOutput.innerText || '';
        
        // Use existing writeToDocs method (same as /docs command)
        if (typeof this.writeToDocs === 'function') {
            await this.writeToDocs(false); // false = not paste mode, use realistic typing
        } else {
            this.showNotification('Google Docs integration not available', false);
        }
    }
    
    // ========== END OUTPUT TOOLBAR FUNCTIONS ==========

    /**
     * Show document name modal and return promise with document name
     */
    async promptDocumentName(defaultName = '') {
        return new Promise((resolve) => {
            if (!this.documentNameModal || !this.documentNameInput) {
                resolve(defaultName);
                return;
            }

            // Make window interactive when showing modal
            if (this.isElectron && window.require) {
                const { ipcRenderer } = window.require('electron');
                ipcRenderer.invoke('make-interactive').catch(() => {});
            }

            // Set default value
            this.documentNameInput.value = defaultName || `Jarvis Output - ${new Date().toLocaleDateString()}`;
            
            // Update modal title and button text
            const modalTitle = this.documentNameModal.querySelector('h3');
            const confirmBtn = this.documentNameConfirm;
            if (modalTitle) modalTitle.textContent = 'Name Your Google Doc';
            if (confirmBtn) confirmBtn.textContent = 'Create';
            
            // Show modal
            this.documentNameModal.classList.remove('hidden');
            this.documentNameInput.focus();
            this.documentNameInput.select();

            // Handle confirm
            const handleConfirm = () => {
                const name = this.documentNameInput.value.trim() || defaultName;
                this.documentNameModal.classList.add('hidden');
                cleanup();
                resolve(name);
            };

            // Handle cancel
            const handleCancel = () => {
                this.documentNameModal.classList.add('hidden');
                cleanup();
                resolve(null);
            };

            // Handle Enter key
            const handleKeyPress = (e) => {
                if (e.key === 'Enter') {
                    handleConfirm();
                } else if (e.key === 'Escape') {
                    handleCancel();
                }
            };

            // Cleanup function
            const cleanup = () => {
                this.documentNameConfirm.removeEventListener('click', handleConfirm);
                this.documentNameCancel.removeEventListener('click', handleCancel);
                this.documentNameInput.removeEventListener('keydown', handleKeyPress);
            };

            // Add event listeners
            this.documentNameConfirm.addEventListener('click', handleConfirm);
            this.documentNameCancel.addEventListener('click', handleCancel);
            this.documentNameInput.addEventListener('keydown', handleKeyPress);
        });
    }


    async promptDocumentId() {
        return new Promise(async (resolve) => {
            // Re-query elements if they're not found (in case DOM wasn't ready during initialization)
            if (!this.documentSelectionModal) {
                this.documentSelectionModal = document.getElementById('document-selection-modal');
            }
            if (!this.documentList) {
                this.documentList = document.getElementById('document-list');
            }
            if (!this.documentListLoading) {
                this.documentListLoading = document.getElementById('document-list-loading');
            }
            if (!this.documentSelectionCancel) {
                this.documentSelectionCancel = document.getElementById('document-selection-cancel');
            }
            if (!this.documentSelectionNew) {
                this.documentSelectionNew = document.getElementById('document-selection-new');
            }
            
            // Debug: Log what elements were found
            console.log('Document selection modal elements:', {
                modal: !!this.documentSelectionModal,
                list: !!this.documentList,
                loading: !!this.documentListLoading,
                cancel: !!this.documentSelectionCancel,
                new: !!this.documentSelectionNew
            });
            
            if (!this.documentSelectionModal || !this.documentList || !this.documentListLoading) {
                // Fallback to manual input if modal elements still don't exist
                console.error('Document selection modal elements not found, falling back to manual input', {
                    modal: !!this.documentSelectionModal,
                    list: !!this.documentList,
                    loading: !!this.documentListLoading
                });
                resolve(await this.promptDocumentIdManual());
                return;
            }

            // Make window interactive when showing modal - do this BEFORE showing modal
            if (this.isElectron && window.require) {
                const { ipcRenderer } = window.require('electron');
                // Force window to be interactive and focused
                ipcRenderer.invoke('make-interactive').catch(() => {});
                // Also ensure focus after a brief delay to make sure it sticks
                setTimeout(() => {
                    ipcRenderer.invoke('make-interactive').catch(() => {});
                }, 50);
            }

            // Show loading state
            this.documentListLoading.style.display = 'block';
            this.documentList.style.display = 'none';
            this.documentSelectionModal.classList.remove('hidden');
            
            // Ensure window stays interactive when modal is visible
            if (this.isElectron && window.require) {
                const { ipcRenderer } = window.require('electron');
                // Keep window interactive while modal is open
                const keepInteractive = setInterval(() => {
                    ipcRenderer.invoke('make-interactive').catch(() => {});
                }, 100);
                
                // Store interval ID for cleanup
                this._documentModalInterval = keepInteractive;
            }

            // Load documents
            let documents = [];
            try {
                if (this.isElectron && window.require) {
                    const { ipcRenderer } = window.require('electron');
                    const result = await ipcRenderer.invoke('list-google-docs');
                    if (result.success && result.documents) {
                        documents = result.documents;
                    } else {
                        throw new Error(result.error || 'Failed to load documents');
                    }
                } else {
                    throw new Error('Not in Electron environment');
                }
            } catch (error) {
                console.error('Error loading documents:', error);
                // Don't fallback to manual input - show error in modal instead
                this.documentListLoading.style.display = 'none';
                this.documentList.style.display = 'block';
                this.documentList.innerHTML = `<div style="text-align: center; padding: 40px; color: #ef4444;">
                    <div style="margin-bottom: 10px;">⚠️ Failed to load documents</div>
                    <div style="font-size: 12px; color: #888;">${error.message || 'Unknown error'}</div>
                    <div style="margin-top: 20px; font-size: 12px; color: #888;">You can still create a new document</div>
                </div>`;
                // Continue showing the modal with "New Doc" button available
                // Don't fallback to manual input - let user use "New Doc" button
            }

            // Hide loading, show list
            this.documentListLoading.style.display = 'none';
            this.documentList.style.display = 'block';

            // Clear previous list
            this.documentList.innerHTML = '';

            if (documents.length === 0) {
                this.documentList.innerHTML = '<div style="text-align: center; padding: 40px; color: #888;">No documents found</div>';
            } else {
                // Create list items
                documents.forEach((doc) => {
                    const item = document.createElement('div');
                    item.className = 'document-list-item';
                    
                    const name = document.createElement('div');
                    name.style.cssText = 'font-weight: 500; color: #fff; margin-bottom: 4px;';
                    name.textContent = doc.name;
                    
                    const date = document.createElement('div');
                    date.style.cssText = 'font-size: 12px; color: rgba(255, 255, 255, 0.5);';
                    if (doc.modifiedTime) {
                        const modifiedDate = new Date(doc.modifiedTime);
                        date.textContent = `Modified: ${modifiedDate.toLocaleDateString()} ${modifiedDate.toLocaleTimeString()}`;
                    }
                    
                    item.appendChild(name);
                    item.appendChild(date);
                    
                    // Handle click
                    item.addEventListener('click', () => {
                        this.documentSelectionModal.classList.add('hidden');
                        // Clear interval when modal closes
                        if (this._documentModalInterval) {
                            clearInterval(this._documentModalInterval);
                            this._documentModalInterval = null;
                        }
                        cleanup();
                        // Note: Don't restore click-through here - window needs to stay interactive
                        // during the writing process. It will be restored after writing completes.
                        resolve(doc.id);
                    });
                    
                    this.documentList.appendChild(item);
                });
            }

            // Handle new document
            const handleNew = () => {
                this.documentSelectionModal.classList.add('hidden');
                // Clear interval when modal closes
                if (this._documentModalInterval) {
                    clearInterval(this._documentModalInterval);
                    this._documentModalInterval = null;
                }
                cleanup();
                // Note: Don't restore click-through here - window needs to stay interactive
                // during the writing process. It will be restored after writing completes.
                // Return special value to indicate new document
                resolve('__NEW_DOC__');
            };

            // Handle cancel
            const handleCancel = () => {
                this.documentSelectionModal.classList.add('hidden');
                // Clear interval when modal closes - do this immediately
                if (this._documentModalInterval) {
                    clearInterval(this._documentModalInterval);
                    this._documentModalInterval = null;
                }
                cleanup();
                // Restore click-through mode immediately and multiple times to ensure it sticks
                if (this.isElectron && window.require) {
                    const { ipcRenderer } = window.require('electron');
                    // Restore click-through immediately
                    ipcRenderer.invoke('make-click-through').catch(() => {});
                    // Also restore after delays to ensure it sticks
                    setTimeout(() => {
                        ipcRenderer.invoke('make-click-through').catch(() => {});
                    }, 50);
                    setTimeout(() => {
                        ipcRenderer.invoke('make-click-through').catch(() => {});
                    }, 200);
                }
                resolve(null);
            };

            // Handle Escape key
            const handleKeyPress = (e) => {
                if (e.key === 'Escape') {
                    handleCancel();
                }
            };

            // Cleanup function
            const cleanup = () => {
                // Clear interval if still running
                if (this._documentModalInterval) {
                    clearInterval(this._documentModalInterval);
                    this._documentModalInterval = null;
                }
                if (this.documentSelectionNew) {
                    this.documentSelectionNew.removeEventListener('click', handleNew);
                }
                if (this.documentSelectionCancel) {
                    this.documentSelectionCancel.removeEventListener('click', handleCancel);
                }
                document.removeEventListener('keydown', handleKeyPress);
            };

            // Check if cancel button exists - if not, log warning but continue (user can use Escape key)
            if (!this.documentSelectionCancel) {
                console.warn('document-selection-cancel button not found, but continuing - user can use Escape key');
            }

            // Add event listeners
            if (this.documentSelectionNew) {
                this.documentSelectionNew.addEventListener('click', handleNew);
            }
            if (this.documentSelectionCancel) {
                this.documentSelectionCancel.addEventListener('click', handleCancel);
            }
            document.addEventListener('keydown', handleKeyPress);
        });
    }

    async promptDocumentIdManual() {
        return new Promise((resolve) => {
            if (!this.documentNameModal || !this.documentNameInput) {
                resolve(null);
                return;
            }

            // Make window interactive when showing modal
            if (this.isElectron && window.require) {
                const { ipcRenderer } = window.require('electron');
                ipcRenderer.invoke('make-interactive').catch(() => {});
            }

            // Update modal title and button text
            const modalTitle = this.documentNameModal.querySelector('h3');
            const confirmBtn = this.documentNameConfirm;
            if (modalTitle) modalTitle.textContent = 'Enter Google Doc ID or URL';
            if (confirmBtn) confirmBtn.textContent = 'Add to Doc';
            
            // Set placeholder
            this.documentNameInput.placeholder = 'Paste document ID or full URL...';
            this.documentNameInput.value = '';
            
            // Show modal
            this.documentNameModal.classList.remove('hidden');
            this.documentNameInput.focus();

            // Handle confirm
            const handleConfirm = () => {
                const input = this.documentNameInput.value.trim();
                this.documentNameModal.classList.add('hidden');
                cleanup();
                
                if (!input) {
                    resolve(null);
                    return;
                }
                
                // Extract document ID from URL if needed
                const docId = this.extractDocumentId(input);
                resolve(docId);
            };

            // Handle cancel
            const handleCancel = () => {
                this.documentNameModal.classList.add('hidden');
                cleanup();
                resolve(null);
            };

            // Handle Enter key
            const handleKeyPress = (e) => {
                if (e.key === 'Enter') {
                    handleConfirm();
                } else if (e.key === 'Escape') {
                    handleCancel();
                }
            };

            // Cleanup function
            const cleanup = () => {
                this.documentNameConfirm.removeEventListener('click', handleConfirm);
                this.documentNameCancel.removeEventListener('click', handleCancel);
                this.documentNameInput.removeEventListener('keydown', handleKeyPress);
                // Reset placeholder
                this.documentNameInput.placeholder = 'Enter document name...';
            };

            // Add event listeners
            this.documentNameConfirm.addEventListener('click', handleConfirm);
            this.documentNameCancel.addEventListener('click', handleCancel);
            this.documentNameInput.addEventListener('keydown', handleKeyPress);
        });
    }

    extractDocumentId(input) {
        // If it's a URL, extract the document ID
        if (input.includes('docs.google.com')) {
            // Match patterns like:
            // https://docs.google.com/document/d/DOCUMENT_ID/edit
            // https://docs.google.com/document/d/DOCUMENT_ID
            const match = input.match(/\/document\/d\/([a-zA-Z0-9-_]+)/);
            if (match && match[1]) {
                return match[1];
            }
        }
        // Otherwise assume it's already a document ID
        return input;
    }

    showDocsWritingIndicator() {
        if (this.docsWritingIndicator) {
            this.docsWritingIndicator.classList.remove('hidden');
        }
        if (this.docsDoneIndicator) {
            this.docsDoneIndicator.classList.add('hidden');
        }
    }

    hideDocsWritingIndicator() {
        if (this.docsWritingIndicator) {
            this.docsWritingIndicator.classList.add('hidden');
        }
    }

    showDocsDoneIndicator(documentUrl) {
        if (this.docsDoneIndicator) {
            // Store document URL for the open button
            this.docsDoneIndicator.dataset.documentUrl = documentUrl || '';
            this.docsDoneIndicator.classList.remove('hidden');
        }
        if (this.docsWritingIndicator) {
            this.docsWritingIndicator.classList.add('hidden');
        }
    }

    hideDocsDoneIndicator() {
        if (this.docsDoneIndicator) {
            this.docsDoneIndicator.classList.add('hidden');
        }
    }

    openGoogleDoc() {
        if (this.docsDoneIndicator && this.docsDoneIndicator.dataset.documentUrl) {
            const url = this.docsDoneIndicator.dataset.documentUrl;
            if (this.isElectron && window.require) {
                const { shell } = window.require('electron');
                shell.openExternal(url);
            } else {
                window.open(url, '_blank');
            }
            // Hide the indicator after opening
            this.hideDocsDoneIndicator();
        }
    }

    async writeToDocs(usePasteMode = false) {
        if (!this.dragOutput || this.dragOutput.classList.contains('hidden')) {
            this.showNotification('No content to write to Docs', false);
            return;
        }

        // Get HTML content to preserve table structure
        const htmlContent = this.dragOutput.innerHTML || '';
        
        // Get clean text from the output (without HTML/markdown) for fallback
        const cleanText = this.dragOutput.dataset.fullText || 
                         this.dragOutput.textContent || 
                         this.stripMarkdown(this.dragOutput.innerHTML).replace(/<[^>]*>/g, '').trim();

        if (!cleanText || cleanText.length === 0) {
            this.showNotification('No content available to write', false);
            return;
        }

        if (!this.isElectron || !window.require) {
            // Fallback: copy to clipboard
            try {
                await navigator.clipboard.writeText(cleanText);
                this.showNotification('Content copied to clipboard! Paste it into Google Docs.', false);
            } catch (error) {
                this.showNotification('Failed to copy content. Please copy manually.', false);
            }
            return;
        }

        try {
            const { ipcRenderer } = window.require('electron');
            
            // Show document selection modal directly (with New Doc button)
            console.log('Calling promptDocumentId() to show document selection modal');
            let documentId = await this.promptDocumentId();
            
            if (!documentId) {
                // User cancelled - click-through should already be restored by cancel handler
                console.log('User cancelled document selection');
                return;
            }
            
            let documentName = null;
            
            // Check if user clicked "New Doc" button
            if (documentId === '__NEW_DOC__') {
                // Prompt for document name
                documentName = await this.promptDocumentName(`Jarvis Output - ${new Date().toLocaleDateString()}`);
                
                if (documentName === null) {
                    // User cancelled
                    return;
                }
                documentId = null; // Will create new document
            }
            
            // Check authentication status first
            const authStatus = await ipcRenderer.invoke('google-docs-auth-status');
            
            if (!authStatus.authenticated) {
                // Not authenticated - prompt user to authenticate
                const shouldAuthenticate = confirm(
                    'Google Docs authentication required.\n\n' +
                    'Click OK to authenticate with Google Docs.\n' +
                    'This will open a browser window for authentication.'
                );
                
                if (!shouldAuthenticate) {
                    return;
                }
                
                this.showNotification('Authenticating with Google Docs...', false);
                const authResult = await ipcRenderer.invoke('google-docs-authenticate');
                
                if (!authResult.success || !authResult.authenticated) {
                    const errorMsg = authResult.error || 'Authentication failed';
                    this.showNotification(`❌ Authentication failed: ${errorMsg}`, false);
                    return;
                }
            }
            
            // Show writing indicator
            this.showDocsWritingIndicator();
            
            // Prepare options
            const options = {};
            if (documentId) {
                options.documentId = documentId;
            } else {
                options.title = documentName || `Jarvis Output - ${new Date().toLocaleString()}`;
            }
            
            // Write to Google Docs (with or without realistic typing based on mode)
            // Pass HTML content to preserve table structure
            const writeMethod = usePasteMode ? 'write-to-docs' : 'write-to-docs-realistic';
            ipcRenderer.invoke(writeMethod, htmlContent || cleanText, options).then(result => {
                // Hide writing indicator
                this.hideDocsWritingIndicator();
                
                if (result && result.success) {
                    // Always show done indicator with open button if we have a URL
                    const documentUrl = result.documentUrl || (result.documentId ? `https://docs.google.com/document/d/${result.documentId}` : null);
                    if (documentUrl) {
                        this.showDocsDoneIndicator(documentUrl);
                    } else {
                        // Fallback: show notification if no URL available
                        const successMsg = usePasteMode 
                            ? '✅ Document created successfully!' 
                            : '✅ Document typed successfully!';
                        this.showNotification(successMsg, false);
                    }
                } else {
                    const errorMsg = result?.error || result?.message || 'Failed to write to Google Docs';
                    
                    // Check if re-authentication is required
                    if (result?.requiresReauth || errorMsg.includes('insufficient authentication scopes') || errorMsg.includes('Insufficient Permission')) {
                        // Show notification
                        this.showNotification(`⚠️ Re-authentication required for Google Docs.\n\nOpening Account settings...`, false);
                        // Clear authentication status to force re-auth
                        ipcRenderer.invoke('google-docs-sign-out').catch(() => {});
                        // Open account window after a short delay
                        setTimeout(() => {
                            this.showAccountWindow();
                        }, 1000);
                    } else if (errorMsg.includes('OAuth') || errorMsg.includes('credentials') || errorMsg.includes('not configured')) {
                        this.showNotification(`❌ ${errorMsg}\n\nPlease check your Google OAuth credentials.`, false);
                    } else if (errorMsg.includes('not found') || errorMsg.includes('permission')) {
                        this.showNotification(`❌ ${errorMsg}\n\nPlease check that the document ID is correct and you have access to it.`, false);
                    } else {
                        this.showNotification(`❌ ${errorMsg}`, false);
                    }
                }
            }).catch(error => {
                // Hide writing indicator on error
                this.hideDocsWritingIndicator();
                console.error('Error writing to Docs:', error);
                // Don't show error notifications for charBuffer or internal variable names
                const errorMsg = error?.message || String(error) || '';
                const lowerErrorMsg = errorMsg.toLowerCase();
                // Filter out internal variable errors
                if (!lowerErrorMsg.includes('charbuffer') && 
                    !lowerErrorMsg.includes('charbuffer is not defined') &&
                    !lowerErrorMsg.includes('bufferindex') &&
                    !lowerErrorMsg.includes('currentindex')) {
                    this.showNotification(`❌ Error: ${errorMsg}`, false);
                } else {
                    // If it's an internal error but writing might have succeeded, try to show success
                    console.warn('Internal error detected, but writing may have completed:', errorMsg);
                }
            });
            
        } catch (error) {
            console.error('Error writing to Docs:', error);
            this.hideDocsWritingIndicator();
            // Don't show error notifications for charBuffer or internal variable names
            const errorMsg = error?.message || String(error);
            if (!errorMsg.toLowerCase().includes('charbuffer')) {
                this.showNotification(`❌ Error: ${errorMsg}`, false);
            }
        }
    }

    async createCalendarEventFromText(text) {
        if (!this.isElectron || !window.require) {
            this.showNotification('Calendar integration requires Electron', false);
            return;
        }

        try {
            const { ipcRenderer } = window.require('electron');
            
            // Check authentication status first
            const authStatus = await ipcRenderer.invoke('google-calendar-auth-status');
            
            if (!authStatus.authenticated) {
                const shouldAuthenticate = confirm(
                    'Google Calendar authentication required.\n\n' +
                    'Click OK to authenticate with Google Calendar.\n' +
                    'This will open a browser window for authentication.'
                );
                
                if (!shouldAuthenticate) {
                    return;
                }
                
                this.showNotification('Authenticating with Google Calendar...', false);
                const authResult = await ipcRenderer.invoke('google-calendar-authenticate');
                
                if (!authResult.success || !authResult.authenticated) {
                    const errorMsg = authResult.error || 'Authentication failed';
                    this.showNotification(`❌ Authentication failed: ${errorMsg}`, false);
                    return;
                }
            }
            
            // Extract event details from text using AI
            this.showNotification('Extracting event details...', false);
            const eventData = await this.extractEventDetailsFromText(text);
            
            if (!eventData) {
                this.showNotification('Could not extract event details. Please try the /calendar command to create an event manually.', false);
                return;
            }
            
            // Show confirmation modal with extracted details
            const confirmedEventData = await this.promptCalendarEvent(eventData);
            
            if (!confirmedEventData) {
                // User cancelled
                return;
            }
            
            // Create the event
            this.showNotification('Creating calendar event...', false);
            const result = await ipcRenderer.invoke('create-calendar-event', confirmedEventData);
            
            if (result && result.success) {
                const eventLink = result.htmlLink || '';
                const successMsg = eventLink 
                    ? `✅ Event created! <a href="${eventLink}" target="_blank" style="color: #4A9EFF; text-decoration: underline;">Open in Calendar</a>`
                    : '✅ Event created successfully!';
                this.showNotification(successMsg, true);
            } else {
                const errorMsg = result?.error || 'Failed to create calendar event';
                this.showNotification(`❌ ${errorMsg}`, false);
            }
        } catch (error) {
            console.error('Error creating calendar event from text:', error);
            this.showNotification(`❌ Error: ${error.message}`, false);
        }
    }

    async extractEventDetailsFromText(text) {
        try {
            const now = new Date();
            const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
            const currentDateStr = now.toLocaleDateString('en-US', { timeZone: timezone });
            const currentTimeStr = now.toLocaleTimeString('en-US', { timeZone: timezone, hour12: false });
            
            const prompt = `Extract calendar event information from this text: "${text}"

Look for:
- Event title/name
- Date and time (relative dates like "today", "tomorrow", "tonight" should be converted to actual dates)
- Duration or end time
- Location (if mentioned)
- Description/details

Return ONLY a JSON object with this exact structure (use null for missing fields):
{
  "summary": "Event title",
  "startDateTime": "2024-01-15T20:00:00" (ISO format in LOCAL timezone, NOT UTC),
  "endDateTime": "2024-01-15T21:00:00" (ISO format in LOCAL timezone, default to 1 hour after start if not specified),
  "location": "Location if found",
  "description": "Description if found"
}

CRITICAL TIME CONVERSION RULES:
- "8pm" or "8 pm" = 20:00 (8 PM) in 24-hour format
- "8:30pm" = 20:30 (8:30 PM)
- "2pm" = 14:00 (2 PM)
- "10am" = 10:00 (10 AM)
- "midnight" = 00:00 (12:00 AM)
- "noon" = 12:00 (12:00 PM)

DATE CONVERSION:
- "today" = ${currentDateStr}
- "tomorrow" = tomorrow's date
- "tonight" = ${currentDateStr} with evening time (after 6pm)
- If only time is given (e.g., "8pm"), use ${currentDateStr} as the date

Current reference:
- Date: ${currentDateStr}
- Time: ${currentTimeStr}
- Timezone: ${timezone}

IMPORTANT: When creating the ISO string, use the LOCAL date and time. For example:
- If user says "dinner 8pm" and today is ${currentDateStr}, return: "${now.toISOString().split('T')[0]}T20:00:00"
- The time should be in 24-hour format: 8pm = 20:00, NOT 08:00

If you cannot find clear event information, return null. Be precise with dates and times.`;

            // Use IPC to call OpenAI API
            if (this.isElectron && window.require) {
                const { ipcRenderer } = window.require('electron');
                
                const requestPayload = {
                    model: this.currentModel,
                    instructions: 'Extract calendar event details from the text. Return ONLY valid JSON or null.',
                    input: [{
                        role: 'user',
                        content: [
                            { type: 'input_text', text: prompt }
                        ]
                    }]
                };
                
                const result = await ipcRenderer.invoke('call-openai-api', requestPayload);
                
                // Check if it's a limit exceeded error
                if (result?.status === 429 && result?.data?.costLimitDollars !== undefined) {
                    console.error('🚫 Calendar parsing blocked - limit exceeded');
                    this.showLimitExceededNotification();
                    return { limitExceeded: true };
                }
                
                if (result && result.ok && result.data) {
                    const responseText = this.extractText(result.data) || '';
                    
                    // Try to extract JSON from the response
                    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        try {
                            const eventData = JSON.parse(jsonMatch[0]);
                            
                            // Validate and format the event data
                            if (eventData.summary && eventData.startDateTime) {
                                // Ensure endDateTime exists, default to 1 hour after start
                                if (!eventData.endDateTime && eventData.startDateTime) {
                                    const start = new Date(eventData.startDateTime);
                                    start.setHours(start.getHours() + 1);
                                    eventData.endDateTime = start.toISOString();
                                }
                                
                                // Validate dates
                                const startDate = new Date(eventData.startDateTime);
                                const endDate = new Date(eventData.endDateTime);
                                
                                if (isNaN(startDate.getTime())) {
                                    console.error('Invalid start date:', eventData.startDateTime);
                                    return null;
                                }
                                
                                if (isNaN(endDate.getTime())) {
                                    endDate.setTime(startDate.getTime() + 60 * 60 * 1000); // 1 hour default
                                    eventData.endDateTime = endDate.toISOString();
                                }
                                
                                // Add timezone
                                eventData.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
                                
                                return eventData;
                            }
                        } catch (parseError) {
                            console.error('Failed to parse event JSON:', parseError);
                            console.error('Response text:', responseText);
                        }
                    }
                }
            }
            
            // Fallback: try direct API call
            // Always use Edge Function - API keys stored in Supabase Secrets
            if (!this.apiProxyUrl || !this.supabaseAnonKey) {
                throw new Error('API keys must be stored in Supabase Edge Function Secrets.');
            }
            
            const response = await fetch(this.apiProxyUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.supabaseAnonKey}`,
                    'Content-Type': 'application/json',
                    'apikey': this.supabaseAnonKey
                },
                body: JSON.stringify({
                    provider: 'openai',
                    endpoint: 'responses',
                    payload: {
                        model: this.currentModel,
                        instructions: 'Extract calendar event details from the text. Return ONLY valid JSON or null.',
                        input: [{
                            role: 'user',
                            content: [
                                { type: 'input_text', text: prompt }
                            ]
                        }]
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            const responseText = this.extractText(data) || '';
            
            // Try to extract JSON from the response
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const eventData = JSON.parse(jsonMatch[0]);
                    
                    if (eventData.summary && eventData.startDateTime) {
                        if (!eventData.endDateTime && eventData.startDateTime) {
                            const start = new Date(eventData.startDateTime);
                            start.setHours(start.getHours() + 1);
                            eventData.endDateTime = start.toISOString();
                        }
                        
                        // Validate dates
                        const startDate = new Date(eventData.startDateTime);
                        const endDate = new Date(eventData.endDateTime);
                        
                        if (isNaN(startDate.getTime())) {
                            return null;
                        }
                        
                        if (isNaN(endDate.getTime())) {
                            endDate.setTime(startDate.getTime() + 60 * 60 * 1000);
                            eventData.endDateTime = endDate.toISOString();
                        }
                        
                        eventData.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
                        
                        return eventData;
                    }
                } catch (parseError) {
                    console.error('Failed to parse event JSON:', parseError);
                }
            }
            
            return null;
        } catch (error) {
            console.error('Error extracting event details:', error);
            return null;
        }
    }

    async createCalendarEventFromScreenshot() {
        if (!this.isElectron || !window.require) {
            this.showNotification('Calendar integration requires Electron', false);
            return;
        }

        try {
            const { ipcRenderer } = window.require('electron');
            
            // Check authentication status first
            const authStatus = await ipcRenderer.invoke('google-calendar-auth-status');
            
            if (!authStatus.authenticated) {
                const shouldAuthenticate = confirm(
                    'Google Calendar authentication required.\n\n' +
                    'Click OK to authenticate with Google Calendar.\n' +
                    'This will open a browser window for authentication.'
                );
                
                if (!shouldAuthenticate) {
                    return;
                }
                
                this.showNotification('Authenticating with Google Calendar...', false);
                const authResult = await ipcRenderer.invoke('google-calendar-authenticate');
                
                if (!authResult.success || !authResult.authenticated) {
                    const errorMsg = authResult.error || 'Authentication failed';
                    this.showNotification(`❌ Authentication failed: ${errorMsg}`, false);
                    return;
                }
            }
            
            // Take screenshot
            this.showNotification('Taking screenshot...', false);
            await this.captureScreen();
            
            if (!this.currentScreenCapture) {
                this.showNotification('Failed to capture screenshot', false);
                return;
            }
            
            // Extract event details from screenshot using AI
            this.showNotification('Analyzing screenshot for event details...', false);
            const eventData = await this.extractEventDetailsFromScreenshot(this.currentScreenCapture);
            
            if (!eventData) {
                this.showNotification('Could not extract event details from screenshot. Please try the /calendar command to create an event manually.', false);
                return;
            }
            
            // Show confirmation modal with extracted details
            const confirmedEventData = await this.promptCalendarEvent(eventData);
            
            if (!confirmedEventData) {
                // User cancelled
                return;
            }
            
            // Create the event
            this.showNotification('Creating calendar event...', false);
            const result = await ipcRenderer.invoke('create-calendar-event', confirmedEventData);
            
            if (result && result.success) {
                const eventLink = result.htmlLink || '';
                const successMsg = eventLink 
                    ? `✅ Event created! <a href="${eventLink}" target="_blank" style="color: #4A9EFF; text-decoration: underline;">Open in Calendar</a>`
                    : '✅ Event created successfully!';
                this.showNotification(successMsg, true);
            } else {
                const errorMsg = result?.error || 'Failed to create calendar event';
                this.showNotification(`❌ ${errorMsg}`, false);
            }
        } catch (error) {
            console.error('Error creating calendar event from screenshot:', error);
            this.showNotification(`❌ Error: ${error.message}`, false);
        }
    }

    async extractEventDetailsFromScreenshot(imageUrl) {
        try {
            const prompt = `Analyze this screenshot and extract calendar event information. Look for:
- Event title/name
- Date and time
- Duration or end time
- Location (if mentioned)
- Description/details

Return ONLY a JSON object with this exact structure (use null for missing fields):
{
  "summary": "Event title",
  "startDateTime": "2024-01-15T10:00:00" (ISO format),
  "endDateTime": "2024-01-15T11:00:00" (ISO format),
  "location": "Location if found",
  "description": "Description if found"
}

If you cannot find clear event information, return null. Be precise with dates and times.`;

            // Use IPC to call OpenAI API with vision
            if (this.isElectron && window.require) {
                const { ipcRenderer } = window.require('electron');
                
                const requestPayload = {
                    model: this.currentModel,
                    instructions: 'Extract calendar event details from the screenshot. Return ONLY valid JSON or null.',
                    input: [{
                        role: 'user',
                        content: [
                            { type: 'input_text', text: prompt },
                            { type: 'input_image', image_url: imageUrl }
                        ]
                    }]
                };
                
                const result = await ipcRenderer.invoke('call-openai-api', requestPayload);
                
                // Check if it's a limit exceeded error
                if (result?.status === 429 && result?.data?.costLimitDollars !== undefined) {
                    console.error('🚫 Image calendar parsing blocked - limit exceeded');
                    this.showLimitExceededNotification();
                    return { limitExceeded: true };
                }
                
                if (result && result.ok && result.data) {
                    const responseText = this.extractText(result.data) || '';
                    
                    // Try to extract JSON from the response
                    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        try {
                            const eventData = JSON.parse(jsonMatch[0]);
                            
                            // Validate and format the event data
                            if (eventData.summary && eventData.startDateTime) {
                                // Ensure endDateTime exists, default to 1 hour after start
                                if (!eventData.endDateTime && eventData.startDateTime) {
                                    const start = new Date(eventData.startDateTime);
                                    start.setHours(start.getHours() + 1);
                                    eventData.endDateTime = start.toISOString();
                                }
                                
                                // Add timezone
                                eventData.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
                                
                                return eventData;
                            }
                        } catch (parseError) {
                            console.error('Failed to parse event JSON:', parseError);
                        }
                    }
                }
            }
            
            // Fallback: try direct API call
            // Always use Edge Function - API keys stored in Supabase Secrets
            if (!this.apiProxyUrl || !this.supabaseAnonKey) {
                throw new Error('API keys must be stored in Supabase Edge Function Secrets.');
            }
            
            const response = await fetch(this.apiProxyUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.supabaseAnonKey}`,
                    'Content-Type': 'application/json',
                    'apikey': this.supabaseAnonKey
                },
                body: JSON.stringify({
                    provider: 'openai',
                    endpoint: 'responses',
                    payload: {
                        model: this.currentModel,
                        instructions: 'Extract calendar event details from the screenshot. Return ONLY valid JSON or null.',
                        input: [{
                            role: 'user',
                            content: [
                                { type: 'input_text', text: prompt },
                                { type: 'input_image', image_url: imageUrl }
                            ]
                        }]
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            const responseText = this.extractText(data) || '';
            
            // Try to extract JSON from the response
            const jsonMatch = responseText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    const eventData = JSON.parse(jsonMatch[0]);
                    
                    if (eventData.summary && eventData.startDateTime) {
                        if (!eventData.endDateTime && eventData.startDateTime) {
                            const start = new Date(eventData.startDateTime);
                            start.setHours(start.getHours() + 1);
                            eventData.endDateTime = start.toISOString();
                        }
                        
                        eventData.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
                        
                        return eventData;
                    }
                } catch (parseError) {
                    console.error('Failed to parse event JSON:', parseError);
                }
            }
            
            return null;
        } catch (error) {
            console.error('Error extracting event details:', error);
            return null;
        }
    }

    async createCalendarEvent() {
        if (!this.isElectron || !window.require) {
            this.showNotification('Calendar integration requires Electron', false);
            return;
        }

        try {
            const { ipcRenderer } = window.require('electron');
            
            // Check authentication status first
            const authStatus = await ipcRenderer.invoke('google-calendar-auth-status');
            
            if (!authStatus.authenticated) {
                // Not authenticated - prompt user to authenticate
                const shouldAuthenticate = confirm(
                    'Google Calendar authentication required.\n\n' +
                    'Click OK to authenticate with Google Calendar.\n' +
                    'This will open a browser window for authentication.'
                );
                
                if (!shouldAuthenticate) {
                    return;
                }
                
                this.showNotification('Authenticating with Google Calendar...', false);
                const authResult = await ipcRenderer.invoke('google-calendar-authenticate');
                
                if (!authResult.success || !authResult.authenticated) {
                    const errorMsg = authResult.error || 'Authentication failed';
                    this.showNotification(`❌ Authentication failed: ${errorMsg}`, false);
                    return;
                }
            }
            
            // Show calendar event modal
            const eventData = await this.promptCalendarEvent();
            
            if (!eventData) {
                // User cancelled
                return;
            }
            
            // Create the event
            this.showNotification('Creating calendar event...', false);
            const result = await ipcRenderer.invoke('create-calendar-event', eventData);
            
            if (result && result.success) {
                const eventLink = result.htmlLink || '';
                const successMsg = eventLink 
                    ? `✅ Event created! <a href="${eventLink}" target="_blank" style="color: #4A9EFF; text-decoration: underline;">Open in Calendar</a>`
                    : '✅ Event created successfully!';
                this.showNotification(successMsg, true);
            } else {
                const errorMsg = result?.error || 'Failed to create calendar event';
                this.showNotification(`❌ ${errorMsg}`, false);
            }
        } catch (error) {
            console.error('Error creating calendar event:', error);
            this.showNotification(`❌ Error: ${error.message}`, false);
        }
    }

    async promptCalendarEvent(prefilledData = null) {
        return new Promise((resolve) => {
            const modal = document.getElementById('calendar-event-modal');
            const titleInput = document.getElementById('calendar-event-title');
            const datetimeInput = document.getElementById('calendar-event-datetime');
            const durationInput = document.getElementById('calendar-event-duration');
            const descriptionInput = document.getElementById('calendar-event-description');
            const locationInput = document.getElementById('calendar-event-location');
            const confirmBtn = document.getElementById('calendar-event-confirm');
            const cancelBtn = document.getElementById('calendar-event-cancel');
            
            // Fill in prefilled data if provided, otherwise use defaults
            if (prefilledData) {
                titleInput.value = prefilledData.summary || '';
                if (prefilledData.startDateTime) {
                    const startDate = new Date(prefilledData.startDateTime);
                    // Convert to local time for datetime-local input (format: YYYY-MM-DDTHH:mm)
                    const year = startDate.getFullYear();
                    const month = String(startDate.getMonth() + 1).padStart(2, '0');
                    const day = String(startDate.getDate()).padStart(2, '0');
                    const hours = String(startDate.getHours()).padStart(2, '0');
                    const minutes = String(startDate.getMinutes()).padStart(2, '0');
                    datetimeInput.value = `${year}-${month}-${day}T${hours}:${minutes}`;
                    
                    // Calculate duration
                    if (prefilledData.endDateTime) {
                        const endDate = new Date(prefilledData.endDateTime);
                        const durationHours = (endDate - startDate) / (1000 * 60 * 60);
                        durationInput.value = durationHours.toFixed(1);
                    } else {
                        durationInput.value = '1';
                    }
                } else {
                    // Set default datetime to next hour
                    const now = new Date();
                    now.setHours(now.getHours() + 1);
                    now.setMinutes(0);
                    datetimeInput.value = now.toISOString().slice(0, 16);
                    durationInput.value = '1';
                }
                descriptionInput.value = prefilledData.description || '';
                locationInput.value = prefilledData.location || '';
            } else {
                // Set default datetime to next hour
                const now = new Date();
                now.setHours(now.getHours() + 1);
                now.setMinutes(0);
                datetimeInput.value = now.toISOString().slice(0, 16);
                
                // Clear inputs
                titleInput.value = '';
                durationInput.value = '1';
                descriptionInput.value = '';
                locationInput.value = '';
            }
            
            // Show modal
            modal.classList.remove('hidden');
            
            // Focus title input
            setTimeout(() => titleInput.focus(), 100);
            
            const handleConfirm = () => {
                const title = titleInput.value.trim();
                const datetime = datetimeInput.value;
                const duration = parseFloat(durationInput.value) || 1;
                const description = descriptionInput.value.trim();
                const location = locationInput.value.trim();
                
                if (!title) {
                    alert('Please enter an event title');
                    return;
                }
                
                if (!datetime) {
                    alert('Please select a date and time');
                    return;
                }
                
                // Convert datetime to ISO format
                const startDateTime = new Date(datetime).toISOString();
                const endDateTime = new Date(new Date(datetime).getTime() + duration * 60 * 60 * 1000).toISOString();
                
                // Clean up listeners
                confirmBtn.removeEventListener('click', handleConfirm);
                cancelBtn.removeEventListener('click', handleCancel);
                
                modal.classList.add('hidden');
                
                resolve({
                    summary: title,
                    description: description,
                    startDateTime: startDateTime,
                    endDateTime: endDateTime,
                    location: location,
                    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York'
                });
            };
            
            const handleCancel = () => {
                // Clean up listeners
                confirmBtn.removeEventListener('click', handleConfirm);
                cancelBtn.removeEventListener('click', handleCancel);
                
                modal.classList.add('hidden');
                resolve(null);
            };
            
            // Handle Enter key on title input
            const handleTitleKeyPress = (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    handleConfirm();
                }
            };
            
            titleInput.addEventListener('keypress', handleTitleKeyPress);
            confirmBtn.addEventListener('click', handleConfirm);
            cancelBtn.addEventListener('click', handleCancel);
        });
    }

    async getTodaysEmails() {
        if (!this.isElectron || !window.require) {
            this.showNotification('Gmail integration requires Electron', false);
            return;
        }

        try {
            const { ipcRenderer } = window.require('electron');
            
            // Check authentication status
            const authStatus = await ipcRenderer.invoke('gmail-auth-status');
            
            if (!authStatus.authenticated) {
                const shouldAuthenticate = confirm(
                    'Gmail authentication required.\n\n' +
                    'Click OK to authenticate with Gmail.\n' +
                    'This will open a browser window for authentication.'
                );
                
                if (!shouldAuthenticate) {
                    return;
                }
                
                this.showNotification('Authenticating with Gmail...', false);
                const authResult = await ipcRenderer.invoke('gmail-authenticate');
                
                if (!authResult.success || !authResult.authenticated) {
                    const errorMsg = authResult.error || 'Authentication failed';
                    this.showNotification(`❌ Authentication failed: ${errorMsg}`, false);
                    return;
                }
            }
            
            this.showNotification('Fetching today\'s emails...', false);
            const result = await ipcRenderer.invoke('gmail-todays-emails', 20);
            
            if (result && result.success) {
                await this.displayEmails(result.emails, 'Today\'s Emails');
            } else {
                const errorMsg = result?.error || 'Failed to fetch emails';
                this.showNotification(`❌ ${errorMsg}`, false);
            }
        } catch (error) {
            console.error('Error getting today\'s emails:', error);
            this.showNotification(`❌ Error: ${error.message}`, false);
        }
    }

    async getImportantEmails() {
        if (!this.isElectron || !window.require) {
            this.showNotification('Gmail integration requires Electron', false);
            return;
        }

        try {
            const { ipcRenderer } = window.require('electron');
            
            // Check authentication status
            const authStatus = await ipcRenderer.invoke('gmail-auth-status');
            
            if (!authStatus.authenticated) {
                const shouldAuthenticate = confirm(
                    'Gmail authentication required.\n\n' +
                    'Click OK to authenticate with Gmail.\n' +
                    'This will open a browser window for authentication.'
                );
                
                if (!shouldAuthenticate) {
                    return;
                }
                
                this.showNotification('Authenticating with Gmail...', false);
                const authResult = await ipcRenderer.invoke('gmail-authenticate');
                
                if (!authResult.success || !authResult.authenticated) {
                    const errorMsg = authResult.error || 'Authentication failed';
                    this.showNotification(`❌ Authentication failed: ${errorMsg}`, false);
                    return;
                }
            }
            
            this.showNotification('Fetching important emails...', false);
            const result = await ipcRenderer.invoke('gmail-important-emails', 10);
            
            if (result && result.success) {
                await this.displayEmails(result.emails, 'Important Emails');
            } else {
                const errorMsg = result?.error || 'Failed to fetch emails';
                this.showNotification(`❌ ${errorMsg}`, false);
            }
        } catch (error) {
            console.error('Error getting important emails:', error);
            this.showNotification(`❌ Error: ${error.message}`, false);
        }
    }

    async getUnreadEmails() {
        if (!this.isElectron || !window.require) {
            this.showNotification('Gmail integration requires Electron', false);
            return;
        }

        try {
            const { ipcRenderer } = window.require('electron');
            
            // Check authentication status
            const authStatus = await ipcRenderer.invoke('gmail-auth-status');
            
            if (!authStatus.authenticated) {
                const shouldAuthenticate = confirm(
                    'Gmail authentication required.\n\n' +
                    'Click OK to authenticate with Gmail.\n' +
                    'This will open a browser window for authentication.'
                );
                
                if (!shouldAuthenticate) {
                    return;
                }
                
                this.showNotification('Authenticating with Gmail...', false);
                const authResult = await ipcRenderer.invoke('gmail-authenticate');
                
                if (!authResult.success || !authResult.authenticated) {
                    const errorMsg = authResult.error || 'Authentication failed';
                    this.showNotification(`❌ Authentication failed: ${errorMsg}`, false);
                    return;
                }
            }
            
            this.showNotification('Fetching unread emails...', false);
            const result = await ipcRenderer.invoke('gmail-unread-emails', 20);
            
            if (result && result.success) {
                await this.displayEmails(result.emails, 'Unread Emails');
            } else {
                const errorMsg = result?.error || 'Failed to fetch emails';
                this.showNotification(`❌ ${errorMsg}`, false);
            }
        } catch (error) {
            console.error('Error getting unread emails:', error);
            this.showNotification(`❌ Error: ${error.message}`, false);
        }
    }

    async displayEmails(emails, title) {
        if (!emails || emails.length === 0) {
            this.showNotification(`No emails found.`, false);
            return;
        }

        let emailHtml = `<h3 style="margin-bottom: 15px; color: #fff;">${title} (${emails.length})</h3>`;
        
        emails.forEach((email, index) => {
            const fromName = email.from.split('<')[0].trim() || email.from;
            const fromEmail = email.from.match(/<(.+)>/)?.[1] || email.from;
            const date = new Date(email.date).toLocaleString();
            const isUnread = email.isUnread ? 'font-weight: bold;' : '';
            const importantBadge = email.isImportant ? '<span style="color: #ff6b6b; margin-left: 8px;">⭐ Important</span>' : '';
            
            emailHtml += `
                <div style="margin-bottom: 20px; padding: 12px; background: rgba(255, 255, 255, 0.05); border-radius: 8px; border-left: 3px solid ${email.isUnread ? '#4A9EFF' : 'transparent'};">
                    <div style="${isUnread} color: #fff; margin-bottom: 6px;">
                        <strong>${this.escapeHtml(email.subject || '(No Subject)')}</strong>${importantBadge}
                    </div>
                    <div style="color: rgba(255, 255, 255, 0.7); font-size: 13px; margin-bottom: 4px;">
                        From: ${this.escapeHtml(fromName)} ${fromEmail !== fromName ? `<span style="color: rgba(255, 255, 255, 0.5);">(${this.escapeHtml(fromEmail)})</span>` : ''}
                    </div>
                    <div style="color: rgba(255, 255, 255, 0.6); font-size: 12px; margin-bottom: 6px;">
                        ${date}
                    </div>
                    <div style="color: rgba(255, 255, 255, 0.8); font-size: 13px; line-height: 1.4;">
                        ${this.escapeHtml(email.snippet || 'No preview available')}
                    </div>
                </div>
            `;
        });
        
        this.showNotification(emailHtml, true);
    }

    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    async getUpcomingEvents() {
        if (!this.isElectron || !window.require) {
            this.showNotification('Calendar integration requires Electron', false);
            return;
        }

        try {
            const { ipcRenderer } = window.require('electron');
            
            // Check authentication status
            const authStatus = await ipcRenderer.invoke('google-calendar-auth-status');
            
            if (!authStatus.authenticated) {
                const shouldAuthenticate = confirm(
                    'Google Calendar authentication required.\n\n' +
                    'Click OK to authenticate with Google Calendar.\n' +
                    'This will open a browser window for authentication.'
                );
                
                if (!shouldAuthenticate) {
                    return;
                }
                
                this.showNotification('Authenticating with Google Calendar...', false);
                const authResult = await ipcRenderer.invoke('google-calendar-authenticate');
                
                if (!authResult.success || !authResult.authenticated) {
                    const errorMsg = authResult.error || 'Authentication failed';
                    this.showNotification(`❌ Authentication failed: ${errorMsg}`, false);
                    return;
                }
            }
            
            this.showNotification('Fetching upcoming events...', false);
            const result = await ipcRenderer.invoke('list-calendar-events', 10);
            
            if (result && result.success) {
                await this.displayCalendarEvents(result.events);
            } else {
                const errorMsg = result?.error || 'Failed to fetch calendar events';
                this.showNotification(`❌ ${errorMsg}`, false);
            }
        } catch (error) {
            console.error('Error getting calendar events:', error);
            this.showNotification(`❌ Error: ${error.message}`, false);
        }
    }

    async displayCalendarEvents(events) {
        if (!events || events.length === 0) {
            this.showNotification('📅 No upcoming events found.', false);
            return;
        }

        let eventsHtml = `<h3 style="margin-bottom: 15px; color: #fff;">📅 Upcoming Events (${events.length})</h3>`;
        
        events.forEach((event, index) => {
            const startTime = event.start?.dateTime || event.start?.date;
            const endTime = event.end?.dateTime || event.end?.date;
            
            let dateStr = '';
            if (startTime) {
                const start = new Date(startTime);
                const end = endTime ? new Date(endTime) : null;
                
                const isAllDay = !event.start?.dateTime;
                
                if (isAllDay) {
                    dateStr = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                } else {
                    const today = new Date();
                    const tomorrow = new Date(today);
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    
                    let dayStr = start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                    if (start.toDateString() === today.toDateString()) {
                        dayStr = 'Today';
                    } else if (start.toDateString() === tomorrow.toDateString()) {
                        dayStr = 'Tomorrow';
                    }
                    
                    const timeStr = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                    dateStr = `${dayStr} at ${timeStr}`;
                    
                    if (end) {
                        const endTimeStr = end.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                        dateStr += ` - ${endTimeStr}`;
                    }
                }
            }
            
            const location = event.location ? `<div style="color: rgba(255, 255, 255, 0.6); font-size: 12px; margin-top: 4px;">📍 ${this.escapeHtml(event.location)}</div>` : '';
            
            eventsHtml += `
                <div style="margin-bottom: 16px; padding: 12px; background: rgba(99, 102, 241, 0.1); border-radius: 10px; border-left: 3px solid #6366f1;">
                    <div style="color: #fff; font-weight: 600; margin-bottom: 4px;">
                        ${this.escapeHtml(event.summary || '(No Title)')}
                    </div>
                    <div style="color: rgba(255, 255, 255, 0.8); font-size: 13px;">
                        🕐 ${dateStr}
                    </div>
                    ${location}
                </div>
            `;
        });
        
        this.showNotification(eventsHtml, true);
    }

    positionFloatingClose() {
        try {
            if (!this.closeOutputFloating) return;
            
            // Position relative to messages container (always at top-right of container)
            if (this.messagesContainer && !this.messagesContainer.classList.contains('hidden')) {
                const containerRect = this.messagesContainer.getBoundingClientRect();
                const overlayRect = this.overlay.getBoundingClientRect();
                
                // Position at top-right of messages container
                const topPosition = containerRect.top - overlayRect.top - 8;
                const rightPosition = overlayRect.width - (containerRect.right - overlayRect.left) - 4;
                
                this.closeOutputFloating.style.top = `${topPosition}px`;
                this.closeOutputFloating.style.right = `${rightPosition}px`;
                this.closeOutputFloating.style.left = 'auto';
                this.closeOutputFloating.style.display = 'block';
                this.closeOutputFloating.style.position = 'absolute';
                this.closeOutputFloating.classList.remove('hidden');
            } else {
                // Hide if no messages container visible
                this.closeOutputFloating.classList.add('hidden');
            }
        } catch (error) {
            console.error('Error in positionFloatingClose:', error);
        }
    }

    hideOverlay() {
        if (this.isElectron) {
            const { ipcRenderer } = require('electron');
            ipcRenderer.invoke('hide-overlay');
        } else {
            this.overlay.classList.add('hidden');
        }
    }

    hideOutput() {
        if (this.messagesContainer) {
            this.messagesContainer.classList.add('hidden');
        }
        if (this.dragOutput) {
            this.dragOutput.classList.add('hidden');
        }
        if (this.closeOutputFloating) {
            this.closeOutputFloating.classList.add('hidden');
        }
        // Hide reveal history button
        if (this.revealHistoryBtn) {
            this.revealHistoryBtn.classList.add('hidden');
            this.revealHistoryBtn.classList.remove('rotated');
        }
        // Move answer this button back under HUD
        if (this.answerThisBtn) {
            this.answerThisBtn.classList.add('answer-this-default');
        }
        // Hide humanize button
        if (this.humanizeBtn) {
            this.humanizeBtn.classList.add('hidden');
        }
        // Hide output toolbar when output is hidden
        this.hideOutputToolbar();
    }

    handleDragStart(e) {
        // Mark that we're dragging the output
        this.isDraggingOutput = true;
        
        // Ensure window is interactive initially for drag to start
        if (this.isElectron) {
            const { ipcRenderer } = require('electron');
            ipcRenderer.invoke('make-interactive');
        }
        
        // Get HTML content to preserve table structure
        let htmlToDrag = this.dragOutput.innerHTML || '';
        
        // Extract tables from HTML and ensure they're properly formatted for Google Docs
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = htmlToDrag;
        const tables = tempDiv.querySelectorAll('table');
        
        // Ensure tables have proper structure for Google Docs recognition
        tables.forEach(table => {
            // Add table attributes that Google Docs recognizes when pasting HTML
            if (!table.hasAttribute('border')) {
                table.setAttribute('border', '1');
            }
            if (!table.hasAttribute('cellpadding')) {
                table.setAttribute('cellpadding', '5');
            }
            if (!table.hasAttribute('cellspacing')) {
                table.setAttribute('cellspacing', '0');
            }
            if (!table.hasAttribute('style')) {
                table.setAttribute('style', 'border-collapse: collapse; width: 100%;');
            }
            
            // Ensure all rows have proper structure
            const rows = table.querySelectorAll('tr');
            rows.forEach(row => {
                const cells = row.querySelectorAll('td, th');
                cells.forEach(cell => {
                    if (!cell.hasAttribute('style')) {
                        cell.setAttribute('style', 'border: 1px solid #ccc; padding: 8px;');
                    }
                });
            });
        });
        
        // Ensure paragraphs are properly formatted with blank lines between them
        // Convert divs and other block elements to proper paragraphs
        const blockElements = tempDiv.querySelectorAll('div, p, h1, h2, h3, h4, h5, h6');
        blockElements.forEach(element => {
            // If it's not already a paragraph and contains text, wrap or convert
            if (element.tagName !== 'P' && element.tagName !== 'TABLE' && !element.closest('table')) {
                const text = element.textContent.trim();
                if (text && !element.querySelector('table')) {
                    // Convert to paragraph with no margin
                    const p = document.createElement('p');
                    p.innerHTML = element.innerHTML;
                    p.style.lineHeight = '1.6';
                    p.style.margin = '0';
                    p.style.marginBottom = '0';
                    element.replaceWith(p);
                }
            } else if (element.tagName === 'P') {
                // Remove all margins - we'll use <br> for spacing
                element.style.margin = '0';
                element.style.marginBottom = '0';
                element.style.marginTop = '0';
                element.style.padding = '0';
                element.style.lineHeight = '1.6';
            }
        });
        
        // Get updated HTML after element modifications
        htmlToDrag = tempDiv.innerHTML;
        
        // Get the raw text content to detect paragraph breaks
        const rawText = tempDiv.textContent || tempDiv.innerText || '';
        
        // Check if content has paragraphs that aren't wrapped
        // Split by double newlines OR single newlines (if they separate distinct paragraphs)
        let paragraphs = rawText.split(/\n\s*\n/).filter(p => p.trim());
        
        // If we only got one paragraph, try splitting by single newlines
        if (paragraphs.length === 1) {
            const lines = rawText.split('\n').filter(l => l.trim());
            // If we have multiple lines that look like separate paragraphs
            if (lines.length > 1) {
                paragraphs = lines;
            }
        }
        
        // If we have multiple paragraphs, rebuild the HTML structure properly
        if (paragraphs.length > 1 && (!htmlToDrag.includes('<p') || htmlToDrag.match(/<p[^>]*>/g)?.length < paragraphs.length)) {
            // Rebuild HTML with proper paragraph structure - separate <p> tags without <br>
            htmlToDrag = paragraphs.map(p => {
                const trimmed = p.trim();
                // Preserve any existing HTML in the paragraph
                if (trimmed.includes('<')) {
                    return trimmed;
                }
                return `<p style="line-height: 1.6; margin: 0; padding: 0;">${trimmed}</p>`;
            }).join('\n'); // Use newline between paragraphs, not <br>
            
            tempDiv.innerHTML = htmlToDrag;
            htmlToDrag = tempDiv.innerHTML;
        }
        
        // Ensure all existing paragraphs are properly formatted
        const allParagraphs = tempDiv.querySelectorAll('p');
        allParagraphs.forEach(p => {
            p.style.lineHeight = '1.6';
            p.style.margin = '0';
            p.style.padding = '0';
        });
        
        // Remove any <br> tags between paragraphs - Google Docs recognizes block-level <p> separation
        htmlToDrag = tempDiv.innerHTML;
        htmlToDrag = htmlToDrag.replace(/<\/p>\s*<br\s*\/?>\s*<p/g, '</p>\n<p');
        htmlToDrag = htmlToDrag.replace(/<\/p>\s*<p/g, '</p>\n<p'); // Ensure newline between paragraphs
        
        // Wrap in a container div
        htmlToDrag = `<div style="line-height: 1.6;">${htmlToDrag}</div>`;
        
        // Get clean text for plain text format - CRITICAL for Google Docs
        // This is what Google Docs uses when dragging
        let textToDrag = this.dragOutput.dataset.fullText || '';
        
        // If we don't have stored full text, extract it from the DOM
        if (!textToDrag) {
            // Get text content preserving paragraph structure
            const textContent = tempDiv.textContent || tempDiv.innerText || '';
            // Split by double newlines or detect paragraph breaks
            const textParagraphs = textContent.split(/\n\s*\n/).filter(p => p.trim());
            
            if (textParagraphs.length > 1) {
                // Join with double newlines to preserve paragraph breaks
                textToDrag = textParagraphs.join('\n\n');
            } else {
                // Try single newlines
                const lines = textContent.split('\n').filter(l => l.trim());
                if (lines.length > 1) {
                    textToDrag = lines.join('\n\n'); // Use double newlines for paragraph breaks
                } else {
                    textToDrag = textContent;
                }
            }
        }
        
        // Ensure text has proper paragraph breaks (double newlines)
        textToDrag = textToDrag.replace(/\n{3,}/g, '\n\n'); // Normalize excessive breaks
        textToDrag = textToDrag.trim();
        
        // CRITICAL FIX: Electron windows with special properties can't drag-drop to external apps
        // Copy to clipboard automatically on Windows as a workaround
        const isWindows = navigator.platform.toLowerCase().includes('win') || navigator.userAgent.toLowerCase().includes('windows');
        if (isWindows && this.isElectron) {
            const { ipcRenderer } = require('electron');
            // Copy HTML to clipboard when drag starts (Windows workaround) - preserves table structure
            ipcRenderer.invoke('copy-to-clipboard', htmlToDrag).then(() => {
                // Show brief notification that text was copied
                this.showNotification('✅ Content copied to clipboard - paste it where needed');
                // Auto-hide after 2 seconds
                setTimeout(() => {
                    if (this.dragOutput && !this.dragOutput.classList.contains('hidden')) {
                        const content = this.dragOutput.textContent || '';
                        if (content.includes('copied to clipboard')) {
                            this.dragOutput.classList.add('hidden');
                        }
                    }
                }, 2000);
            }).catch(err => {
                console.error('Failed to copy to clipboard:', err);
            });
        }
        
        // Set data in multiple formats for better compatibility
        // Use HTML format for tables, plain text as fallback
        e.dataTransfer.setData('text/plain', textToDrag);
        e.dataTransfer.setData('text/html', htmlToDrag); // Preserve HTML table structure
        e.dataTransfer.setData('text/unicode', textToDrag);
        e.dataTransfer.effectAllowed = 'copy';
        
        // Windows-specific: Create a drag image for better visual feedback
        if (isWindows) {
            // Create a temporary drag image element
            const dragImage = document.createElement('div');
            dragImage.style.position = 'absolute';
            dragImage.style.top = '-1000px';
            dragImage.style.padding = '10px';
            dragImage.style.background = 'rgba(0, 0, 0, 0.8)';
            dragImage.style.color = 'white';
            dragImage.style.borderRadius = '8px';
            dragImage.style.fontSize = '14px';
            dragImage.style.maxWidth = '300px';
            dragImage.textContent = textToDrag.substring(0, 50) + (textToDrag.length > 50 ? '...' : '');
            document.body.appendChild(dragImage);
            e.dataTransfer.setDragImage(dragImage, 10, 10);
            setTimeout(() => document.body.removeChild(dragImage), 0);
        }
        
        // Add visual feedback
        this.dragOutput.style.opacity = '0.7';
    }

    handleDragEnd(e) {
        // Restore opacity first
        this.dragOutput.style.opacity = '1';
        
        // On Windows, keep window interactive longer to ensure drag-drop completes
        // Windows needs more time because drag-drop can take longer to process
        const isWindows = navigator.platform.toLowerCase().includes('win') || navigator.userAgent.toLowerCase().includes('windows');
        const delay = isWindows ? 500 : 100; // Longer delay on Windows
        
        // Keep window interactive during the delay to ensure drag-drop completes
        if (this.isElectron) {
            const { ipcRenderer } = require('electron');
            // Ensure window stays interactive during delay
            ipcRenderer.invoke('make-interactive');
        }
        
        // Clear drag flag after a short delay to ensure drag-drop completes
        setTimeout(() => {
            this.isDraggingOutput = false;
            
            // Now check if mouse is still over overlay after drag ends
            setTimeout(() => {
                if (!this.isDraggingOutput && !this.isResizing && this.isElectron) {
                    const { ipcRenderer } = require('electron');
                    const rect = this.overlay.getBoundingClientRect();
                    const mouseX = e.clientX || 0;
                    const mouseY = e.clientY || 0;
                    // Check if mouse is outside overlay bounds
                    if (mouseX < rect.left || mouseX > rect.right || mouseY < rect.top || mouseY > rect.bottom || mouseX === 0 && mouseY === 0) {
                        // Mouse is outside, set click-through
                        ipcRenderer.invoke('make-click-through');
                    } else {
                        // Mouse is still over overlay, keep interactive
                        ipcRenderer.invoke('make-interactive');
                    }
                }
            }, 50);
        }, delay);
    }
    
    handleResizeStart(e) {
        // Make window interactive for resize
        if (this.isElectron) {
            const { ipcRenderer } = require('electron');
            ipcRenderer.invoke('make-interactive');
        }
        
        this.isResizing = true;
        this.resizeStartX = e.clientX;
        this.resizeStartY = e.clientY;
        this.resizeStartWidth = this.dragOutput.offsetWidth;
        this.resizeStartHeight = this.dragOutput.offsetHeight;
        
        // Store bound methods so we can remove them later
        this.boundResizeMove = this.handleResizeMove.bind(this);
        this.boundResizeEnd = this.handleResizeEnd.bind(this);
        
        document.addEventListener('mousemove', this.boundResizeMove);
        document.addEventListener('mouseup', this.boundResizeEnd);
    }

    handleResizeMove(e) {
        if (!this.isResizing) return;
        
        const deltaX = e.clientX - this.resizeStartX;
        const deltaY = e.clientY - this.resizeStartY;
        
        const newWidth = Math.max(200, this.resizeStartWidth + deltaX);
        const newHeight = Math.max(100, this.resizeStartHeight + deltaY);
        
        this.dragOutput.style.width = `${newWidth}px`;
        this.dragOutput.style.height = `${newHeight}px`;
    }

    handleResizeEnd(e) {
        this.isResizing = false;
        if (this.boundResizeMove) {
            document.removeEventListener('mousemove', this.boundResizeMove);
        }
        if (this.boundResizeEnd) {
            document.removeEventListener('mouseup', this.boundResizeEnd);
        }
        
        // Check if mouse is outside overlay and set click-through if so
        setTimeout(() => {
            if (!this.isDraggingOutput && !this.isResizing) {
                const rect = this.overlay.getBoundingClientRect();
                const mouseX = e.clientX;
                const mouseY = e.clientY;
                if (mouseX < rect.left || mouseX > rect.right || mouseY < rect.top || mouseY > rect.bottom) {
                    if (this.isElectron) {
                        const { ipcRenderer } = require('electron');
                        ipcRenderer.invoke('make-click-through');
                    }
                }
            }
        }, 100);
    }

    startJarvis() {
        // Initialize Jarvis overlay
        this.showOverlay();
    }

}

// Initialize Jarvis when the page loads
document.addEventListener('DOMContentLoaded', () => {
            document.querySelectorAll('.notification').forEach(n => n.remove());
            const jarvis = new JarvisOverlay();
            window.jarvisOverlay = jarvis; // Expose for quiz button handlers
            
            // Set initial position immediately to prevent drift
            const overlay = document.getElementById('jarvis-overlay');
            if (overlay) {
                const centerX = (window.innerWidth - 400) / 2; // Estimate 400px width
                const centerY = (window.innerHeight - 200) / 2; // Estimate 200px height
                overlay.style.left = `${centerX}px`;
                overlay.style.top = `${centerY}px`;
                overlay.style.transform = 'none';
                
                // Initialize overlay color and opacity (default: black, 95% = original)
                const savedColor = localStorage.getItem('jarvis-overlay-color') || 'black';
                const savedOpacity = localStorage.getItem('jarvis-overlay-opacity') || '95';
                jarvis.currentOpacity = parseInt(savedOpacity);
                jarvis.setOverlayColor(savedColor);
                jarvis.setOverlayOpacity(parseInt(savedOpacity));
                
                // Initialize opacity slider and display
                const opacitySlider = document.getElementById('opacity-slider');
                const opacityDisplay = document.getElementById('opacity-value-display');
                if (opacitySlider) {
                    opacitySlider.value = savedOpacity;
                }
                if (opacityDisplay) {
                    opacityDisplay.textContent = savedOpacity + '%';
                }
            }
            
           window.setOpenAIKey = (key) => {
               jarvis.apiKey = key;
               jarvis.showNotification('OpenAI API key updated');
           };
           
           // Global handlers for inline event handlers (most reliable method)
           window.handleOpacitySlider = (opacity) => {
               console.log('🎚️ Opacity slider changed:', opacity + '%');
               const opacityValue = parseInt(opacity);
               jarvis.currentOpacity = opacityValue;
               jarvis.setOverlayOpacity(opacityValue);
               localStorage.setItem('jarvis-overlay-opacity', opacity);
               // Update the display
               const display = document.getElementById('opacity-value-display');
               if (display) {
                   display.textContent = opacity + '%';
               }
           };
           
           window.handleColorPicker = (color) => {
               console.log('🎨 Color picker changed:', color);
               jarvis.setOverlayColor(color);
               // Hide color submenu after selection
               const colorSubmenu = document.getElementById('color-submenu');
               if (colorSubmenu) colorSubmenu.classList.add('hidden');
           };
           
           window.toggleColorSubmenu = () => {
               console.log('🎨 toggleColorSubmenu called');
               const colorSubmenu = document.getElementById('color-submenu');
               console.log('🎨 colorSubmenu element:', colorSubmenu);
               if (colorSubmenu) {
                   console.log('🎨 Current classes:', colorSubmenu.className);
                   if (colorSubmenu.classList.contains('hidden')) {
                       colorSubmenu.classList.remove('hidden');
                       console.log('🎨 Removed hidden class - submenu should be visible');
                   } else {
                       colorSubmenu.classList.add('hidden');
                       console.log('🎨 Added hidden class - submenu should be hidden');
           }
                   console.log('🎨 New classes:', colorSubmenu.className);
               } else {
                   console.error('🎨 Color submenu element not found!');
               }
           };
           
           // Set initial slider value
           const opacitySlider = document.getElementById('opacity-slider');
           if (opacitySlider) {
               opacitySlider.value = savedOpacity;
           }

    try { jarvis.startJarvis(); } catch (e) {}
});


