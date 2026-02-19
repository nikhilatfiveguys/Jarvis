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
        this.selectedModelName = 'ChatGPT 5.2'; // Track displayed model name
        this.grokVoiceMode = false; // Track Grok voice mode state
        // ElevenLabs API key should be stored in Supabase Edge Function Secrets
        this.elevenLabsApiKey = null;
        this.elevenLabsVoiceId = 'ShB6BQqbEXZxWO5511Qq'; // Female voice
        this.elevenLabsVoiceId2 = '4NejU5DwQjevnR6mh3mb'; // Male voice
        this.useSecondVoice = false; // Toggle between voices
        this.stealthModeEnabled = false; // Cheat mode: hide from recordings + memory off
        
        // For cancelling running commands
        this.currentAbortController = null;
        
        // Load conversation history from localStorage (cleared when cheat mode is on)
        try {
            const saved = localStorage.getItem('jarvis_conversation_history');
            this.conversationHistory = saved ? JSON.parse(saved) : [];
            const cheatModeOn = localStorage.getItem('stealth_mode_enabled') === 'true';
            if (cheatModeOn) this.conversationHistory = [];
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
        this.maxFreeMessages = 20;
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
        this.injectAddedOpenRouterModels();
        this.setupHotkeys();
        this.setupElectronIntegration();
        this.setupDragFunctionality();
        this.setupElectronIPCListeners();
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

    /** Build tools in OpenRouter/OpenAI chat completions format for use with any OpenRouter model */
    getOpenRouterTools() {
        if (!this.tools || !this.tools.length) {
            this.rebuildToolsArray();
        }
        if (!this.tools || !this.tools.length) return [];
        return this.tools.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description || '',
                parameters: t.parameters || { type: 'object', properties: {}, required: [] }
            }
        }));
    }

    /** Slash commands shown when user types "/" – Skills from tools + Actions */
    getSlashCommands() {
        const skills = [];
        if (this.tools && this.tools.length) {
            const map = {
                getscreenshot: { name: 'Screenshot', insert: "What's on my screen right now?" },
                web_search: { name: 'Web search', insert: 'Search the web for: ' },
                create_quiz: { name: 'Quiz', insert: 'Create a quiz about: ' },
                askclaude: { name: 'Ask Claude', insert: 'Ask Claude for a deep analysis: ' }
            };
            this.tools.forEach(t => {
                const m = map[t.name];
                if (m) skills.push({ id: t.name, name: m.name, insert: m.insert, desc: (t.description || '').substring(0, 50) + '…' });
            });
        }
        const actions = [
            { id: 'add-file', name: 'Add file', insert: '', desc: 'Attach file(s) to your message', action: 'addFile' },
            { id: 'answer-screen', name: 'Answer screen', insert: '', desc: 'Capture screen and get an answer', action: 'answerScreen' },
            { id: 'clear-chat', name: 'Clear chat', insert: '', desc: 'Clear conversation history', action: 'clearChat' }
        ];
        return { skills, actions };
    }

    setupSlashCommandMenu() {
        if (!this.slashCommandMenu || !this.slashCommandList || !this.textInput) return;
        const renderList = (filter) => {
            const { skills, actions } = this.getSlashCommands();
            const f = (filter || '').toLowerCase();
            const match = (name, id) => !f || name.toLowerCase().includes(f) || id.toLowerCase().includes(f);
            const skillItems = skills.filter(s => match(s.name, s.id));
            const actionItems = actions.filter(a => match(a.name, a.id));
            this.slashCommandList.innerHTML = '';
            [...skillItems, ...actionItems].forEach((item, idx) => {
                const el = document.createElement('div');
                el.className = 'slash-command-item' + (idx === 0 ? ' selected' : '');
                el.setAttribute('role', 'option');
                el.dataset.command = item.id;
                el.dataset.insert = item.insert || '';
                if (item.action) el.dataset.action = item.action;
                el.innerHTML = `<span class="slash-command-item-name">${item.name}</span><span class="slash-command-item-desc">${item.desc || ''}</span>`;
                el.addEventListener('mouseenter', () => {
                    this.slashCommandList?.querySelectorAll('.slash-command-item').forEach(x => x.classList.remove('selected'));
                    el.classList.add('selected');
                });
                el.addEventListener('click', () => this.selectSlashCommand(item.id, item.insert, item.action));
                this.slashCommandList.appendChild(el);
            });
        };
        this.renderSlashCommandList = renderList;
        document.addEventListener('mousedown', (e) => {
            if (!this.slashCommandMenu || this.slashCommandMenu.classList.contains('hidden')) return;
            if (this.slashCommandMenu.contains(e.target) || this.textInput?.contains(e.target)) return;
            this.hideSlashCommandMenu();
        });
    }

    onSlashCommandInput() {
        const val = (this.textInput?.value || '');
        const lastSlash = val.lastIndexOf('/');
        if (lastSlash === -1) {
            this.hideSlashCommandMenu();
            return;
        }
        const isSlashAtStart = lastSlash === 0;
        const isSlashAfterSpace = lastSlash > 0 && val[lastSlash - 1] === ' ';
        if (!isSlashAtStart && !isSlashAfterSpace) {
            this.hideSlashCommandMenu();
            return;
        }
        const afterSlash = val.slice(lastSlash + 1);
        if (!this.slashCommandMenu) return;
        this.slashCommandMenu.classList.remove('hidden');
        this.overlay?.classList.add('slash-menu-open');
        this.renderSlashCommandList(afterSlash.trim());
        this.slashCommandMenu.dataset.prefixLength = String(lastSlash);
    }

    hideSlashCommandMenu() {
        if (this.slashCommandMenu) this.slashCommandMenu.classList.add('hidden');
        this.overlay?.classList.remove('slash-menu-open');
    }

    moveSlashCommandSelection(delta) {
        const items = this.slashCommandList?.querySelectorAll('.slash-command-item');
        if (!items?.length) return;
        const current = this.slashCommandList.querySelector('.slash-command-item.selected');
        let idx = current ? Array.from(items).indexOf(current) + delta : 0;
        if (idx < 0) idx = items.length - 1;
        if (idx >= items.length) idx = 0;
        items.forEach((el, i) => el.classList.toggle('selected', i === idx));
        items[idx]?.scrollIntoView({ block: 'nearest' });
    }

    selectSlashCommand(commandId, insertText, action) {
        const val = (this.textInput?.value || '');
        const lastSlash = val.lastIndexOf('/');
        const prefix = val.slice(0, lastSlash);
        if (action === 'addFile') {
            this.textInput.value = prefix.trim();
            this.hideSlashCommandMenu();
            if (this.fileInput) {
                this.fileInput.value = '';
                this.fileInput.click();
            }
            return;
        }
        if (action === 'answerScreen') {
            this.textInput.value = prefix.trim();
            this.hideSlashCommandMenu();
            this.answerThis();
            return;
        }
        if (action === 'clearChat') {
            this.textInput.value = prefix.trim();
            this.hideSlashCommandMenu();
            this.clearChatHistory?.();
            return;
        }
        const newVal = prefix.trim() + (prefix.trim() ? ' ' : '') + (insertText || '');
        this.textInput.value = newVal;
        this.textInput.focus();
        this.hideSlashCommandMenu();
        if (this.resizeTextInput) this.resizeTextInput();
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
                    };
                    // Sync to localStorage so getUserEmail() works (reads from localStorage)
                    try {
                        if (subscriptionResult.subscriptionData?.email) {
                            localStorage.setItem('jarvis_user', JSON.stringify({ email: subscriptionResult.subscriptionData.email, updatedAt: new Date().toISOString() }));
                        }
                    } catch (_) {}
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
            this.selectedModelName = 'ChatGPT 5.2';
            if (this.currentModelDisplay) {
                this.currentModelDisplay.textContent = 'ChatGPT 5.2';
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

    setupElectronIPCListeners() {
        if (!this.isElectron || !window.require) return;

        const { ipcRenderer } = window.require('electron');

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

        // Report overlay bounds to main so hover-to-activate only triggers over the pill (not full screen)
        const reportOverlayRect = () => {
            if (!this.overlay) return;
            const rect = this.overlay.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
                ipcRenderer.invoke('report-overlay-rect', { x: rect.x, y: rect.y, width: rect.width, height: rect.height }).catch(() => {});
            }
        };
        reportOverlayRect();
        this._overlayRectInterval = setInterval(reportOverlayRect, 250);
    }

    async takeScreenshotAndAnalyze() {
        try {
            this.showNotification('📸 Taking screenshot...', 'info');
            
            if (this.isElectron && window.require) {
                const { ipcRenderer } = window.require('electron');
                let screenshot = await ipcRenderer.invoke('take-screenshot');
                
                // If screen capture looks black (protected content), try window capture then all windows
                if (screenshot && await this.isScreenshotMostlyBlack(screenshot)) {
                    const windowShot = await ipcRenderer.invoke('take-screenshot-window');
                    if (windowShot && !(await this.isScreenshotMostlyBlack(windowShot))) {
                        screenshot = windowShot;
                    } else {
                        const allWindows = await ipcRenderer.invoke('take-screenshot-all-windows');
                        for (const w of allWindows || []) {
                            if (w.dataUrl && !(await this.isScreenshotMostlyBlack(w.dataUrl))) {
                                screenshot = w.dataUrl;
                                break;
                            }
                        }
                    }
                }
                
                if (screenshot) {
                    if (await this.isScreenshotMostlyBlack(screenshot)) {
                        this.currentScreenCapture = null;
                        this.showNotification('The screenshot is blank (Chrome/Lockdown content is often protected). Paste the question text in the chat instead.', 'error');
                        if (this.textInput) {
                            this.textInput.focus();
                            this.textInput.placeholder = 'Ask Jarvis, / for commands';
                        }
                        return;
                    }
                    this.currentScreenCapture = screenshot;
                    this.showNotification('Screenshot captured! Ask a question about it.', 'success');
                    if (this.textInput) {
                        this.textInput.focus();
                        this.textInput.placeholder = 'Ask Jarvis, / for commands';
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
            screenshot_analysis: true
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

    async showUpgradePrompt() {
        // Try checkout first; if that fails (e.g. not signed in), open upgrade page in browser (no paywall window)
        if (this.isElectron && window.require) {
            try {
                const { ipcRenderer } = window.require('electron');
                const result = await ipcRenderer.invoke('create-checkout-session');
                if (result && result.success) {
                    this.showNotification('Opening checkout page...', 'info');
                } else {
                    await ipcRenderer.invoke('open-upgrade-page');
                    this.showNotification('Opening upgrade page...', 'info');
                }
            } catch (error) {
                console.error('Error opening checkout:', error);
                const { ipcRenderer } = window.require('electron');
                await ipcRenderer.invoke('open-upgrade-page');
                this.showNotification('Opening upgrade page...', 'info');
            }
        }
    }

    shouldUseConversationMemory() {
        return !this.stealthModeEnabled; // Cheat mode = memory off
    }

    saveConversationHistory() {
        if (!this.shouldUseConversationMemory()) return;
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
        this.dragHandle = null; /* removed: whole overlay is draggable */
        this.closeOutputBtn = document.getElementById('close-output');
        this.closeOutputFloating = document.getElementById('close-output-floating');
        this.answerThisBtn = document.getElementById('answer-this-btn');
        this.actionButtonsContainer = document.getElementById('action-buttons-container');
        this.humanizeBtn = document.getElementById('humanize-btn');
        this.startBtn = document.getElementById('start-jarvis');
        this.resizeHandle = document.getElementById('resize-handle');
        this.settingsBtn = document.getElementById('settings-btn');
        this.settingsMenu = document.getElementById('settings-menu');
        this.slashCommandMenu = document.getElementById('slash-command-menu');
        this.slashCommandList = document.getElementById('slash-command-list');
        this.fileBtn = document.getElementById('add-btn');
        this.clearChatBtn = document.getElementById('clear-chat-btn');
        this.settingsCloseBtn = document.getElementById('settings-close-btn');
        this.accountInfoBtn = document.getElementById('account-info-btn');
        this.hotkeysBtn = document.getElementById('hotkeys-btn');
        this.stealthModeToggle = document.getElementById('stealth-mode-toggle');
        this.stealthModeCheckbox = document.getElementById('stealth-mode-checkbox');
        this.lockdownLauncherBtn = document.getElementById('lockdown-launcher-btn');
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
        this.isDraggingOverlay = false; // Track if overlay bar is being dragged (so we don't go click-through during drag)
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
        // Open http(s) links in custom in-app browser when in Electron
        document.addEventListener('click', (e) => {
            const a = e.target.closest('a[href^="http"]');
            if (!a || !a.href) return;
            if (this.isElectron && window.require) {
                try {
                    e.preventDefault();
                    const { ipcRenderer } = window.require('electron');
                    ipcRenderer.send('open-in-app-browser', a.href);
                } catch (_) {}
            }
        }, true);

        if (this.startBtn) this.startBtn.addEventListener('click', () => this.startJarvis());
        this.textInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                if (this.slashCommandMenu && !this.slashCommandMenu.classList.contains('hidden')) {
                    const selected = this.slashCommandList?.querySelector('.slash-command-item.selected');
                    if (selected) {
                        e.preventDefault();
                        const action = selected.dataset.action || undefined;
                        this.selectSlashCommand(selected.dataset.command, selected.dataset.insert, action);
                        return;
                    }
                }
                e.preventDefault();
                this.sendMessage();
            }
            if (e.key === 'Escape') {
                if (this.slashCommandMenu && !this.slashCommandMenu.classList.contains('hidden')) {
                    e.preventDefault();
                    this.hideSlashCommandMenu();
                    return;
                }
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                if (this.slashCommandMenu && !this.slashCommandMenu.classList.contains('hidden')) {
                    e.preventDefault();
                    this.moveSlashCommandSelection(e.key === 'ArrowDown' ? 1 : -1);
                    return;
                }
            }
        });
        const resizeTextInput = () => {
            if (!this.textInput) return;
            // Fixed single-line height; no expansion – content scrolls inside
            this.textInput.style.height = '20px';
        };
        this.textInput.addEventListener('input', (e) => {
            resizeTextInput();
            this.onSlashCommandInput();
        });
        this.resizeTextInput = resizeTextInput;
        
        this.setupSlashCommandMenu();
        
        // When text input gets focus: request window focus and keep overlay interactive (prevent click-through)
        this.textInput.addEventListener('focus', () => {
            if (this.isElectron && window.require) {
                clearTimeout(this._clickThroughMenuCloseTimeout);
                this._clickThroughMenuCloseTimeout = null;
                const { ipcRenderer } = require('electron');
                ipcRenderer.invoke('make-interactive').catch(() => {});
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
        
        // Initialize opacity value (default 100% so first launch is not more transparent)
        let savedOpacity = localStorage.getItem('jarvis-overlay-opacity') || '100';
        if (savedOpacity === '95') {
            localStorage.setItem('jarvis-overlay-opacity', '100');
            savedOpacity = '100';
        }
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
                    e.stopPropagation();
                    const model = item.getAttribute('data-model');
                    const modelName = item.querySelector('.model-name').textContent;
                    this.selectModel(model, modelName);
                    this.hideModelSubmenu();
                });
            });
            
            // "More models" button
            const moreModelsBtn = document.getElementById('model-more-btn');
            if (moreModelsBtn) {
                moreModelsBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleMoreModels();
                });
            }
            // "Browse more models" button (opens separate window like Account)
            const browseMoreModelsBtn = document.getElementById('browse-more-models-btn');
            if (browseMoreModelsBtn) {
                browseMoreModelsBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (this.isElectron && window.require) {
                        const { ipcRenderer } = window.require('electron');
                        ipcRenderer.invoke('open-openrouter-models-window');
                    }
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
                if (this.isElectron && window.require) {
                    const { ipcRenderer } = require('electron');
                    ipcRenderer.invoke('make-interactive').catch(() => {});
                    this._overlayIsInteractive = true;
                    clearTimeout(this._clickThroughMenuCloseTimeout);
                }
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
        
        if (this.settingsCloseBtn) {
            this.settingsCloseBtn.addEventListener('click', () => {
                this.hideSettingsMenu();
                this.quitApp();
            });
        }
        
        if (this.accountInfoBtn) {
            // Use mousedown so the action runs before opening the Account window causes blur (which would close the menu and can swallow the click)
            this.accountInfoBtn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showAccountWindow();
            });
        }
        
        if (this.hotkeysBtn) {
            this.hotkeysBtn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.showHotkeysWindow();
            });
        }

        // Stealth Mode toggle
        if (this.stealthModeCheckbox) {
            // Load saved preference (default to true/ON if not set)
            const savedPreference = localStorage.getItem('stealth_mode_enabled');
            const stealthModeEnabled = savedPreference === null ? true : savedPreference === 'true';
            this.stealthModeEnabled = stealthModeEnabled; // Initialize state
            this.stealthModeCheckbox.checked = stealthModeEnabled;
            console.log('🔧 Initial cheat mode state:', stealthModeEnabled);
            
            // Apply on load (with a small delay to ensure Electron is ready)
            // Only enable stealth mode on load if user has premium
            setTimeout(() => {
                // If stealth mode is saved as enabled but user doesn't have premium, disable it
                if (stealthModeEnabled && !this.hasPremiumAccess()) {
                    this.stealthModeCheckbox.checked = false;
                    this.stealthModeEnabled = false;
                    console.log('🔧 Cheat mode disabled on load - requires premium');
                } else {
                this.toggleStealthMode(stealthModeEnabled, false); // false = don't show notification on initial load
                    if (stealthModeEnabled) {
                        this.conversationHistory = [];
                        try { localStorage.removeItem('jarvis_conversation_history'); } catch (err) {}
                    }
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
                    this.showNotification('🔒 Cheat Mode requires Jarvis Premium. Upgrade to hide Jarvis from screen recordings!', false);
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
                        this.showNotification('🔒 Cheat Mode requires Jarvis Premium. Upgrade to hide Jarvis from screen recordings!', false);
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

        if (this.lockdownLauncherBtn) {
            if (typeof process !== 'undefined' && process.platform === 'darwin') {
                this.lockdownLauncherBtn.style.display = '';
                this.lockdownLauncherBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    try {
                        const { ipcRenderer } = window.require('electron');
                        const r = await ipcRenderer.invoke('run-lockdown-launcher');
                        if (r && r.ok) {
                            this.showNotification('Lockdown Launcher opened in Terminal. Keep that window open during your exam.', 'success');
                        } else {
                            this.showNotification(r?.error || 'Could not run launcher', 'error');
                        }
                    } catch (err) {
                        this.showNotification('Could not run launcher', 'error');
                    }
                });
            }
        }

        if (this.accountModalClose) {
            this.accountModalClose.addEventListener('click', () => this.hideAccountModal());
        }
        
        if (this.accountModalOk) {
            this.accountModalOk.addEventListener('click', () => this.hideAccountModal());
        }
        
        // GPT 5.2 Mini/High tier toggle (inside dropdown)
        this.setupTierToggle();
        
        
        // Close account modal when clicking outside
        if (this.accountModal) {
            this.accountModal.addEventListener('click', (e) => {
                if (e.target === this.accountModal) {
                    this.hideAccountModal();
                }
            });
        }

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
        
        // Close menus when window loses focus (do NOT switch to click-through here –
        // blur can fire when clicking inside the overlay, which would make it unclickable)
        window.addEventListener('blur', () => {
            this.hideSettingsMenu();
            this.hideModelSubmenu();
            this.hideSettingsSubmenu();
            this.hideColorSubmenu();
        });
        
        // Make overlay interactive when needed, but allow clicks to work
        if (this.overlay) {
            this._clickThroughMenuCloseTimeout = null; // stored so we can clear it when overlay is shown
            this._clickThroughAfterMenusClosedTimeout = null; // after closing dropdown, switch to click-through so user can click window behind
            this._overlayIsInteractive = false; // track interactive state (set by mouseenter or when main activates via hover)
            
            // When main process makes overlay interactive via hover-to-activate, sync state
            if (this.isElectron && window.require) {
                const { ipcRenderer } = require('electron');
                ipcRenderer.on('overlay-now-interactive', () => {
                    this._overlayIsInteractive = true;
                });
            }
            
            // Make overlay interactive when mouse enters overlay area (only when not already interactive to avoid cursor glitch)
            this.overlay.addEventListener('mouseenter', () => {
                clearTimeout(this._clickThroughMenuCloseTimeout);
                
                if (this.isElectron && !this._overlayIsInteractive) {
                    const { ipcRenderer } = require('electron');
                    ipcRenderer.invoke('make-interactive').catch(() => {});
                    this._overlayIsInteractive = true;
                }
            });
            
            // Handle mouse leave - go back to click-through after delay (avoid glitch when moving between HUD and output)
            this.overlay.addEventListener('mouseleave', () => {
                if (this.isElectron && this._overlayIsInteractive) {
                    if (this.isDraggingOutput || this.isResizing || this.isDraggingOverlay) return;
                    if (this.updateNotificationVisible) return;
                    // Don't start the click-through timer if any menu is open (so user can click settings)
                    if (this.settingsMenu && !this.settingsMenu.classList.contains('hidden')) return;
                    if (this.modelSubmenu && !this.modelSubmenu.classList.contains('hidden')) return;
                    if (this.settingsSubmenu && !this.settingsSubmenu.classList.contains('hidden')) return;
                    if (this.colorSubmenu && !this.colorSubmenu.classList.contains('hidden')) return;

                    clearTimeout(this._clickThroughMenuCloseTimeout);
                    this._clickThroughMenuCloseTimeout = setTimeout(() => {
                        // Don't go click-through if user has focus in the overlay (e.g. typing in text box)
                        if (document.activeElement && this.overlay.contains(document.activeElement)) return;
                        if (this.isDraggingOverlay) return;
                        if (this.settingsMenu && !this.settingsMenu.classList.contains('hidden')) return;
                        if (this.modelSubmenu && !this.modelSubmenu.classList.contains('hidden')) return;
                        if (this.settingsSubmenu && !this.settingsSubmenu.classList.contains('hidden')) return;
                        if (this.colorSubmenu && !this.colorSubmenu.classList.contains('hidden')) return;
                        this.hideSettingsMenu();
                        this.hideModelSubmenu();
                        this.hideSettingsSubmenu();
                        this.hideColorSubmenu();
                        if (!this.updateNotificationVisible) {
                            const { ipcRenderer } = require('electron');
                            ipcRenderer.invoke('make-click-through').catch(() => {});
                            this._overlayIsInteractive = false;
                        }
                    }, 800); // 800ms delay to avoid accidental click-through when moving between elements
                }
            });
            
            // Keep interactive when interacting with settings menu
            if (this.settingsMenu) {
                this.settingsMenu.addEventListener('mouseenter', () => {
                    if (this.isElectron) {
                        clearTimeout(this._clickThroughMenuCloseTimeout);
                        const { ipcRenderer } = require('electron');
                        ipcRenderer.invoke('make-interactive').catch(() => {});
                        this._overlayIsInteractive = true;
                    }
                });
                this.settingsMenu.addEventListener('mousedown', () => {
                    if (this.isElectron) {
                        clearTimeout(this._clickThroughMenuCloseTimeout);
                        const { ipcRenderer } = require('electron');
                        ipcRenderer.invoke('make-interactive').catch(() => {});
                        ipcRenderer.invoke('request-focus').catch(() => {});
                        this._overlayIsInteractive = true;
                    }
                });
            }
            
            // Keep interactive when interacting with settings submenu (where opacity slider is)
            if (this.settingsSubmenu) {
                this.settingsSubmenu.addEventListener('mouseenter', () => {
                    if (this.isElectron) {
                        clearTimeout(this._clickThroughMenuCloseTimeout);
                        const { ipcRenderer } = require('electron');
                        ipcRenderer.invoke('make-interactive').catch(() => {});
                        this._overlayIsInteractive = true;
                    }
                });
                this.settingsSubmenu.addEventListener('mousedown', () => {
                    if (this.isElectron) {
                        clearTimeout(this._clickThroughMenuCloseTimeout);
                        const { ipcRenderer } = require('electron');
                        ipcRenderer.invoke('make-interactive').catch(() => {});
                        ipcRenderer.invoke('request-focus').catch(() => {});
                        this._overlayIsInteractive = true;
                    }
                });
            }
            
            // Keep interactive when interacting with color submenu
            if (this.colorSubmenu) {
                this.colorSubmenu.addEventListener('mouseenter', () => {
                    if (this.isElectron) {
                        clearTimeout(this._clickThroughMenuCloseTimeout);
                        const { ipcRenderer } = require('electron');
                        ipcRenderer.invoke('make-interactive').catch(() => {});
                        this._overlayIsInteractive = true;
                    }
                });
                this.colorSubmenu.addEventListener('mousedown', () => {
                    if (this.isElectron) {
                        clearTimeout(this._clickThroughMenuCloseTimeout);
                        const { ipcRenderer } = require('electron');
                        ipcRenderer.invoke('make-interactive').catch(() => {});
                        ipcRenderer.invoke('request-focus').catch(() => {});
                        this._overlayIsInteractive = true;
                    }
                });
            }
            
            // Handle clicks on overlay - always make interactive
            this.overlay.addEventListener('mousedown', (e) => {
                if (this.isElectron) {
                    clearTimeout(this._clickThroughMenuCloseTimeout);
                    const { ipcRenderer } = require('electron');
                    // Make interactive when clicking anywhere on overlay
                    ipcRenderer.invoke('make-interactive').catch(() => {});
                    this._overlayIsInteractive = true;
                    // Request focus to ensure window can receive input
                    ipcRenderer.invoke('request-focus').catch(() => {});
                }
            });
            
            // Keep overlay interactive while mouse is down (for dragging)
            this.overlay.addEventListener('mousemove', (e) => {
                if (this.isElectron && e.buttons > 0) {
                    // Mouse is being held down, keep interactive
                    clearTimeout(this._clickThroughMenuCloseTimeout);
                    if (!this._overlayIsInteractive) {
                        const { ipcRenderer } = require('electron');
                        ipcRenderer.invoke('make-interactive').catch(() => {});
                        this._overlayIsInteractive = true;
                    }
                }
            });
            
            // Overlay is made interactive when shown by main process; no initial click-through
            // so the user can always click it when they open it (mouseleave will set click-through later).
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
        
        ipcRenderer.on('show-permission-in-output', () => {
            const msg = '**Enable screen recording & system audio recording**\n\nOpen System Settings → Enable Jarvis. It will ask you to Quit & Reopen. (If nothing shows up, press Answer Screen.)\n\n*Does not screenshot unless you specifically prompt or press "Answer Screen" — no images are stored; all information stays local on your computer.*';
            this.showNotification(msg, true);
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
            // Brief pause so Squirrel.Mac can start pulling from our proxy, then trigger install.
            this.showUpdateNotification(`✅ Update v${info.version} downloaded. Preparing install… (about 1 min, then restart)`, 'downloading');
            setTimeout(() => {
                this.installUpdate();
            }, 15000);
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

        // OpenRouter models window: when user adds a model in the window, overlay adds it and injects
        ipcRenderer.on('openrouter-model-added', (_e, model) => {
            if (model && model.id) this.addOpenRouterModelToUserList(model.id, model.name, model.description);
        });
        // Full list sync from main (when Add is pressed in OpenRouter window) - inject list directly
        ipcRenderer.on('openrouter-added-models-sync', (_e, list) => {
            if (!Array.isArray(list)) return;
            try {
                localStorage.setItem(JarvisApp.OPENROUTER_ADDED_KEY, JSON.stringify(list));
            } catch (_) {}
            this.injectAddedOpenRouterModelsFromList(list);
        });
        // On load, pull effective "More models" list from main (defaults + user-added) and populate dropdown
        ipcRenderer.invoke('get-openrouter-added-models').then((list) => {
            if (!Array.isArray(list)) return;
            try {
                localStorage.setItem(JarvisApp.OPENROUTER_ADDED_KEY, JSON.stringify(list));
            } catch (_) {}
            this.injectAddedOpenRouterModelsFromList(list);
        }).catch(() => {});

        ipcRenderer.on('update-not-available', (event) => {
            console.log('✅ App is up to date');
            this.showUpdateNotification("You're up to date! ✅", 'success', true);
        });

        ipcRenderer.on('update-check-error', (event, errorMessage) => {
            console.error('Update check error (from updater):', errorMessage);
            this.showUpdateNotification(
                "Update check failed: " + (errorMessage || 'Unknown error').slice(0, 120),
                'info',
                false,
                { url: 'https://github.com/nikhilatfiveguys/Jarvis/releases/latest' }
            );
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
                console.log('🔵 Disabled click-through for update notification');
                
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
        } else if (type === 'info' && updateInfo?.url) {
            // Fallback: install stuck – show manual download link
            html += `
                <div class="update-notification-actions">
                    <button class="update-notification-btn primary" data-open-url="${(updateInfo.url || '').replace(/"/g, '&quot;')}">Download manually</button>
                    <button class="update-notification-btn dismiss" onclick="window.jarvisApp.hideUpdateNotification()">Dismiss</button>
                </div>
            `;
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
                } else if (button.textContent === 'Download manually' && button.dataset.openUrl) {
                    try {
                        require('electron').shell.openExternal(button.dataset.openUrl);
                    } catch (e) {}
                    this.hideUpdateNotification();
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

        // Auto-hide success notifications after 5 seconds (unless manual-download fallback)
        if (type === 'success' || (type === 'info' && !updateInfo?.url)) {
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
                    console.log('🔵 Re-enabled click-through after hiding update notification');
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
            const version = this.pendingUpdate?.version || 'latest';
            this.showUpdateNotification('🔄 Installing… (about 1 min, then app will restart)', 'downloading');
            const { ipcRenderer, shell } = require('electron');
            const installStuckTimer = setTimeout(() => {
                this.showUpdateNotification(
                    `Taking too long? Quit the app, then download the v${version} DMG from the link below. Your data is preserved.`,
                    'info',
                    false,
                    { url: 'https://github.com/nikhilatfiveguys/Jarvis/releases/latest' }
                );
            }, 30000);
            ipcRenderer.invoke('install-update').then(() => {
                clearTimeout(installStuckTimer);
            }).catch((error) => {
                clearTimeout(installStuckTimer);
                console.error('Install error:', error);
                if (error.message && error.message.includes('code signature')) {
                    this.showUpdateNotification('Opening download page...', 'info');
                    shell.openExternal('https://github.com/nikhilatfiveguys/Jarvis/releases/latest');
                } else {
                    this.showUpdateNotification('❌ Install failed. Download manually: releases/latest', 'error');
                    shell.openExternal('https://github.com/nikhilatfiveguys/Jarvis/releases/latest');
                }
            });
        } catch (error) {
            console.error('Install error:', error);
            if (error.message && error.message.includes('code signature')) {
                this.showUpdateNotification('Opening download page...', 'info');
                require('electron').shell.openExternal('https://github.com/nikhilatfiveguys/Jarvis/releases/latest');
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
        const RELEASES_URL = 'https://github.com/nikhilatfiveguys/Jarvis/releases/latest';
        try {
            const { ipcRenderer, shell } = require('electron');
            const result = await ipcRenderer.invoke('check-for-updates');
            if (result.success && result.updateAvailable && result.version) {
                this.pendingUpdate = { version: result.version };
                this.updateReadyToInstall = false;
                this.showUpdateInMenu(result.version, 'available');
                this.showUpdateNotification(`Update v${result.version} available. Click Update to download and install.`, 'update', false, { version: result.version });
                return;
            }
            if (!result.success) {
                const err = (result.error || '').toString();
                console.error('Update check failed:', err);
                if (err.includes('Cannot find latest artifacts') || err.includes('404') || err.includes('Jarvis-5.0')) {
                    this.showUpdateNotification('Opening latest release…', 'info');
                    shell.openExternal(RELEASES_URL);
                    return;
                }
                this.showUpdateNotification(
                    'Update check failed: ' + err.slice(0, 100) + (err.length > 100 ? '…' : ''),
                    'info',
                    false,
                    { url: RELEASES_URL }
                );
            }
        } catch (error) {
            console.error('Update check error:', error);
            const msg = (error && error.message) || '';
            if (msg.includes('Cannot find latest artifacts') || msg.includes('404') || msg.includes('Jarvis-5.0')) {
                try {
                    const { shell } = require('electron');
                    this.showUpdateNotification('Opening latest release…', 'info');
                    shell.openExternal(RELEASES_URL);
                } catch (_) {}
                return;
            }
            this.showUpdateNotification(
                'Update check failed: ' + msg.slice(0, 100),
                'info',
                false,
                { url: RELEASES_URL }
            );
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
        if (!this.overlay) return;
        this.overlaySidebarSide = null; // 'left' | 'right' | null (sidebar snap removed; kept for tear-off/exit)
        const PILL_SNAP_ZONE = 24;
        const EDGE_MARGIN = 12;

        let isDragging = false;
        let dragPending = false;
        let startX, startY, initialLeft, initialTop, mousedownTarget;
        let exitedSidebarThisDrag = false;
        const DRAG_THRESHOLD_PX = 12; // Higher threshold so click-to-type isn't confused with drag

        // Elements that should never start a drag (buttons, menus, message content). Input is excluded only when it has text (so drag = highlight).
        const noDragSelector = 'button, a, select, [contenteditable], .drag-output, #drag-output, .messages-container, .messages-inner, .settings-menu, .model-submenu, .more-models-section, .model-item, .model-more-btn, .browse-more-models-btn, .settings-item, .tier-toggle, .tier-switch, .set-password-notification, .update-notification, [role="button"]';
        const inputAreaSelector = '#text-input, .input-section, .input-section-with-slash, textarea';

        this.overlay.addEventListener('mousedown', (e) => {
            if (e.target.closest(noDragSelector)) return;
            // Input area: only block drag when there is text (so user can highlight). Empty input = drag moves overlay.
            if (e.target.closest(inputAreaSelector)) {
                if (this.textInput && (this.textInput.value || '').trim().length > 0) return;
            }
            dragPending = true;
            exitedSidebarThisDrag = false;
            mousedownTarget = e.target;
            startX = e.clientX;
            startY = e.clientY;
            const rect = this.overlay.getBoundingClientRect();
            initialLeft = rect.left;
            initialTop = rect.top;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (dragPending && !isDragging) {
                const dx = e.clientX - startX;
                const dy = e.clientY - startY;
                if (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX) {
                    isDragging = true;
                    this.isDraggingOverlay = true;
                    dragPending = false;
                    this.overlay.classList.add('dragging');
                    // If currently in sidebar mode, tear off: remove sidebar class and center overlay under cursor
                    if (this.overlaySidebarSide) {
                        this.exitSidebarMode();
                        this.overlay.classList.remove('overlay-sidebar-left', 'overlay-sidebar-right');
                        this.overlay.style.right = '';
                        const W = this.overlay.offsetWidth;
                        const H = this.overlay.offsetHeight;
                        const left = Math.max(0, Math.min(window.innerWidth - W, e.clientX - W / 2));
                        const top = Math.max(0, Math.min(window.innerHeight - H, e.clientY - H / 2));
                        this.overlay.style.left = `${left}px`;
                        this.overlay.style.top = `${top}px`;
                        initialLeft = left;
                        initialTop = top;
                        this.overlaySidebarSide = null;
                        exitedSidebarThisDrag = true;
                        this.updateBlurBackdrop();
                    }
                }
            }
            if (!isDragging) return;

            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            const overlayRect = this.overlay.getBoundingClientRect();
            const overlayWidth = overlayRect.width;
            const overlayHeight = overlayRect.height;
            let newLeft = initialLeft + dx;
            let newTop = initialTop + dy;
            const maxLeft = window.innerWidth - overlayWidth;
            const maxTop = window.innerHeight - overlayHeight;
            newLeft = Math.max(0, Math.min(maxLeft, newLeft));
            newTop = Math.max(0, Math.min(maxTop, newTop));
            this.overlay.style.left = `${newLeft}px`;
            this.overlay.style.top = `${newTop}px`;
            this.overlay.style.transform = 'none';
        });

        document.addEventListener('mouseup', () => {
            if (dragPending) {
                const input = this.overlay.querySelector('#text-input');
                // Treat any click on the bar that didn't become a drag as "focus input to type"
                const hitBar = mousedownTarget && mousedownTarget.closest && mousedownTarget.closest('.minimal-hud');
                if (input && (hitBar || (input.contains && input.contains(mousedownTarget)))) {
                    input.focus();
                }
                dragPending = false;
            }
            if (isDragging) {
                isDragging = false;
                this.isDraggingOverlay = false;
                this.overlay.classList.remove('dragging');
                const rect = this.overlay.getBoundingClientRect();
                const w = rect.width;
                const h = rect.height;
                let left = rect.left;
                let top = rect.top;
                // Keep overlay on-screen with a small margin (no sidebar snap)
                if (left < PILL_SNAP_ZONE) left = EDGE_MARGIN;
                else if (left + w > window.innerWidth - PILL_SNAP_ZONE) left = window.innerWidth - w - EDGE_MARGIN;
                if (top < PILL_SNAP_ZONE) top = EDGE_MARGIN;
                if (top + h > window.innerHeight - PILL_SNAP_ZONE) top = window.innerHeight - h - EDGE_MARGIN;
                this.overlay.style.left = `${Math.round(left)}px`;
                this.overlay.style.top = `${Math.round(top)}px`;
            }
        });

        // Double-click: if in sidebar, float and center at top; else center at top
        this.overlay.addEventListener('dblclick', (e) => {
            if (e.target.closest(noDragSelector)) return;
            if (e.target.closest(inputAreaSelector) && this.textInput && (this.textInput.value || '').trim().length > 0) return;
            if (this.overlaySidebarSide) {
                this.exitSidebarMode();
                this.overlay.classList.remove('overlay-sidebar-left', 'overlay-sidebar-right');
                this.overlay.style.right = '';
                this.overlaySidebarSide = null;
                this.updateBlurBackdrop();
            }
            const overlayWidth = this.overlay.offsetWidth || 400;
            const overlayHeight = this.overlay.offsetHeight || 200;
            const centerX = Math.max(0, (window.innerWidth - overlayWidth) / 2);
            const topY = Math.max(0, Math.min(20, window.innerHeight - overlayHeight - 20));
            this.overlay.style.left = `${centerX}px`;
            this.overlay.style.top = `${topY}px`;
            this.overlay.style.transform = 'none';
            // After centering, go click-through so the user can click other windows (short delay so OS finishes dblclick and next click isn't swallowed)
            if (this.isElectron && window.require) {
                clearTimeout(this._clickThroughMenuCloseTimeout);
                this._clickThroughMenuCloseTimeout = null;
                const self = this;
                setTimeout(() => {
                    self.hideSettingsMenu();
                    self.hideModelSubmenu();
                    self.hideSettingsSubmenu();
                    self.hideColorSubmenu();
                    if (!self.updateNotificationVisible) {
                        const { ipcRenderer } = require('electron');
                        ipcRenderer.invoke('make-click-through').catch(() => {});
                        self._overlayIsInteractive = false;
                    }
                }, 150);
            }
        });

        // Position blur-backdrop behind HUD so backdrop-filter has something to blur (Electron has no desktop in "backdrop")
        this.updateBlurBackdrop();
        const blurBackdrop = document.getElementById('blur-backdrop');
        if (blurBackdrop) {
            const scheduleUpdate = () => requestAnimationFrame(() => this.updateBlurBackdrop());
            document.addEventListener('mousemove', scheduleUpdate);
            document.addEventListener('mouseup', scheduleUpdate);
            window.addEventListener('resize', scheduleUpdate);
        }
    }

    updateBlurBackdrop() {
        const backdrop = document.getElementById('blur-backdrop');
        const hud = this.overlay && this.overlay.querySelector('.minimal-hud');
        if (!hud) return;
        const r = hud.getBoundingClientRect();
        const pad = 24;
        if (this.overlaySidebarSide) {
            if (backdrop) backdrop.classList.remove('visible');
            if (this.isElectron) this.sendHudBlurBounds(null);
            return;
        }
        if (backdrop) {
            backdrop.style.left = `${r.left - pad}px`;
            backdrop.style.top = `${r.top - pad}px`;
            backdrop.style.width = `${r.width + pad * 2}px`;
            backdrop.style.height = `${r.height + pad * 2}px`;
            backdrop.classList.add('visible');
        }
        if (this.isElectron) this.sendHudBlurBounds(null);
    }
    sendHudBlurBounds(rect) {
        try {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.send('set-hud-blur-bounds', rect);
        } catch (_) {}
    }

    enterSidebarMode() {
        // Show as one long box: messages visible, history expanded, no need for reveal button
        if (!this.messagesContainer) return;
        this.messagesContainer.classList.remove('hidden');
        this.messagesContainer.style.height = '';
        this.messagesContainer.style.maxHeight = '';
        this.messagesContainer.style.overflowY = 'auto';
        const previousMessages = this.messagesContainer.querySelectorAll('.drag-output:not(#drag-output)');
        previousMessages.forEach(msg => {
            msg.style.display = 'block';
            msg.style.opacity = '1';
            msg.style.pointerEvents = 'auto';
        });
        if (this.revealHistoryBtn) {
            this.revealHistoryBtn.classList.add('rotated');
            this.revealHistoryBtn.classList.add('hidden'); // Hide when sidebar – history always visible
        }
        requestAnimationFrame(() => {
            if (this.messagesContainer) {
                this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
            }
        });
    }

    exitSidebarMode() {
        if (!this.revealHistoryBtn || !this.messagesContainer) return;
        const previousMessages = this.messagesContainer.querySelectorAll('.drag-output:not(#drag-output)');
        if (previousMessages.length > 0) {
            this.revealHistoryBtn.classList.remove('hidden');
        }
        // Leave expanded/collapsed state as-is when exiting sidebar
    }

    moveToTopMiddle() {
        if (!this.overlay) return;
        if (this.overlaySidebarSide) {
            this.exitSidebarMode();
            this.overlay.classList.remove('overlay-sidebar-left', 'overlay-sidebar-right');
            this.overlay.style.right = '';
            this.overlaySidebarSide = null;
            this.updateBlurBackdrop();
        }
        const overlayWidth = this.overlay.offsetWidth || 400;
        const centerX = (window.innerWidth - overlayWidth) / 2;
        const topY = 20; // 20px from the top
        this.overlay.style.left = `${centerX}px`;
        this.overlay.style.top = `${topY}px`;
        this.overlay.style.transform = 'none';
    }

    toggleOverlay() {
        if (this.isActive) {
            this.hideOverlay();
        } else {
            this.showOverlay();
        }
    }

    async showOverlay() {
        if (!this.overlay) return;
        
        // Reset cursor
        this.overlay.classList.remove('dragging');
        
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
        
        this.isActive = true;
        
        // Overlay starts click-through (main process); becomes interactive when cursor enters (main polls).
        // Cancel any pending click-through timeout from a previous session.
        if (this.isElectron && window.require) {
            clearTimeout(this._clickThroughMenuCloseTimeout);
            this._clickThroughMenuCloseTimeout = null;
        }
        
        // Don't auto-focus the input on show – user can click the overlay to focus when they're ready
        
        // Update message counter to reflect current subscription status
        this.updateMessageCounter();
        
        this.showNotification('Jarvis is ready! Look for the red X button in the top-right corner of this message.');
    }



    /** Returns true only if the screenshot is almost entirely black (e.g. protected/DRM blank frame). Stricter threshold to avoid false positives on dark UIs. */
    async isScreenshotMostlyBlack(dataUrl) {
        if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return false;
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.width;
                    canvas.height = img.height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
                    const totalPixels = data.length / 4;
                    const step = Math.max(1, Math.floor(totalPixels / 1500));
                    let darkCount = 0;
                    let sampled = 0;
                    for (let i = 0; i < data.length; i += 4 * step) {
                        const r = data[i], g = data[i + 1], b = data[i + 2];
                        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
                        if (luminance < 22) darkCount++; // only near-black (was 35) to avoid rejecting dark themes
                        sampled++;
                    }
                    resolve(sampled > 0 && darkCount / sampled >= 0.92); // require 92% near-black (was 75%) so only truly blank frames are rejected
                } catch (e) {
                    resolve(false);
                }
            };
            img.onerror = () => resolve(false);
            img.src = dataUrl;
        });
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
            
            if (this.shouldUseConversationMemory()) {
                this.conversationHistory.push({ role: 'user', content: prompt });
                this.conversationHistory.push({ 
                    role: 'assistant', 
                    content: analysis,
                    model: this.selectedModelName || 'ChatGPT 5.2'
                });
                if (this.conversationHistory.length > 30) {
                    this.conversationHistory = this.conversationHistory.slice(-30);
                }
                this.saveConversationHistory();
            }
            
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
            // Use selected model: OpenRouter if a non-default model is selected, otherwise OpenAI
            let response;
            if (this.selectedModel && this.selectedModel !== 'default' && this.selectedModel !== 'jarvis-low') {
                response = await this.callOpenRouter(message, this.selectedModel);
            } else {
                response = await this.analyzeWithOpenAI(this.currentScreenCapture, message);
            }
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
            
            // Route to OpenRouter if a specific model is selected, otherwise use default ChatGPT
            let response;
            
            // Handle GPT 5.2 Mini (GPT-5 Mini) model - uses OpenAI API directly
            if (this.selectedModel === 'jarvis-low' || this.isLowModelMode) {
                this.showLoadingNotification();
                response = await this.callLowModel(message);
                
                // Increment low message count for free users
                if (!this.hasPremiumAccess()) {
                    this.incrementLowMessageCount();
                }
            } else if (this.selectedModel && this.selectedModel !== 'default') {
                this.showLoadingNotification();
                console.log(`🤖 [MODEL SWITCHER] Using OpenRouter model: ${this.selectedModel} (${this.selectedModelName})`);
                console.log(`🤖 [MODEL SWITCHER] OpenRouter API key present: ${!!this.openrouterApiKey}`);
                response = await this.callOpenRouter(message, this.selectedModel);
            } else {
                this.showLoadingNotification();
                console.log(`🤖 [MODEL SWITCHER] Using default Responses API (currentModel: ${this.currentModel})`);
                response = await this.callChatGPT(message, this.currentScreenCapture || null);
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
            // Build conversation context with full history for better continuity (skip when cheat mode = memory off)
            let conversationContext = '';
            if (this.shouldUseConversationMemory() && this.conversationHistory.length > 0) {
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
            const instructions = `You are Jarvis. An AI assistant powered by many different AI models. Answer directly without any preface, introduction, or phrases like "here's the answer" or "the answer is". Just provide the answer immediately. Respond concisely. Use getscreenshot for screen questions.${webSearchHint}${claudeHint}${conversationContext}${documentContext}`;

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
                            this.switchToLowModel(true);
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
                        return "⚠️ Switched to GPT 5.2 Mini. Add credits for other models.";
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
                        this.switchToLowModel(true);
                        return "⚠️ Switched to GPT 5.2 Mini. Add credits for other models.";
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
                                this.switchToLowModel(true);
                                throw new Error('LIMIT_EXCEEDED');
                            }
                            throw new Error(`API error: ${result?.status || 500} - ${result?.data?.error || 'IPC call failed'}`);
                        }
                    } catch (ipcError) {
                        if (ipcError.message === 'LIMIT_EXCEEDED') {
                            return "⚠️ Switched to GPT 5.2 Mini. Add credits for other models.";
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
            
            if (this.shouldUseConversationMemory()) {
                this.conversationHistory.push({ role: 'user', content: message });
                this.conversationHistory.push({ 
                    role: 'assistant', 
                    content: safeResponse,
                    model: this.selectedModelName || 'ChatGPT 5.2'
                });
                if (this.conversationHistory.length > 30) {
                    this.conversationHistory = this.conversationHistory.slice(-30);
                }
                this.saveConversationHistory();
            }
            
            return safeResponse;
        } catch (error) {
            console.error('API error:', error);
            throw error;
        }
    }
    
    async executeGetScreenshot() {
        try {
            this.showNotification('Taking screenshot...');
            if (!this.isElectron || !window.require) {
                return "Screenshot is only available in the desktop app.";
            }
            const ipc = window.require('electron').ipcRenderer;
            let screenshot = await ipc.invoke('take-screenshot');
            if (screenshot && (await this.isScreenshotMostlyBlack(screenshot))) {
                const windowShot = await ipc.invoke('take-screenshot-window');
                if (windowShot && !(await this.isScreenshotMostlyBlack(windowShot))) {
                    screenshot = windowShot;
                } else {
                    const allWindows = await ipc.invoke('take-screenshot-all-windows');
                    for (const w of allWindows || []) {
                        if (w.dataUrl && !(await this.isScreenshotMostlyBlack(w.dataUrl))) {
                            screenshot = w.dataUrl;
                            break;
                        }
                    }
                }
            }
            this.currentScreenCapture = screenshot && !(await this.isScreenshotMostlyBlack(screenshot)) ? screenshot : null;
            if (!this.currentScreenCapture) {
                return "Screenshot is blank (protected content). Ask the user to paste the question text instead.";
            }
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
                            this.switchToLowModel(true);
                            return "⚠️ Switched to GPT 5.2 Mini. Add credits for other models.";
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
                        return "⚠️ Switched to GPT 5.2 Mini. Add credits for other models.";
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

    // Show streaming content in the output area
    showStreamingContent(text, streamType = 'response') {
        if (!this.dragOutput) return;
        
        // Make sure output is visible
        this.dragOutput.classList.remove('hidden');
        if (this.closeOutputFloating) {
            this.closeOutputFloating.classList.remove('hidden');
        }
        
        // Style based on stream type
        let styledContent = '';
        if (streamType === 'thinking') {
            // Thinking has a subtle, italic style
            styledContent = `<div class="streaming-thinking">${this.escapeHtml(text)}</div>`;
        } else if (streamType === 'tool') {
            // Tool usage has a distinct style
            styledContent = `<div class="streaming-tool">${this.escapeHtml(text)}</div>`;
        } else if (streamType === 'status') {
            // Status is minimal
            styledContent = `<div class="streaming-status">${this.escapeHtml(text)}</div>`;
        } else {
            // Regular response
            styledContent = this.processContent(text, false);
        }
        
        this.dragOutput.innerHTML = styledContent;
    }

    // Escape HTML for safe display
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // GPT 5.2 Mini model - uses OpenAI API with gpt-4o-mini (no cost tracking)
    async callLowModel(message) {
        try {
            // Build conversation context (skip when cheat mode = memory off)
            let conversationContext = '';
            if (this.shouldUseConversationMemory() && this.conversationHistory.length > 0) {
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

            const instructions = `You are GPT 5.2 Mini, a fast and efficient AI assistant. Answer directly without any preface. Be concise but helpful.${conversationContext}${documentContext}`;

            if (this.shouldUseConversationMemory()) {
                this.conversationHistory.push({
                    role: 'user',
                    content: message,
                    model: 'GPT 5.2 Mini'
                });
            }

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
                        
                        if (this.shouldUseConversationMemory()) {
                            this.conversationHistory.push({
                                role: 'assistant',
                                content: content,
                                model: 'GPT 5.2 Mini'
                            });
                            this.saveConversationHistory();
                        }
                        
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

            if (this.shouldUseConversationMemory()) {
                this.conversationHistory.push({
                    role: 'assistant',
                    content: content,
                    model: 'GPT 5.2 Mini'
                });
                this.saveConversationHistory();
            }

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
            // Claude Sonnet 4.5 and other anthropic/* models in "More models" use OpenRouter API key
            // (no separate Claude API key needed for the dropdown)

            // Build conversation context (skip when cheat mode = memory off)
            let conversationContext = '';
            if (this.shouldUseConversationMemory() && this.conversationHistory.length > 0) {
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

            // Skills/tools for OpenRouter (same as default model: screenshot, web search, quiz, Claude)
            let openRouterTools = this.getOpenRouterTools();
            let useTools = openRouterTools.length > 0;

            const toolInstructions = useTools ? `\n\nYou have tools available. When the user asks what is on their screen, what they're looking at, to describe their screen, or to analyze something on their screen, you MUST call the getscreenshot tool first. Do not say you cannot see their screen—use the tool to capture it, then describe or answer based on the image you receive. For current events, news, or "latest" information use web_search. For quizzes use create_quiz.` : '';
            const instructions = `You are Jarvis, an AI assistant. Answer directly without any preface, introduction, or phrases like "here's the answer" or "the answer is". Just provide the answer immediately. Respond concisely.${toolInstructions}${conversationContext}${documentContext}${voiceInstructions}`;

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
                
                let messages = [
                    { role: 'system', content: instructions },
                    { role: 'user', content: userContent }
                ];
                let requestPayload = {
                    model: model,
                    messages: messages
                };
                if (useTools) {
                    requestPayload.tools = openRouterTools;
                    // When user asks about their screen (explicit or implied "this"), force getscreenshot
                    const explicitScreenQuery = /what'?s?\s+on\s+(my\s+)?screen|what\s+(am\s+i\s+)?(looking\s+at|seeing)|describe\s+my\s+screen|(show|analyze|see)\s+(my\s+)?screen|what\s+do\s+you\s+see/i;
                    const messageStr = typeof userContent === 'string' ? userContent : (userContent && userContent.find && userContent.find(p => p.type === 'text')?.text) || '';
                    if (explicitScreenQuery.test(messageStr) || this.messageImpliesScreenReference(messageStr)) {
                        requestPayload.tool_choice = { type: 'function', function: { name: 'getscreenshot' } };
                        console.log('📸 Screen query detected – forcing getscreenshot tool');
                    } else {
                        requestPayload.tool_choice = 'auto';
                    }
                }
                
                const MAX_TOOL_ROUNDS = 5;
                let round = 0;
                let data;
                let lastContent = null;
                let triedWithoutTools = false;
                
                while (round < MAX_TOOL_ROUNDS) {
                    round++;
                    console.log('🔒 Calling OpenRouter via main process IPC' + (round > 1 ? ` (tool round ${round})` : '') + (useTools ? ' (with tools)' : ' (no tools)'));
                    const result = await ipcRenderer.invoke('call-openrouter-api', requestPayload, false);
                    
                    if (!result.ok) {
                        // If first request with tools returns 400, retry once without tools (some models don't support tools)
                        if (useTools && round === 1 && !triedWithoutTools && (result.status === 400 || (result.data?.error && String(result.data.error).toLowerCase().includes('tool')))) {
                            console.warn('⚠️ OpenRouter rejected tools request, retrying without tools');
                            useTools = false;
                            triedWithoutTools = true;
                            requestPayload = { model: model, messages: messages };
                            round = 0;
                            continue;
                        }
                        if (result.status === 429 && result.data?.isBlocked !== undefined) {
                            this.switchToLowModel(true);
                            return `⚠️ Switched to GPT 5.2 Mini. Add credits for other models.`;
                        }
                        if (result.status === 402) {
                            const detail = result.data?.error?.message || result.data?.error || result.data?.message || '';
                            throw new Error(`OpenRouter needs credits or a payment method (402). Add credits at openrouter.ai. ${detail ? detail : ''}`.trim());
                        }
                        const errMsg = (result.data?.error?.message || result.data?.error || result.statusText || '').toString();
                        if (result.status === 404) {
                            throw new Error(`This model isn't available on OpenRouter (404). Pick another model from the list or check openrouter.ai/models. Details: ${errMsg}`);
                        }
                        if (result.status === 400) {
                            throw new Error(`Use a different model. 3 lines > models > any other model.`);
                        }
                        throw new Error(`OpenRouter API error: ${result.status} - ${errMsg}`);
                    }
                    
                    data = result.data;
                    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                        throw new Error('Invalid response structure from OpenRouter');
                    }
                    
                    const msg = data.choices[0].message;
                    lastContent = msg.content || null;
                    const toolCalls = msg.tool_calls;
                    
                    if (!toolCalls || toolCalls.length === 0) {
                        break;
                    }
                    
                    // Execute tools and build tool result messages + optional user message with screenshot
                    const toolMessages = [];
                    let screenshotForFollowUp = null;
                    
                    for (const tc of toolCalls) {
                        const name = tc.function?.name || tc.name;
                        let args = {};
                        try {
                            const raw = tc.function?.arguments || tc.arguments;
                            if (typeof raw === 'string') args = JSON.parse(raw);
                            else if (raw) args = raw;
                        } catch (_) {}
                        
                        let toolResult = '';
                        try {
                            if (name === 'getscreenshot') {
                                const result = await this.executeGetScreenshot();
                                if (result && typeof result === 'object' && result.type === 'screenshot' && result.image_url) {
                                    screenshotForFollowUp = result.image_url;
                                    toolResult = 'Screenshot captured successfully.';
                                } else {
                                    toolResult = typeof result === 'string' ? result : 'Screenshot capture failed.';
                                }
                                this.showNotification('📸 Screenshot captured, analyzing...');
                            } else if (name === 'web_search' || name === 'search') {
                                const query = args.query || args.query_string || args.search_query || '';
                                toolResult = query ? await this.executeSearchWeb(query) : 'Web search: No query provided.';
                                if (toolResult && typeof toolResult === 'string') {
                                    toolResult = toolResult.substring(0, 8000);
                                }
                            } else if (name === 'askclaude') {
                                const question = args.question || args.query || '';
                                toolResult = question ? await this.executeAskClaude(question) : 'Claude: No question provided.';
                                if (toolResult && typeof toolResult === 'string') {
                                    toolResult = toolResult.substring(0, 12000);
                                }
                            } else if (name === 'create_quiz') {
                                const topic = args.topic || 'General Knowledge';
                                const questions = args.questions || [];
                                if (questions.length === 0) {
                                    toolResult = 'Quiz: No questions provided by model.';
                                } else {
                                    this.stopLoadingAnimation();
                                    if (this.dragOutput) this.dragOutput.classList.remove('loading-notification');
                                    this.showQuiz(topic, questions);
                                    return '__QUIZ_DISPLAYED__';
                                }
                            } else {
                                toolResult = `Unknown tool: ${name}`;
                            }
                        } catch (err) {
                            console.error(`OpenRouter tool ${name} error:`, err);
                            toolResult = `Error: ${err.message}`;
                        }
                        
                        toolMessages.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            content: typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult)
                        });
                    }
                    
                    // Append assistant message (with tool_calls) and tool results to messages
                    messages.push({
                        role: 'assistant',
                        content: msg.content || null,
                        tool_calls: toolCalls
                    });
                    messages.push(...toolMessages);
                    
                    // If getscreenshot was used, add a user message with the image so the model can see it
                    if (screenshotForFollowUp) {
                        messages.push({
                            role: 'user',
                            content: [
                                { type: 'text', text: 'Here is the screenshot you requested:' },
                                { type: 'image_url', image_url: { url: screenshotForFollowUp } }
                            ]
                        });
                    }
                    
                    requestPayload = { model: model, messages };
                    if (useTools) {
                        requestPayload.tools = openRouterTools;
                        requestPayload.tool_choice = 'auto';
                    }
                }
                
                let content = lastContent != null ? lastContent : (data?.choices?.[0]?.message?.content ?? '');
                if (Array.isArray(content)) {
                    content = content.map(part => (part && part.type === 'text' ? part.text : '')).filter(Boolean).join('\n') || '';
                }
                if (typeof content !== 'string') content = String(content || '');
                
                if (this.shouldUseConversationMemory()) {
                    this.conversationHistory.push({ role: 'user', content: message });
                    this.conversationHistory.push({ 
                        role: 'assistant', 
                        content: content,
                        model: this.selectedModelName || 'ChatGPT 5.2'
                    });
                    if (this.conversationHistory.length > 30) {
                        this.conversationHistory = this.conversationHistory.slice(-30);
                    }
                    this.saveConversationHistory();
                }
                
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
                    if (response.status === 404) {
                        throw new Error(`This model isn't available on OpenRouter (404). Pick another model or check openrouter.ai/models. Details: ${errorText}`);
                    }
                    if (response.status === 400) {
                        throw new Error(`Use a different model. 3 lines > models > any other model.`);
                    }
                    throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
                }

                const data = await response.json();
                
                if (!data.choices || !data.choices[0] || !data.choices[0].message) {
                    throw new Error('Invalid response structure from OpenRouter');
                }

                const content = data.choices[0].message.content;
                
                if (this.shouldUseConversationMemory()) {
                    this.conversationHistory.push({ role: 'user', content: message });
                    this.conversationHistory.push({ 
                        role: 'assistant', 
                        content: content,
                        model: this.selectedModelName || 'ChatGPT 5.2'
                    });
                    if (this.conversationHistory.length > 30) {
                        this.conversationHistory = this.conversationHistory.slice(-30);
                    }
                    this.saveConversationHistory();
                }
                
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
            'anthropic/claude-opus-4.5': 'claude-3-opus-20240229',
            'anthropic/claude-opus-4.6': 'claude-3-opus-20240229' // Opus 4.6 via OpenRouter; direct fallback uses Opus 3
        };
        
        let claudeModel = modelMap[openRouterModel] || 'claude-sonnet-4-5-20250929';
        
        try {
            // Build conversation context (skip when cheat mode = memory off)
            let conversationContext = '';
            if (this.shouldUseConversationMemory() && this.conversationHistory.length > 0) {
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
                            this.switchToLowModel(true);
                        }
                        return `⚠️ Switched to GPT 5.2 Mini. Add credits for other models.`;
                    }
                    throw new Error(`Claude API error: ${result.status} - ${result.data?.error || result.statusText}`);
                }
                
                const data = result.data;
                
                if (!data.content || !Array.isArray(data.content) || data.content.length === 0) {
                    throw new Error('Invalid response structure from Claude API');
                }

                const content = data.content[0].text;
                
                if (this.shouldUseConversationMemory()) {
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
                }
                
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
                
                if (this.shouldUseConversationMemory()) {
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
                }
                
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
            
            // Only include recent USER messages for context (skip when cheat mode = memory off)
            if (this.shouldUseConversationMemory() && this.conversationHistory.length > 0) {
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
                            this.switchToLowModel(true);
                        }
                        return `⚠️ Switched to GPT 5.2 Mini. Add credits for other models.`;
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


    // Detect if the user's message implies they're referring to something on their screen (e.g. "what's the answer to this", "is this correct", "what do I do")
    messageImpliesScreenReference(message) {
        if (!message || typeof message !== 'string') return false;
        const text = message.trim();
        const screenPatterns = [
            /\bwhat'?s?\s+the\s+answer\s+to\s+this\b/i,
            /\bwhat\s+is\s+the\s+answer\s+to\s+this\b/i,
            /\bhow\s+do\s+i\s+do\s+this\b/i,
            /\bhow\s+do\s+i\s+solve\s+this\b/i,
            /\bwhat\s+does\s+this\s+say\b/i,
            /\bwhat\s+does\s+this\s+mean\b/i,
            /\bexplain\s+this\b/i,
            /\bhelp\s+me\s+with\s+this\b/i,
            /\bhelp\s+with\s+this\b/i,
            /\bwhat\s+is\s+this\b/i,
            /\bwhat'?s?\s+this\b/i,
            /\bcan\s+you\s+help\s+with\s+this\b/i,
            /\banswer\s+this\b/i,
            /\bsolve\s+this\b/i,
            /\bhow\s+(do\s+i\s+)?(fix|solve|do)\s+this\b/i,
            /\bwhat\s+do\s+i\s+do\s+(here|with\s+this)?\b/i,
            /\bwhat\s+should\s+i\s+do\s+(here|with\s+this|now)?\b/i,
            /\bhow\s+do\s+i\s+(do|solve|fix)\s+it\b/i,
            /\bwhat'?s?\s+the\s+(answer|solution)\s+here\b/i,
            // "Is this correct / right / wrong" – implies they're looking at something
            /\bis\s+this\s+correct\b/i,
            /\bis\s+this\s+right\b/i,
            /\bis\s+this\s+wrong\b/i,
            /\bdid\s+i\s+get\s+this\s+right\b/i,
            /\bam\s+i\s+doing\s+this\s+right\b/i,
            /\bdoes\s+this\s+look\s+right\b/i,
            /\bdoes\s+this\s+look\s+correct\b/i,
            // "Check / review / look at this"
            /\b(check|review|look\s+at)\s+this\b/i,
            /\bcan\s+you\s+(check|review|look\s+at)\s+this\b/i,
            // Short contextual asks
            /\bwhat\s+about\s+this\b/i,
            /\bthoughts\s+on\s+this\b/i,
            /\bwhat\s+do\s+you\s+think\s+(of\s+)?this\b/i
        ];
        return screenPatterns.some(p => p.test(text));
    }

    async sendMessage() {
        const message = (this.textInput?.value || '').trim();
        if (!message && (!this.pendingAttachments || this.pendingAttachments.length === 0)) return;

        // Check character limit for Low model (GPT-5 Mini)
        if (this.isUsingLowModel() && message.length > this.lowModelCharLimit) {
            this.showNotification(`⚠️ Message too long for GPT 5.2 Mini. Please limit to ${this.lowModelCharLimit} characters. (Current: ${message.length})`, false);
            return;
        }

        // Check low message limit for free users using Low model
        if (this.isUsingLowModel() && !this.hasPremiumAccess() && this.hasReachedLowMessageLimit()) {
            this.showNotification(`⚠️ You've reached your daily limit of ${this.maxFreeLowMessages} messages with GPT 5.2 Mini. Try again tomorrow or upgrade for unlimited access!`, false);
            return;
        }

        // Store the last user query for retry functionality
        if (message) {
            this.lastUserQuery = message;
        }

        // Immediately clear UI input so text disappears as soon as user sends
        if (this.textInput) {
            this.textInput.value = '';
            if (this.resizeTextInput) this.resizeTextInput();
        }

        try {
            // If the message implies the user is asking about something on screen (e.g. "what's the answer to this"), capture screen so the AI can see it
            if (this.messageImpliesScreenReference(message) && this.features?.screenshotAnalysis && !this.currentScreenCapture && this.isElectron && window.require) {
                try {
                    this.showNotification('📸 Capturing screen...', 'info');
                    const ipc = window.require('electron').ipcRenderer;
                    let screenshot = await ipc.invoke('take-screenshot');
                    if (screenshot && typeof screenshot === 'string' && screenshot.startsWith('data:image/')) {
                        if (await this.isScreenshotMostlyBlack(screenshot)) {
                            const windowShot = await ipc.invoke('take-screenshot-window');
                            if (windowShot && !(await this.isScreenshotMostlyBlack(windowShot))) {
                                screenshot = windowShot;
                            } else {
                                const allWindows = await ipc.invoke('take-screenshot-all-windows');
                                for (const w of allWindows || []) {
                                    if (w.dataUrl && !(await this.isScreenshotMostlyBlack(w.dataUrl))) {
                                        screenshot = w.dataUrl;
                                        break;
                                    }
                                }
                            }
                        }
                        if (!(await this.isScreenshotMostlyBlack(screenshot))) {
                            this.currentScreenCapture = screenshot;
                            console.log('📸 Inferred screen reference – attached screenshot to message');
                        } else {
                            this.showNotification('Screenshot is blank (protected content). Paste the question text instead.', 'error');
                        }
                    }
                } catch (e) {
                    console.warn('Auto screenshot for screen-inferrable message failed:', e);
                }
            }

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
        
        // Apply current theme – keep glassmorphism (translucent + blur)
        if (this.currentTheme) {
            currentOutput.style.background = `rgba(${this.hexToRgb(this.currentTheme.bg)}, 0.92)`;
            currentOutput.style.color = this.currentTheme.text;
            currentOutput.style.border = `1px solid ${this.currentTheme.border}`;
            currentOutput.style.webkitBackdropFilter = '';
            currentOutput.style.backdropFilter = '';
            currentOutput.style.boxShadow = 'none';
        }
        
        // Apply current opacity if set
        let opacityToApply = this.currentOpacity;
        if (opacityToApply === undefined) {
            // Default opacity if not set (100% = fully visible on first launch)
            opacityToApply = parseInt(localStorage.getItem('jarvis-overlay-opacity') || '100');
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
        if (this.shouldUseConversationMemory()) {
            this.conversationHistory.push({
                role: role,
                content: content
            });
        }
        // Show notification with the message
        this.showNotification(content, true);
    }

    toggleSettingsMenu() {
        if (this.settingsMenu) {
            if (this.settingsMenu.classList.contains('hidden')) {
                clearTimeout(this._clickThroughAfterMenusClosedTimeout);
                this._clickThroughAfterMenusClosedTimeout = null;
                this.settingsMenu.classList.remove('hidden');
                // Attach opacity slider listener when menu opens
                this.attachOpacitySliderWhenReady();
            } else {
                this.settingsMenu.classList.add('hidden');
                this._scheduleClickThroughAfterMenusClosed();
            }
        }
    }

    hideSettingsMenu() {
        if (this.settingsMenu) {
            this.settingsMenu.classList.add('hidden');
        }
        this._scheduleClickThroughAfterMenusClosed();
    }
    
    /** After closing a dropdown/settings menu, switch to click-through so user can click window behind without clicking overlay first */
    _scheduleClickThroughAfterMenusClosed() {
        if (!this.isElectron || !window.require) return;
        clearTimeout(this._clickThroughAfterMenusClosedTimeout);
        this._clickThroughAfterMenusClosedTimeout = setTimeout(() => {
            this._clickThroughAfterMenusClosedTimeout = null;
            if (this.isDraggingOutput || this.isResizing || this.isDraggingOverlay || this.updateNotificationVisible) return;
            if (document.activeElement && this.overlay && this.overlay.contains(document.activeElement)) return;
            const menusClosed = (!this.settingsMenu || this.settingsMenu.classList.contains('hidden')) &&
                (!this.modelSubmenu || this.modelSubmenu.classList.contains('hidden')) &&
                (!this.settingsSubmenu || this.settingsSubmenu.classList.contains('hidden')) &&
                (!this.colorSubmenu || this.colorSubmenu.classList.contains('hidden'));
            if (!menusClosed) return;
            try {
                const { ipcRenderer } = require('electron');
                ipcRenderer.invoke('make-click-through').catch(() => {});
                this._overlayIsInteractive = false;
            } catch (_) {}
        }, 350);
    }
    
    attachOpacitySliderWhenReady() {
        // Simply update the slider value - inline handlers in HTML will do the work
        const slider = document.getElementById('opacity-slider');
        if (!slider) {
            console.warn('❌ Opacity slider not found');
            return;
        }
        
        // Set the saved value (default 100% so first launch is not more transparent)
        const savedOpacity = localStorage.getItem('jarvis-overlay-opacity') || '100';
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
                clearTimeout(this._clickThroughAfterMenusClosedTimeout);
                this._clickThroughAfterMenusClosedTimeout = null;
                this.modelSubmenu.classList.remove('hidden');
                // Sync added models from main (so models added in OpenRouter window always show up)
                if (this.isElectron) {
                    try {
                        const getIpc = () => (typeof window !== 'undefined' && window.require) ? window.require('electron') : (typeof require !== 'undefined' ? require('electron') : null);
                        const electron = getIpc();
                        if (electron && electron.ipcRenderer) {
                            electron.ipcRenderer.invoke('get-openrouter-added-models').then((list) => {
                                if (!Array.isArray(list)) return;
                                try {
                                    localStorage.setItem(JarvisApp.OPENROUTER_ADDED_KEY, JSON.stringify(list));
                                } catch (_) {}
                                this.injectAddedOpenRouterModelsFromList(list);
                            }).catch(() => {});
                        }
                    } catch (_) {}
                }
                // Update locked state for models based on premium status
                this.updateModelLockedState();
                // "More models" stays closed by default; user can expand it with the toggle
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
        this._scheduleClickThroughAfterMenusClosed();
    }
    
    toggleSettingsSubmenu() {
        if (this.settingsSubmenu) {
            const isHidden = this.settingsSubmenu.classList.contains('hidden');
            if (isHidden) {
                clearTimeout(this._clickThroughAfterMenusClosedTimeout);
                this._clickThroughAfterMenusClosedTimeout = null;
                this.settingsSubmenu.classList.remove('hidden');
                // Attach opacity slider listener when submenu opens
                setTimeout(() => this.attachOpacitySliderWhenReady(), 50);
            } else {
                this.settingsSubmenu.classList.add('hidden');
                this._scheduleClickThroughAfterMenusClosed();
            }
        }
    }
    
    
    hideSettingsSubmenu() {
        if (this.settingsSubmenu) {
            this.settingsSubmenu.classList.add('hidden');
        }
        this._scheduleClickThroughAfterMenusClosed();
    }
    
    toggleColorSubmenu() {
        if (this.colorSubmenu) {
            const isHidden = this.colorSubmenu.classList.contains('hidden');
            if (isHidden) {
                clearTimeout(this._clickThroughAfterMenusClosedTimeout);
                this._clickThroughAfterMenusClosedTimeout = null;
                this.colorSubmenu.classList.remove('hidden');
            } else {
                this.colorSubmenu.classList.add('hidden');
                this._scheduleClickThroughAfterMenusClosed();
            }
        }
    }
    
    hideColorSubmenu() {
        if (this.colorSubmenu) {
            this.colorSubmenu.classList.add('hidden');
        }
        this._scheduleClickThroughAfterMenusClosed();
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
        
        // Apply to all overlay elements (HUD, output, etc.) – Answer screen buttons always 1, never transparent
        opacityStyle.textContent = `
            .minimal-hud { opacity: ${opacityValue} !important; }
            .drag-output { opacity: ${opacityValue} !important; }
            #drag-output { opacity: ${opacityValue} !important; }
            .messages-container { opacity: ${opacityValue} !important; }
            #answer-this-btn, #answer-this-btn-moved, .answer-this-btn { opacity: 1 !important; }
            .humanize-btn { opacity: ${opacityValue} !important; }
            .reveal-history-btn { opacity: ${opacityValue} !important; }
            .action-buttons-container { opacity: ${opacityValue} !important; }
        `;
        
        // Apply directly to elements (skip Answer screen button – it stays at 1)
        const elements = [
            '.minimal-hud',
            '.drag-output',
            '.messages-container',
            '.humanize-btn',
            '.reveal-history-btn',
            '.action-buttons-container'
        ];
        
        elements.forEach(selector => {
            document.querySelectorAll(selector).forEach(el => {
                el.style.setProperty('opacity', opacityValue, 'important');
            });
        });
        document.querySelectorAll('.answer-this-btn').forEach(el => {
            el.style.setProperty('opacity', '1', 'important');
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
        
        // Update minimal-hud: same transparency as output (0.92), tint by theme
        const minimalHud = this.overlay.querySelector('.minimal-hud');
        if (minimalHud) {
            minimalHud.style.background = `rgba(${this.hexToRgb(theme.bg)}, 0.92)`;
            minimalHud.style.borderColor = theme.border;
            minimalHud.style.webkitBackdropFilter = '';
            minimalHud.style.backdropFilter = '';
        }
        
        // Update all drag-output elements – keep glassmorphism (translucent + blur), only tint and text color by theme
        const allDragOutputs = this.overlay.querySelectorAll('.drag-output');
        allDragOutputs.forEach(output => {
            output.style.background = `rgba(${this.hexToRgb(theme.bg)}, 0.92)`;
            output.style.color = theme.text;
            output.style.border = `1px solid ${theme.border}`;
            output.style.webkitBackdropFilter = '';
            output.style.backdropFilter = '';
            output.style.boxShadow = 'none';
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
        
        // (Drag handle removed – whole overlay is draggable)
        
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
                answerBtn.style.background = 'rgba(236, 72, 153, 0.5)';
                answerBtn.style.color = '#ffffff';
                answerBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                answerBtn.style.webkitBackdropFilter = 'blur(28px) saturate(195%)';
                answerBtn.style.backdropFilter = 'blur(28px) saturate(195%)';
            } else if (color === 'blue' || color === '#4A9EFF') {
                answerBtn.style.background = 'rgba(74, 158, 255, 0.5)';
                answerBtn.style.color = '#ffffff';
                answerBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                answerBtn.style.webkitBackdropFilter = 'blur(28px) saturate(195%)';
                answerBtn.style.backdropFilter = 'blur(28px) saturate(195%)';
            } else {
                // Black/default: keep liquid glass (translucent + blur)
                answerBtn.style.background = `rgba(${this.hexToRgb(theme.bg)}, 0.35)`;
                answerBtn.style.color = theme.text;
                answerBtn.style.borderColor = theme.border;
                answerBtn.style.webkitBackdropFilter = 'blur(28px) saturate(195%)';
                answerBtn.style.backdropFilter = 'blur(28px) saturate(195%)';
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
                humanizeBtn.style.background = 'rgba(236, 72, 153, 0.5)';
                humanizeBtn.style.color = '#ffffff';
                humanizeBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            } else if (color === 'blue' || color === '#4A9EFF') {
                humanizeBtn.style.background = 'rgba(74, 158, 255, 0.5)';
                humanizeBtn.style.color = '#ffffff';
                humanizeBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            } else {
                humanizeBtn.style.background = `rgba(${this.hexToRgb(theme.bg)}, 0.35)`;
                humanizeBtn.style.color = theme.text;
                humanizeBtn.style.borderColor = theme.border;
                humanizeBtn.style.webkitBackdropFilter = 'blur(28px) saturate(195%)';
                humanizeBtn.style.backdropFilter = 'blur(28px) saturate(195%)';
            }
        }
        
        // Update reveal history button – keep glassmorphism (translucent + blur) in all themes
        const revealHistoryBtn = this.overlay.querySelector('.reveal-history-btn');
        if (revealHistoryBtn) {
            revealHistoryBtn.style.webkitBackdropFilter = 'blur(28px) saturate(195%)';
            revealHistoryBtn.style.backdropFilter = 'blur(28px) saturate(195%)';
            if (isWhite) {
                revealHistoryBtn.style.background = 'rgba(255, 255, 255, 0.4)';
                revealHistoryBtn.style.color = '#000000';
                revealHistoryBtn.style.borderColor = 'rgba(0, 0, 0, 0.18)';
            } else if (color === 'pink' || color === '#ec4899') {
                revealHistoryBtn.style.background = 'rgba(236, 72, 153, 0.4)';
                revealHistoryBtn.style.color = '#ffffff';
                revealHistoryBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            } else if (color === 'blue' || color === '#4A9EFF') {
                revealHistoryBtn.style.background = 'rgba(74, 158, 255, 0.4)';
                revealHistoryBtn.style.color = '#ffffff';
                revealHistoryBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            } else {
                revealHistoryBtn.style.background = `rgba(${this.hexToRgb(theme.bg)}, 0.35)`;
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
        
        // Update reveal history button – keep glassmorphism in all themes
        const revealHistoryBtn = this.overlay?.querySelector('.reveal-history-btn');
        if (revealHistoryBtn) {
            revealHistoryBtn.style.webkitBackdropFilter = 'blur(28px) saturate(195%)';
            revealHistoryBtn.style.backdropFilter = 'blur(28px) saturate(195%)';
            if (isWhite) {
                revealHistoryBtn.style.background = 'rgba(255, 255, 255, 0.4)';
                revealHistoryBtn.style.color = '#000000';
                revealHistoryBtn.style.borderColor = 'rgba(0, 0, 0, 0.18)';
            } else if (color === 'pink' || color === '#ec4899') {
                revealHistoryBtn.style.background = 'rgba(236, 72, 153, 0.4)';
                revealHistoryBtn.style.color = '#ffffff';
                revealHistoryBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            } else if (color === 'blue' || color === '#4A9EFF') {
                revealHistoryBtn.style.background = 'rgba(74, 158, 255, 0.4)';
                revealHistoryBtn.style.color = '#ffffff';
                revealHistoryBtn.style.borderColor = 'rgba(255, 255, 255, 0.2)';
            } else {
                revealHistoryBtn.style.background = 'rgba(28, 28, 30, 0.45)';
                revealHistoryBtn.style.color = '#ffffff';
                revealHistoryBtn.style.borderColor = 'rgba(255, 255, 255, 0.18)';
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
        // Block selection of any other model for free users
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
        
        // Show voice buttons when Grok is selected, hide and reset when switching away
        const voiceBtn = document.getElementById('grok-voice-btn');
        const voiceSelectBtn = document.getElementById('voice-select-btn');
        if (model === 'x-ai/grok-4.1-fast') {
            if (voiceBtn) voiceBtn.classList.remove('hidden');
            if (voiceSelectBtn) voiceSelectBtn.classList.remove('hidden');
        } else {
            if (voiceBtn) {
                voiceBtn.classList.add('hidden');
                voiceBtn.classList.remove('active');
            }
            if (voiceSelectBtn) voiceSelectBtn.classList.add('hidden');
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
        
        // Update cheat mode state
        this.stealthModeEnabled = enabled;
        if (enabled) {
            this.conversationHistory = [];
            try { localStorage.removeItem('jarvis_conversation_history'); } catch (err) {}
        }
        // Apply CSS to disable click sounds when cheat mode is enabled
        this.applyStealthModeStyles(enabled);
        
        try {
            const { ipcRenderer } = window.require('electron');
            console.log(`🔄 Calling IPC to toggle stealth mode to: ${enabled}`);
            ipcRenderer.invoke('toggle-stealth-mode', enabled).then((success) => {
                console.log(`✅ Stealth mode IPC result: ${success}, enabled: ${enabled}`);
                if (success && showNotification) {
                    const message = enabled ? 'Cheat Mode: ON 🥷 (Hidden from screen share, memory off)' : 'Cheat Mode: OFF 👁️ (Visible in screen share, memory on)';
                    this.showNotification(message, true);
                } else if (!success) {
                    console.error('❌ IPC returned false');
                    if (showNotification) {
                        this.showNotification('Failed to toggle cheat mode', false);
                    }
                }
            }).catch((error) => {
                console.error('❌ IPC call failed:', error);
                if (showNotification) {
                    this.showNotification('Failed to toggle cheat mode: ' + error.message, false);
                }
            });
        } catch (error) {
            console.error('❌ Error in toggleStealthMode:', error);
            if (showNotification) {
                this.showNotification('Error toggling cheat mode: ' + error.message, false);
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
                .answer-this-btn, .humanize-btn, .close-output-floating {
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
                    // All "More models" (including Claude Sonnet 4.5) use OpenRouter API key
                    const systemContent = 'Analyze the provided files and respond to the user succinctly and clearly.';
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
                        if (response.status === 404) {
                            throw new Error(`This model isn't available on OpenRouter (404). Pick another model or check openrouter.ai/models. Details: ${errorText}`);
                        }
                        if (response.status === 400) {
                            throw new Error(`Use a different model. 3 lines > models > any other model.`);
                        }
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
                                const userMessage = `${prompt} [Attached ${files.length} file(s): ${files.map(f => f.name).join(', ')}]`;
                                if (this.shouldUseConversationMemory()) {
                                    this.conversationHistory.push({ role: 'user', content: userMessage });
                                    this.conversationHistory.push({ role: 'assistant', content: `Created quiz: ${quizData.topic} with ${quizData.questions.length} questions`, model: this.selectedModelName || 'AI' });
                                    if (this.conversationHistory.length > 30) this.conversationHistory = this.conversationHistory.slice(-30);
                                    this.saveConversationHistory();
                                }
                                if (!this.hasPremiumAccess()) this.incrementMessageCount();
                                return; // Exit early - quiz is displayed
                            }
                        }
                    } catch (parseError) {
                        console.log('No quiz JSON found in response, treating as regular analysis');
                    }
                    
                    analysis = responseContent;
            } else {
                // Use default Jarvis model (GPT-5 Mini via IPC or proxy)
                const instructions = 'Analyze the provided files and respond to the user succinctly and clearly.';
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
                                this.switchToLowModel(true);
                                throw new Error('LIMIT_EXCEEDED');
                            }
                            throw new Error(`IPC call failed: ${JSON.stringify(result)}`);
                        }
                    } catch (ipcError) {
                        if (ipcError.message === 'LIMIT_EXCEEDED') {
                            return "⚠️ Switched to GPT 5.2 Mini. Add credits for other models.";
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
                                const userMessage = `${prompt} [Attached ${files.length} file(s): ${files.map(f => f.name).join(', ')}]`;
                                if (this.shouldUseConversationMemory()) {
                                    this.conversationHistory.push({ role: 'user', content: userMessage });
                                    this.conversationHistory.push({ role: 'assistant', content: `Created quiz: ${topic} with ${questions.length} questions`, model: 'Jarvis' });
                                    if (this.conversationHistory.length > 30) this.conversationHistory = this.conversationHistory.slice(-30);
                                    this.saveConversationHistory();
                                }
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
                    } else if (toolCalls.length > 0) {
                        // Only tool calls, no text - this is an error case for non-quiz tools
                        analysis = 'File analysis complete. The AI processed your request.';
                    } else {
                        analysis = 'Unable to analyze files - no response from AI.';
                    }
                }
            }
            const userMessage = `${prompt} [Attached ${files.length} file(s): ${files.map(f => f.name).join(', ')}]`;
            if (this.shouldUseConversationMemory()) {
                this.conversationHistory.push({ role: 'user', content: userMessage });
                this.conversationHistory.push({ 
                    role: 'assistant', 
                    content: analysis,
                    model: this.selectedModelName || 'ChatGPT 5.2'
                });
                if (this.conversationHistory.length > 30) this.conversationHistory = this.conversationHistory.slice(-30);
                this.saveConversationHistory();
            }
            if (!this.hasPremiumAccess()) this.incrementMessageCount();
            if (this.textInput) { this.textInput.value = ''; if (this.resizeTextInput) this.resizeTextInput(); }
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
                this.premiumStatusElement.textContent = 'Free Access';
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

    togglePinkMode() {
        const minimalHud = document.querySelector('.minimal-hud');
        const dragOutput = document.getElementById('drag-output');
        const answerThisBtn = document.getElementById('answer-this-btn');
        
        // Toggle the pink mode state
        this.isPinkMode = !this.isPinkMode;
        
        if (this.isPinkMode) {
            if (minimalHud) {
                minimalHud.style.background = 'rgba(236, 72, 153, 0.92)';
                minimalHud.style.webkitBackdropFilter = '';
                minimalHud.style.backdropFilter = '';
            }
            if (dragOutput) {
                dragOutput.style.background = 'rgba(236, 72, 153, 0.92)';
                dragOutput.style.webkitBackdropFilter = '';
                dragOutput.style.backdropFilter = '';
            }
            if (answerThisBtn) {
                answerThisBtn.style.background = 'rgba(236, 72, 153, 0.92)';
                answerThisBtn.style.webkitBackdropFilter = '';
                answerThisBtn.style.backdropFilter = '';
            }
            this.addMessage('Jarvis', 'Pink mode activated! 💖', 'assistant');
        } else {
            if (minimalHud) {
                minimalHud.style.background = '';
                minimalHud.style.webkitBackdropFilter = '';
                minimalHud.style.backdropFilter = '';
            }
            if (dragOutput) {
                dragOutput.style.background = '';
                dragOutput.style.webkitBackdropFilter = '';
                dragOutput.style.backdropFilter = '';
            }
            if (answerThisBtn) {
                answerThisBtn.style.background = '';
                answerThisBtn.style.webkitBackdropFilter = '';
                answerThisBtn.style.backdropFilter = '';
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

    static OPENROUTER_ADDED_KEY = 'jarvis_added_openrouter_models';

    escapeHtml(s) {
        if (typeof s !== 'string') return '';
        const div = document.createElement('div');
        div.textContent = s;
        return div.innerHTML;
    }

    getAddedOpenRouterModels() {
        try {
            const raw = localStorage.getItem(JarvisApp.OPENROUTER_ADDED_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    }

    addOpenRouterModelToUserList(id, name, description) {
        if (!id) return;
        const added = this.getAddedOpenRouterModels();
        if (added.some(m => m.id === id)) return;
        added.push({ id, name: name || id, description: description || '' });
        try {
            localStorage.setItem(JarvisApp.OPENROUTER_ADDED_KEY, JSON.stringify(added));
        } catch (_) {}
        this.injectAddedOpenRouterModels();
        // Expand "More models" so the new model is visible in the dropdown
        const moreBtn = document.getElementById('model-more-btn');
        const moreSection = document.getElementById('more-models-section');
        if (moreBtn && moreSection) {
            moreSection.classList.remove('hidden');
            moreBtn.classList.add('expanded');
            const span = moreBtn.querySelector('span');
            if (span) span.textContent = 'Less models';
        }
        // Main is source of truth; overlay receives openrouter-added-models-sync from main when models change
    }

    injectAddedOpenRouterModels() {
        this.injectAddedOpenRouterModelsFromList(this.getAddedOpenRouterModels());
    }

    /** Called by main process via executeJavaScript or with list from IPC - injects list directly; removes items no longer in list */
    injectAddedOpenRouterModelsFromList(list) {
        const section = document.getElementById('more-models-section');
        if (!section) return;
        const keepIds = new Set(Array.isArray(list) ? list.map(m => m && m.id).filter(Boolean) : []);
        section.querySelectorAll('.model-item[data-model]').forEach(el => {
            const id = el.getAttribute('data-model');
            if (id && !keepIds.has(id)) el.remove();
        });
        if (!Array.isArray(list) || list.length === 0) return;
        const existingIds = new Set();
        section.querySelectorAll('.model-item[data-model]').forEach(el => existingIds.add(el.getAttribute('data-model')));
        list.forEach(m => {
            const id = m && m.id;
            if (!id || existingIds.has(id)) return;
            const name = (m.name || id).toString();
            const desc = (m.description || '').toString();
            const item = document.createElement('div');
            item.className = 'model-item';
            item.setAttribute('data-model', id);
            item.setAttribute('data-tier', 'high');
            item.innerHTML = `<span class="model-name">${this.escapeHtml(name)}</span><span class="model-desc">${this.escapeHtml(desc)}</span>`;
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectModel(id, name);
                this.hideModelSubmenu();
            });
            section.appendChild(item);
            existingIds.add(id);
        });
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
        
        // Case 3: If text is longer or asks a specific question about the URL content
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
        console.log('🔄 Switching to GPT 5.2 Mini');
        this.selectedModel = 'jarvis-low';
        this.selectedModelName = 'GPT 5.2 Mini';
        this.isLowModelMode = true;
        
        // Update UI
        if (this.currentModelDisplay) {
            this.currentModelDisplay.textContent = 'GPT 5.2 Mini';
        }
        
        // Update tier toggle UI
        this.updateTierToggleUI();
        
        if (!silent) {
            this.showNotification('Switched to GPT 5.2 Mini', true);
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
                // Switch to High (default ChatGPT 5.2)
                this.isLowModelMode = false;
                this.selectModel('default', 'ChatGPT 5.2');
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
        
        // Hide counter for premium users
        if (this.hasPremiumAccess()) {
            this.messageCounter.classList.add('hidden');
            this.messageCounter.classList.remove('upgrade-btn');
            console.log('Premium access - hiding message counter');
            return;
        }
        
        // Check and reset if 24 hours have passed
        this.checkAndResetMessageCount();
        
        const remaining = this.getRemainingMessages();
        
        // Update styling
        this.messageCounter.classList.remove('warning', 'critical', 'upgrade-btn');
        
        if (remaining === 0) {
            // Show upgrade button only when out of messages
            this.messageCounter.classList.remove('hidden');
            this.messageCountText.textContent = '⬆ Upgrade';
            this.messageCounter.classList.add('upgrade-btn');
            this.messageCounter.style.cursor = 'pointer';
            
            // Add click handler for upgrade
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
            // Hide counter when user still has messages remaining
            this.messageCounter.classList.add('hidden');
            this.messageCounter.style.cursor = 'default';
            this.messageCounter.onclick = null;
            console.log(`Free tier - ${remaining}/${this.maxFreeMessages} messages remaining (counter hidden)`);
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

            this.showNotification('📸 Capturing screenshot...');
            
            await this.captureScreen();
            
            if (!this.currentScreenCapture) {
                this.showNotification('❌ Failed to capture screenshot');
                return;
            }

            // If screen capture is black (protected content), try window capture then all windows
            if (this.isElectron && window.require) {
                const { ipcRenderer } = window.require('electron');
                if (await this.isScreenshotMostlyBlack(this.currentScreenCapture)) {
                    const windowShot = await ipcRenderer.invoke('take-screenshot-window');
                    if (windowShot && !(await this.isScreenshotMostlyBlack(windowShot))) {
                        this.currentScreenCapture = windowShot;
                    } else {
                        const allWindows = await ipcRenderer.invoke('take-screenshot-all-windows');
                        for (const w of allWindows || []) {
                            if (w.dataUrl && !(await this.isScreenshotMostlyBlack(w.dataUrl))) {
                                this.currentScreenCapture = w.dataUrl;
                                break;
                            }
                        }
                    }
                }
            }

            if (await this.isScreenshotMostlyBlack(this.currentScreenCapture)) {
                this.currentScreenCapture = null;
                this.showNotification('The screenshot is blank (browser/Lockdown content is protected). Paste the question text in the chat instead.', 'error');
                if (this.textInput) {
                    this.textInput.focus();
                    this.textInput.placeholder = 'Ask Jarvis, / for commands';
                }
                return;
            }

            this.showNotification('📸 Screenshot captured, analyzing...');

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
            
            if (this.shouldUseConversationMemory()) {
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
            }
            
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
        
        this.messagesContainer.addEventListener('wheel', (e) => {
            // Allow normal scrolling inside individual chat boxes
            const targetIsOutput = e.target.closest('.drag-output');
            if (targetIsOutput) {
                return;
            }
            // Allow normal scrolling behavior
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
            // Use AI-powered humanization based on https://github.com/blader/humanizer
            const humanizedText = await this.humanizeTextWithAI(text);
            
            // Display the humanized text
            this.showNotification(humanizedText, false);
            
            if (this.shouldUseConversationMemory()) {
                this.conversationHistory.push({
                    role: 'assistant',
                    content: humanizedText
                });
            }
        } catch (error) {
            console.error('Humanize error:', error);
            this.showNotification('Error humanizing text: ' + error.message, false);
        }
    }
    
    /**
     * AI-powered humanizer based on https://github.com/blader/humanizer
     * Uses Wikipedia's "Signs of AI writing" guide to remove AI patterns
     */
    async humanizeTextWithAI(text) {
        const humanizerPrompt = `You are a writing editor that identifies and removes signs of AI-generated text to make writing sound more natural and human. Based on Wikipedia's "Signs of AI writing" guide.

## Your Task
Rewrite the following text to remove AI patterns while:
1. Preserving the core meaning
2. Making it sound natural when read aloud
3. Adding personality and voice - don't just remove bad patterns, inject actual human feeling

## KEY PATTERNS TO FIX:

### Content Patterns:
- Remove significance inflation ("pivotal moment", "testament to", "vital role", "underscores importance")
- Remove superficial -ing analyses ("highlighting...", "showcasing...", "reflecting...")
- Remove promotional language ("groundbreaking", "nestled", "vibrant", "breathtaking")
- Replace vague attributions ("Experts believe", "Industry observers") with specific sources or remove
- Remove formulaic "Despite challenges... continues to thrive" patterns

### Language Patterns:
- Replace AI vocabulary: Additionally→also, crucial→important, delve→explore, landscape→(remove or be specific), testament→(remove), underscore→(remove), showcase→show, foster→(remove or simplify)
- Fix copula avoidance: "serves as"→"is", "stands as"→"is", "boasts"→"has", "features"→"has"
- Remove negative parallelisms ("It's not just X, it's Y")
- Break up rule-of-three patterns (innovation, inspiration, insights)
- Stop synonym cycling - use the same word when it's clearest
- Remove false ranges ("from X to Y" where X and Y aren't on a meaningful scale)

### Style Patterns:
- Reduce em dash overuse — use commas or periods instead
- Remove excessive boldface
- Convert inline-header lists to prose
- Use sentence case in headings, not Title Case
- Remove emojis from professional text
- Use straight quotes "like this" not curly quotes

### Communication Patterns:
- Remove chatbot artifacts ("I hope this helps!", "Let me know if...", "Great question!")
- Remove knowledge-cutoff disclaimers ("While specific details are limited...")
- Remove sycophantic tone ("You're absolutely right!", "Excellent point!")

### Filler and Hedging:
- "In order to" → "To"
- "Due to the fact that" → "Because"
- "At this point in time" → "Now"
- Remove excessive hedging ("could potentially possibly")
- Remove generic positive conclusions ("The future looks bright")

## ADDING SOUL:
- Vary sentence rhythm (mix short punchy with longer ones)
- Have opinions when appropriate
- Acknowledge complexity and mixed feelings
- Use "I" when it fits
- Be specific about feelings
- Let some natural messiness in

## OUTPUT:
Return ONLY the rewritten text. No explanations, no "Here's the humanized version:", just the improved text.

---
TEXT TO HUMANIZE:
${text}`;

        // Use the existing API proxy infrastructure
        if (!this.apiProxyUrl || !this.supabaseAnonKey) {
            throw new Error('API not available. Please ensure you are logged in.');
        }
        
        const requestPayload = {
            model: this.currentModel,
            instructions: 'You are a writing editor specializing in making AI-generated text sound natural and human. Output only the rewritten text with no preamble or explanation.',
            input: [{
                role: 'user',
                content: [
                    { type: 'input_text', text: humanizerPrompt }
                ]
            }]
        };
        
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
                payload: requestPayload
            })
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('Humanize API error:', errorText);
            throw new Error(`API request failed: ${response.status}`);
        }

        const data = await response.json();
        
        // Extract text from the responses API format
        const extractedText = this.extractText(data);
        if (extractedText) {
            return extractedText.trim();
        }
        
        throw new Error('Invalid response from API');
    }

    // ========== OUTPUT TOOLBAR FUNCTIONS ==========
    
    initializeOutputToolbar() {
        // Double-click on output copies to clipboard immediately (toolbar removed)
        if (this.messagesContainer) {
            this.messagesContainer.addEventListener('dblclick', (e) => {
                const output = e.target.closest('#drag-output');
                if (output) {
                    this.copyOutputToClipboard();
                }
            });
        }
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
                this.showNotification('Copied to clipboard', true);
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
        // Write to Docs removed from build
        this.showNotification('Write to Docs is not available in this build', false);
    }
    
    // ========== END OUTPUT TOOLBAR FUNCTIONS ==========

    async writeToDocs(_usePasteMode = false) {
        // Write to Docs removed from build
        this.showNotification('Write to Docs is not available in this build', false);
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
        this.cancelRunningCommand();
        
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

    // Cancel any running command (OpenAI streaming, etc.)
    cancelRunningCommand() {
        let cancelled = false;
        
        // Cancel any streaming response (for OpenAI/OpenRouter)
        if (this.currentAbortController) {
            this.currentAbortController.abort();
            this.currentAbortController = null;
            console.log('🛑 Cancelled streaming response');
            cancelled = true;
        }
        
        // Stop loading animation if running
        if (cancelled) {
            this.stopLoadingAnimation();
            this.showNotification('⏹️ Command cancelled', true);
        }
        
        return cancelled;
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
        
        // Clear drag flag after a short delay to ensure drag-drop completes.
        // Do not set click-through here based on mouse position – it can be wrong
        // after drag; mouseleave will set click-through when the user actually leaves.
        setTimeout(() => {
            this.isDraggingOutput = false;
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
        // Do not set click-through here based on mouse position – rely on mouseleave only
        // so the overlay doesn’t get stuck click-through.
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
                
                // Initialize overlay color and opacity (default: black, 100% so first launch is not more transparent)
                const savedColor = localStorage.getItem('jarvis-overlay-color') || 'black';
                const savedOpacity = localStorage.getItem('jarvis-overlay-opacity') || '100';
                jarvis.currentOpacity = parseInt(savedOpacity);
                jarvis.setOverlayColor(savedColor);
                jarvis.setOverlayOpacity(parseInt(savedOpacity));
                
                const opacitySlider = document.getElementById('opacity-slider');
                if (opacitySlider) opacitySlider.value = savedOpacity;
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


