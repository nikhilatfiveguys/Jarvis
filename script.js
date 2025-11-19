class JarvisOverlay {
    constructor() {
        this.isActive = false;
        this.currentScreenCapture = null;
        this.isElectron = typeof require !== 'undefined';
        this.isPinkMode = false; // Track pink mode state
        this.currentDocument = null; // Store current document from Exa API
        this.isProcessingDocument = false; // Track document processing state
        this.loadingInterval = null; // Track active loading animation interval
        this.loadingMessageInterval = null; // Track message rotation interval
        this.currentLoadingMessage = null; // Current loading message being displayed
        this.loadingMessageIndex = 0; // Index for rotating loading messages
        
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
        
        // Message tracking for free users
        this.maxFreeMessages = 5;
        this.messageCount = this.loadMessageCount();
        
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
        this.checkLicense();
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
                        this.apiProxyUrl = apiKeys.apiProxyUrl;
                        this.supabaseAnonKey = apiKeys.supabaseAnonKey;
                        console.log('✅ API keys loaded from main process');
                        console.log('OpenAI key present:', !!this.apiKey);
                        console.log('Perplexity key present:', !!this.perplexityApiKey);
                        console.log('Claude key present:', !!this.claudeApiKey);
                        console.log('API Proxy URL:', this.apiProxyUrl || 'NOT CONFIGURED (using direct API calls)');
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
            
            console.log('✅ API keys loaded (fallback method)');
            console.log('OpenAI key present:', !!this.apiKey);
            console.log('Perplexity key present:', !!this.perplexityApiKey);
            console.log('Claude key present:', !!this.claudeApiKey);
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
        
        // Add web search tool if Perplexity API key is available (check for truthy and non-empty string)
        if (this.perplexityApiKey && this.perplexityApiKey.trim() !== '') {
            this.tools.push({
                type: "function",
                name: "searchweb",
                description: "Searches the web using Perplexity AI to get current, up-to-date information. Use this when you need real-time data, current events, recent information, or anything beyond your knowledge cutoff.",
                parameters: {
                    type: "object",
                    properties: {
                        query: {
                            type: "string",
                            description: "The search query to find information about"
                        }
                    },
                    required: ["query"]
                }
            });
            console.log('✅ Perplexity web search tool added');
        } else {
            console.warn('⚠️ Perplexity API key not available - web search tool not added');
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
                }
                
                // Update message counter display
                this.updateMessageCounter();
            }
        } catch (error) {
            console.error('Failed to check license:', error);
            this.licenseStatus = { valid: false, type: 'error' };
            this.features = {};
            // Still update message counter even on error
            this.updateMessageCounter();
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

        /* Voice recording temporarily disabled
        // Request microphone permission
        this.requestMicrophonePermission();

        // Listen for voice recording events from main process
        ipcRenderer.on('voice-recording-started', () => {
            this.showVoiceRecordingIndicator();
        });

        ipcRenderer.on('voice-recording-stopped', () => {
            this.hideVoiceRecordingIndicator();
        });

        ipcRenderer.on('voice-transcription', (event, text) => {
            this.handleVoiceTranscription(text);
        });

        ipcRenderer.on('voice-recording-error', (event, error) => {
            this.showVoiceError(error);
        });
        */

        // Listen for subscription cancellation
        ipcRenderer.on('subscription-cancelled', () => {
            this.handleSubscriptionCancelled();
        });

        // Listen for subscription activation
        ipcRenderer.on('subscription-activated', (event, data) => {
            this.handleSubscriptionActivated(data);
        });

        // Listen for paywall display request
        ipcRenderer.on('show-paywall', () => {
            this.showPaywall();
        });
    }

    async requestMicrophonePermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
        } catch (error) {
            console.error('Microphone permission denied:', error);
            this.showNotification('Microphone permission required for voice recording', 'error');
        }
    }

    showVoiceRecordingIndicator() {
        // Create or show voice recording indicator
        let indicator = document.getElementById('voice-recording-indicator');
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'voice-recording-indicator';
            indicator.className = 'voice-recording-indicator';
            indicator.innerHTML = 'recording...';
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

    handleVoiceTranscription(text) {
        if (text && text.trim()) {
            // Set the input value and send the transcribed text to the API
            this.textInput.value = text.trim();
            this.sendMessage();
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

    initializeElements() {
        this.overlay = document.getElementById('jarvis-overlay');
        this.instructions = document.getElementById('instructions');
        this.activationIndicator = document.getElementById('activation-indicator');
        this.textInput = document.getElementById('text-input');
        this.sendBtn = document.getElementById('send-btn');
        this.dragOutput = document.getElementById('drag-output');
        this.dragHandle = document.getElementById('drag-handle');
        this.closeOutputBtn = document.getElementById('close-output');
        this.closeOutputFloating = document.getElementById('close-output-floating');
        this.answerThisBtn = document.getElementById('answer-this-btn');
        this.humanizeBtn = document.getElementById('humanize-btn');
        this.startBtn = document.getElementById('start-jarvis');
        this.resizeHandle = document.getElementById('resize-handle');
        this.settingsBtn = document.getElementById('settings-btn');
        this.settingsMenu = document.getElementById('settings-menu');
        this.addFileBtn = document.getElementById('add-file-btn');
        this.clearChatBtn = document.getElementById('clear-chat-btn');
        this.settingsCloseBtn = document.getElementById('settings-close-btn');
        this.accountInfoBtn = document.getElementById('account-info-btn');
        this.fileInput = document.getElementById('file-input');
        this.accountModal = document.getElementById('account-modal');
        this.accountModalClose = document.getElementById('account-modal-close');
        this.accountModalOk = document.getElementById('account-modal-ok');
        this.userEmailElement = document.getElementById('user-email');
        this.premiumStatusElement = document.getElementById('premium-status');
        this.messageCounter = document.getElementById('message-counter');
        this.messageCountText = document.getElementById('message-count-text');
        this.attachmentsBar = document.getElementById('attachments-bar');
        this.messagesContainer = document.getElementById('messages-container');
        this.revealHistoryBtn = document.getElementById('reveal-history-btn');
        
        // Set up MutationObserver to keep scroll at bottom when content changes
        this.setupScrollObserver();
        
        
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.isDraggingOutput = false; // Track if output element is being dragged
        this.pendingAttachments = [];
        
        this.currentModel = 'gpt-5-mini';
        // API keys will be loaded via loadApiKeys() method
        this.apiKey = null;
        this.perplexityApiKey = null;
        this.claudeApiKey = null;
        this.apiProxyUrl = null;
        this.supabaseAnonKey = null;
        this.naturalWriteApiKey = 'nw_6f9427e5026add995264a567970f5b0ce09f39be867f8921';
        // Initialize tools array (will be rebuilt after API keys are loaded)
        this.tools = [];
        
        // Load API keys asynchronously and rebuild tools array when done
        this.loadApiKeys().catch(err => console.error('Failed to load API keys:', err));
    }

    setupEventListeners() {
        if (this.startBtn) this.startBtn.addEventListener('click', () => this.startJarvis());
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.textInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        
        
        if (this.answerThisBtn) {
            this.answerThisBtn.addEventListener('click', () => this.answerThis());
        }
        
        if (this.humanizeBtn) {
            this.humanizeBtn.addEventListener('click', () => this.humanize());
        }
        
        // Reveal history button event listener
        if (this.revealHistoryBtn) {
            this.revealHistoryBtn.addEventListener('click', () => this.toggleChatHistory());
        }
        
        // Settings button event listeners
        if (this.settingsBtn) {
            this.settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleSettingsMenu();
            });
        }
        
        // Add File menu item -> trigger hidden file input
        if (this.addFileBtn && this.fileInput) {
            this.addFileBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.fileInput.value = '';
                this.fileInput.click();
            });
            this.fileInput.addEventListener('change', async (e) => {
                const files = Array.from(e.target.files || []);
                if (files.length > 0) {
                    await this.handleSelectedFiles(files);
                    this.hideSettingsMenu();
                }
            });
        }
        
        if (this.clearChatBtn) {
            this.clearChatBtn.addEventListener('click', () => this.clearChatHistory());
        }
        
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
        
        if (this.accountModalClose) {
            this.accountModalClose.addEventListener('click', () => this.hideAccountModal());
        }
        
        if (this.accountModalOk) {
            this.accountModalOk.addEventListener('click', () => this.hideAccountModal());
        }
        
        
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
            if (this.settingsMenu && !this.settingsMenu.contains(e.target) && !this.settingsBtn.contains(e.target)) {
                this.hideSettingsMenu();
            }
        });
        
        // Make overlay interactive when hovering over input area
        if (this.overlay) {
            this.overlay.addEventListener('mouseenter', () => {
                if (this.isElectron) {
                    const { ipcRenderer } = require('electron');
                    ipcRenderer.invoke('make-interactive');
                }
            });
            
            this.overlay.addEventListener('mouseleave', () => {
                // Don't set click-through if dragging output or resizing
                if (this.isDraggingOutput || this.isResizing) {
                    return;
                }
                if (this.isElectron) {
                    const { ipcRenderer } = require('electron');
                    ipcRenderer.invoke('make-click-through');
                }
            });
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
            // Track drag to enable click-through when outside overlay
            this.dragOutput.addEventListener('drag', (e) => {
                if (this.isDraggingOutput && this.isElectron) {
                    const { ipcRenderer } = require('electron');
                    // Check if mouse is outside overlay bounds
                    const overlayRect = this.overlay.getBoundingClientRect();
                    const mouseX = e.clientX;
                    const mouseY = e.clientY;
                    
                    // If mouse is outside overlay, enable drag-through mode
                    if (mouseX < overlayRect.left || mouseX > overlayRect.right || 
                        mouseY < overlayRect.top || mouseY > overlayRect.bottom) {
                        ipcRenderer.invoke('enable-drag-through');
                    } else {
                        // Mouse is still over overlay, keep interactive
                        ipcRenderer.invoke('make-interactive');
                    }
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
            
        ipcRenderer.on('toggle-overlay', () => {
            this.toggleOverlay();
        });
        
        ipcRenderer.on('show-overlay', () => {
            this.showOverlay();
        });
        
        ipcRenderer.on('hide-overlay', () => {
            this.hideOverlay();
        });
    }

    setupDragFunctionality() {
        if (!this.dragHandle) return;
        
        // Add double-click handler to move to top middle
        this.dragHandle.addEventListener('dblclick', () => {
            this.moveToTopMiddle();
        });
        
        this.dragHandle.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            // Get the actual visual position of the overlay (accounting for transform)
            const rect = this.overlay.getBoundingClientRect();
            
            // Calculate offset from mouse position to overlay's top-left corner
            this.dragOffset.x = e.clientX - rect.left;
            this.dragOffset.y = e.clientY - rect.top;
            
            // If overlay is still using transform, convert to absolute positioning
            const computedStyle = window.getComputedStyle(this.overlay);
            if (computedStyle.transform !== 'none' || computedStyle.left === '50%' || computedStyle.top === '50%') {
                // Convert from centered position to absolute
                const currentLeft = rect.left;
                const currentTop = rect.top;
                this.overlay.style.left = `${currentLeft}px`;
                this.overlay.style.top = `${currentTop}px`;
                this.overlay.style.transform = 'none';
            }
            
            this.isDragging = true;
            this.overlay.style.cursor = 'grabbing';
            this.overlay.classList.add('dragging');
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            
            // Calculate new position based on mouse position minus offset
            const newX = e.clientX - this.dragOffset.x;
            const newY = e.clientY - this.dragOffset.y;
            
            // Constrain to viewport bounds
            const overlayWidth = this.overlay.offsetWidth || 400;
            const overlayHeight = this.overlay.offsetHeight || 100;
            const maxX = window.innerWidth - overlayWidth;
            const maxY = window.innerHeight - overlayHeight;
            
            this.overlay.style.left = `${Math.max(0, Math.min(newX, maxX))}px`;
            this.overlay.style.top = `${Math.max(0, Math.min(newY, maxY))}px`;
            this.overlay.style.transform = 'none';
        });
        
        document.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.overlay.style.cursor = 'default';
                this.overlay.classList.remove('dragging');
            }
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


    toggleOverlay() {
        if (this.isActive) {
            this.hideOverlay();
        } else {
            this.showOverlay();
        }
    }

    async showOverlay() {
        if (!this.overlay) return;
        
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
        this.recenterOverlay();
        this.isActive = true;
        this.textInput.focus();
        
        // Update message counter to reflect current subscription status
        this.updateMessageCounter();
        
        this.showNotification('Jarvis is ready! Look for the red X button in the top-right corner of this message.');
    }

    recenterOverlay() {
        if (!this.overlay) return;
        this.overlay.style.left = '50%';
        this.overlay.style.top = '50%';
        this.overlay.style.transform = 'translate(-50%, -50%)';
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
            
            const response = await fetch('https://api.openai.com/v1/responses', {
                        method: 'POST',
                        headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                    model: this.currentModel,
                    instructions: 'Answer ONLY with the direct answer. No preface, no restating the question. Be as short as possible while correct.',
                            input: [{
                                role: 'user',
                                content: [
                            { type: 'input_text', text: prompt },
                            { type: 'input_image', image_url: imageUrl }
                        ]
                    }]
                })
            });

            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json();
            const analysis = this.extractText(data) || 'Unable to analyze';
            
            this.conversationHistory.push({ role: 'user', content: prompt });
            this.conversationHistory.push({ role: 'assistant', content: analysis });
            
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

            // Check for screenshot keyword - automatically take and analyze screenshot
            const lowerMessage = message.toLowerCase();
            if (lowerMessage.includes('screenshot') || lowerMessage.includes('screen shot')) {
                await this.captureAndAnalyzeScreen(message);
                return;
            }
            
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
            
            // Check for URL in message - extract website content
            const urlMatch = message.match(/(https?:\/\/[^\s]+)/);
            if (urlMatch) {
                const url = urlMatch[1];
                await this.extractAndProcessDocument(url, message);
                return;
            }
            
            this.showLoadingNotification();
            const response = await this.callChatGPT(message);
            this.showNotification(response, true);
            
            // Increment message count for free users
            if (!this.hasPremiumAccess()) {
                this.incrementMessageCount();
            }
        } catch (error) {
            console.error('Message processing error:', error);
            this.showNotification("Sorry, I'm having trouble processing that request right now.");
        }
    }

    async callChatGPT(message) {
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

            const inputContent = [{ type: 'input_text', text: message }];
            const webSearchHint = this.perplexityApiKey ? ' Use searchweb for current events.' : '';
            const claudeHint = this.claudeApiKey ? ' Use the askclaude tool for complex analytical questions, deep reasoning, philosophical questions, or when you need more thorough analysis.' : '';
            const instructions = `You are Jarvis. An AI assistant powered by many different AI models. Answer directly without any preface, introduction, or phrases like "here's the answer" or "the answer is". Just provide the answer immediately. Respond concisely. Use getscreenshot for screen questions.${webSearchHint}${claudeHint}${conversationContext}${documentContext}`;

            // Debug: Log available tools
            console.log('Available tools:', this.tools.map(t => t.name));
            console.log('Claude tool registered:', this.tools.some(t => t.name === 'askclaude'));
            
            const requestPayload = {
                model: this.currentModel,
                instructions: instructions,
                input: [{ role: 'user', content: inputContent }],
                tools: this.tools
            };
            
            console.log('API Request payload:', JSON.stringify(requestPayload, null, 2));

            this.showLoadingNotification();
            
            // Use Edge Function proxy if available, otherwise direct API call
            let response;
            if (this.apiProxyUrl && this.supabaseAnonKey) {
                // Use Supabase Edge Function proxy (secure - no API keys in app)
                console.log('🔒 Using Supabase Edge Function proxy for OpenAI');
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
                // Fallback to direct API call (requires API key)
                console.log('⚠️ Using direct OpenAI API call (API key required)');
                response = await fetch('https://api.openai.com/v1/responses', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(requestPayload)
                });
            }
            
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
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
                                this.showNotification('✅ Step 7a complete: Screenshot captured and added to context');
                            } else if (typeof result === 'string') {
                                inputContent.push({ type: 'input_text', text: `Screenshot: ${result}` });
                                this.showNotification('✅ Step 7a complete: Screenshot processed');
                            }
                        } else if (toolCall.name === 'searchweb') {
                            const query = toolCall.arguments?.query || toolCall.arguments?.query_string || '';
                            if (!query) {
                                console.error('SearchWeb tool called without query:', toolCall.arguments);
                                inputContent.push({ type: 'input_text', text: 'Web search: No query provided' });
                                this.showNotification('⚠️ Step 7b: No search query provided');
                            } else {
                                const result = await this.executeSearchWeb(query);
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
                
                console.log('Making second API call with tool results. Has Claude response:', hasClaudeResponse);
                
                response = await fetch('https://api.openai.com/v1/responses', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: this.currentModel,
                        instructions: finalInstructions,
                        input: [{ role: 'user', content: inputContent }]
                    })
                });
                
                if (!response.ok) {
                    throw new Error(`API error: ${response.status}`);
                }
                
                data = await response.json();
            }
            
            const finalResponse = this.extractText(data);
            // Stop loading animation before showing final response
            this.stopLoadingAnimation();
            const safeResponse = typeof finalResponse === 'string' ? finalResponse : String(finalResponse || 'No response');
            
            this.conversationHistory.push({ role: 'user', content: message });
            this.conversationHistory.push({ role: 'assistant', content: safeResponse });
            
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
        // Check if Perplexity API key is available (check for truthy and non-empty string)
        if (!this.perplexityApiKey || this.perplexityApiKey.trim() === '') {
            console.warn('⚠️ Perplexity API key not available for web search');
            return `Web search is not available. To enable web search, set the PPLX_API_KEY environment variable with your Perplexity API key.`;
        }

        try {
            // Start loading notification with search context (don't stop it here - let it continue until final answer)
            this.showLoadingNotification(null, 'search');
            
            // Use Edge Function proxy if available, otherwise direct API call
            let perplexityResponse;
            if (this.apiProxyUrl && this.supabaseAnonKey) {
                // Use Supabase Edge Function proxy (secure - no API keys in app)
                console.log('🔒 Using Supabase Edge Function proxy for Perplexity');
                perplexityResponse = await fetch(this.apiProxyUrl, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.supabaseAnonKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        provider: 'perplexity',
                        payload: {
                            model: 'sonar',
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
                        }
                    })
                });
            } else {
                // Fallback to direct API call (requires API key)
                console.log('⚠️ Using direct Perplexity API call (API key required)');
                perplexityResponse = await fetch('https://api.perplexity.ai/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.perplexityApiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: 'sonar',
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
                    })
                });
            }
            
            if (!perplexityResponse.ok) {
                const errorData = await perplexityResponse.json().catch(() => ({}));
                console.error('Perplexity API Error:', errorData);
                this.stopLoadingAnimation();
                return `Web search failed: ${errorData.error?.message || 'API error'}`;
            }
            
            const perplexityData = await perplexityResponse.json();
            // Don't stop loading here - it will continue through the synthesis phase
            // Switch to default loading context for the synthesis phase
            this.showLoadingNotification(null, 'default');
            return perplexityData.choices[0].message.content;
        } catch (error) {
            console.error('Web search error:', error);
            this.stopLoadingAnimation();
            return `Web search error: ${error.message}`;
        }
    }

    async executeAskClaude(question) {
        // Check if Claude API key is available (check for truthy and non-empty string)
        if (!this.claudeApiKey || this.claudeApiKey.trim() === '') {
            console.warn('⚠️ Claude API key not available');
            return `Claude is not available. To enable Claude, set the CLAUDE_API_KEY environment variable with your Anthropic API key.`;
        }

        // Validate API key format
        if (!this.claudeApiKey.startsWith('sk-ant-')) {
            console.error('Invalid Claude API key format. Should start with "sk-ant-"');
            return `Claude API key format is invalid. Please check your CLAUDE_API_KEY.`;
        }

        try {
            // Start loading notification with Claude context
            this.showLoadingNotification(null, 'claude');
            
            // Present the question directly to Claude without confusing context
            const messages = [];
            
            // Only include recent USER messages for context (skip assistant messages entirely)
            // This prevents Claude from seeing confusing references to "Claude's analysis"
            if (this.conversationHistory.length > 0) {
                const recentHistory = this.conversationHistory.slice(-5);
                recentHistory.forEach(msg => {
                    // Only include user messages - skip all assistant messages
                    if (msg.role === 'user') {
                        let contentStr = '';
                        if (typeof msg.content === 'string') {
                            contentStr = msg.content.trim();
                        } else if (msg.content) {
                            contentStr = String(msg.content).trim();
                        }
                        
                        // Filter out messages that reference Claude tool usage
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
            
            // Build the current question - present it naturally as a direct question
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
            
            // Add the question directly to Claude - it should respond naturally
            if (currentQuestion && currentQuestion.trim().length > 0) {
                messages.push({
                    role: 'user',
                    content: currentQuestion.trim()
                });
            } else {
                throw new Error('Question cannot be empty');
            }
            
            // Validate messages array - must have at least one user message
            if (messages.length === 0 || !messages.some(m => m.role === 'user')) {
                throw new Error('Messages array must contain at least one user message');
            }
            
            // Prepare request body - try different model name formats
            const requestBody = {
                model: 'claude-sonnet-4-5-20250929', // Full model name with date
                max_tokens: 4096,
                messages: messages
            };
            
            console.log('Calling Claude API with:', {
                model: requestBody.model,
                messageCount: messages.length,
                apiKeyPrefix: this.claudeApiKey.substring(0, 15) + '...',
                requestBody: JSON.stringify(requestBody, null, 2)
            });
            
            // Try the API call - if it fails with bad request, try alternative model names
            let claudeResponse;
            let lastError;
            
            // Try with full model name first
            try {
                // Use Edge Function proxy if available, otherwise direct API call
                if (this.apiProxyUrl && this.supabaseAnonKey) {
                    // Use Supabase Edge Function proxy (secure - no API keys in app)
                    console.log('🔒 Using Supabase Edge Function proxy for Claude');
                    claudeResponse = await fetch(this.apiProxyUrl, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${this.supabaseAnonKey}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            provider: 'claude',
                            payload: requestBody
                        })
                    });
                    
                    // If bad request, try alternative model names
                    if (claudeResponse.status === 400) {
                        const altModels = ['claude-sonnet-4-5', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'];
                        for (const altModel of altModels) {
                            console.log(`Trying alternative model: ${altModel}`);
                            requestBody.model = altModel;
                            claudeResponse = await fetch(this.apiProxyUrl, {
                                method: 'POST',
                                headers: {
                                    'Authorization': `Bearer ${this.supabaseAnonKey}`,
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify({
                                    provider: 'claude',
                                    payload: requestBody
                                })
                            });
                            if (claudeResponse.ok) {
                                console.log(`Success with model: ${altModel}`);
                                break;
                            }
                        }
                    }
                } else {
                    // Fallback to direct API call (requires API key)
                    console.log('⚠️ Using direct Claude API call (API key required)');
                    claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
                        method: 'POST',
                        headers: {
                            'x-api-key': this.claudeApiKey,
                            'anthropic-version': '2023-06-01',
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(requestBody)
                    });
                    
                    // If bad request, try alternative model names
                    if (claudeResponse.status === 400) {
                        const altModels = ['claude-sonnet-4-5', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'];
                        for (const altModel of altModels) {
                            console.log(`Trying alternative model: ${altModel}`);
                            requestBody.model = altModel;
                            claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
                                method: 'POST',
                                headers: {
                                    'x-api-key': this.claudeApiKey,
                                    'anthropic-version': '2023-06-01',
                                    'Content-Type': 'application/json'
                                },
                                body: JSON.stringify(requestBody)
                            });
                            if (claudeResponse.ok) {
                                console.log(`Success with model: ${altModel}`);
                                break;
                            }
                        }
                    }
                }
            } catch (fetchError) {
                console.error('Fetch error:', fetchError);
                throw fetchError;
            }
            
            console.log('Claude API response status:', claudeResponse.status, claudeResponse.statusText);
            console.log('Claude API response headers:', Object.fromEntries(claudeResponse.headers.entries()));
            console.log('Request body that was sent:', JSON.stringify(requestBody, null, 2));
            
            if (!claudeResponse.ok) {
                const errorText = await claudeResponse.text();
                console.error('Claude API error response text:', errorText);
                console.error('Full request details:', {
                    url: 'https://api.anthropic.com/v1/messages',
                    method: 'POST',
                    headers: {
                        'x-api-key': this.claudeApiKey.substring(0, 20) + '...',
                        'anthropic-version': '2023-06-01',
                        'Content-Type': 'application/json'
                    },
                    body: requestBody
                });
                
                let errorData;
                try {
                    errorData = JSON.parse(errorText);
                } catch (e) {
                    errorData = { error: { message: errorText || `HTTP ${claudeResponse.status}` } };
                }
                
                console.error('Claude API Error Details:', {
                    status: claudeResponse.status,
                    statusText: claudeResponse.statusText,
                    error: errorData,
                    fullErrorText: errorText
                });
                
                this.stopLoadingAnimation();
                
                // Provide helpful error messages
                if (claudeResponse.status === 401) {
                    return `Claude API authentication failed (401). Check your API key. Error: ${errorData.error?.message || errorText}`;
                } else if (claudeResponse.status === 403) {
                    return `Claude API access forbidden (403). Your API key may not have permission. Error: ${errorData.error?.message || errorText}`;
                } else if (claudeResponse.status === 400) {
                    return `Claude API bad request (400). Check model name and request format. Error: ${errorData.error?.message || errorText}`;
                } else if (claudeResponse.status === 404) {
                    return `Claude API endpoint not found (404). Check API URL. Error: ${errorData.error?.message || errorText}`;
                } else {
                    return `Claude analysis failed (${claudeResponse.status}): ${errorData.error?.message || errorData.error?.type || errorText || 'Unknown error'}`;
                }
            }
            
            const claudeData = await claudeResponse.json();
            console.log('Claude API success, response structure:', Object.keys(claudeData));
            
            // Extract text from Claude's response
            // Claude returns content as an array of text blocks
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
            
            // Don't stop loading here - it will continue through the synthesis phase
            // Switch to default loading context for the synthesis phase
            this.showLoadingNotification(null, 'default');
            return textContent;
        } catch (error) {
            console.error('Claude API error:', error);
            this.stopLoadingAnimation();
            return `Claude error: ${error.message}`;
        }
    }


    async sendMessage() {
        const message = (this.textInput?.value || '').trim();
        if (!message && (!this.pendingAttachments || this.pendingAttachments.length === 0)) return;

        // Immediately clear UI input so text disappears as soon as user sends
        if (this.textInput) this.textInput.value = '';
        if (this.sendBtn) this.sendBtn.disabled = true;

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
        } finally {
            if (this.sendBtn) this.sendBtn.disabled = false;
        }
    }

    showNotification(text, isHTML = false) {
        if (!this.dragOutput) return;
        
        // Stop any active loading animation
        this.stopLoadingAnimation();
        
        const content = String(text || '');
        
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
        
        // Add resize handle
        const resizeHandle = document.createElement('div');
        resizeHandle.id = 'resize-handle';
        resizeHandle.className = 'resize-handle';
        resizeHandle.title = 'Drag to resize';
        currentOutput.appendChild(resizeHandle);
        
        currentOutput.dataset.fullText = content.replace(/<[^>]*>/g, '');
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
        
        // Show answer this button
        if (this.answerThisBtn) {
            this.answerThisBtn.classList.remove('hidden');
            this.answerThisBtn.classList.remove('answer-this-default');
        }
        
        // Show humanize button
        if (this.humanizeBtn) {
            this.humanizeBtn.classList.remove('hidden');
        }
        
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
        if (this.isElectron && window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.invoke('open-account-window');
            this.hideSettingsMenu();
        } else {
            // Fallback for web version
            if (this.accountModal) {
                this.updateAccountInfo();
                this.accountModal.classList.remove('hidden');
                this.hideSettingsMenu();
            }
        }
    }

    hideAccountModal() {
        if (this.accountModal) {
            this.accountModal.classList.add('hidden');
        }
    }

    showAccountWindow() {
        if (this.isElectron && window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.invoke('open-account-window');
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
            const response = await fetch('https://api.openai.com/v1/responses', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.currentModel,
                    instructions: 'Analyze the provided files and respond to the user succinctly and clearly.',
                    input: [{ role: 'user', content }]
                })
            });
            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `API error: ${response.status}`);
            }
            const data = await response.json();
            const analysis = this.extractText(data) || 'Unable to analyze files';
            const userMessage = `${prompt} [Attached ${files.length} file(s): ${files.map(f => f.name).join(', ')}]`;
            this.conversationHistory.push({ role: 'user', content: userMessage });
            this.conversationHistory.push({ role: 'assistant', content: analysis });
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

            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.currentModel,
                    messages: [
                        { role: 'system', content: instructions },
                        { role: 'user', content: question }
                    ],
                    max_tokens: 1000,
                    temperature: 0.7
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
        indicator.innerHTML = '📄 Processing document...';
        indicator.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            background: rgba(0, 0, 0, 0.8);
            color: white;
            padding: 10px 20px;
            border-radius: 20px;
            font-size: 14px;
            z-index: 10000;
            animation: pulse 1.5s infinite;
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

    updateMessageCounter() {
        if (!this.messageCounter || !this.messageCountText) {
            console.warn('Message counter elements not found');
            return;
        }
        
        // Only show counter for free users
        if (this.hasPremiumAccess()) {
            this.messageCounter.classList.add('hidden');
            console.log('Premium access - hiding message counter');
            return;
        }
        
        // Check and reset if 24 hours have passed
        this.checkAndResetMessageCount();
        
        // Show counter for free users
        this.messageCounter.classList.remove('hidden');
        const remaining = this.getRemainingMessages();
        this.messageCountText.textContent = `${remaining}/${this.maxFreeMessages}`;
        console.log(`Free tier - showing ${remaining}/${this.maxFreeMessages} messages remaining`);
        
        // Update styling based on remaining messages
        this.messageCounter.classList.remove('warning', 'critical');
        
        if (remaining <= 2) {
            this.messageCounter.classList.add('critical');
        } else if (remaining <= 5) {
            this.messageCounter.classList.add('warning');
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
        const message = `Message limit reached. Wait ${resetTimeText} or subscribe (click 3 lines → account → get premium)`;
        
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
                dragOutput.textContent = `Message limit reached. Wait ${resetTimeText} or subscribe (click 3 lines → account → get premium)`;
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

    processContent(content, isHTML) {
        let processed = content;
        
        // Make URLs clickable
        processed = processed.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color: #4A9EFF; text-decoration: underline;">$1</a>');
        
        // Format powers
        processed = processed.replace(/([a-zA-Z])\^(\d+)/g, '$1<sup>$2</sup>');
        processed = processed.replace(/\^(\d+)/g, '<sup>$1</sup>');
        
        // Format simple fractions
        processed = processed.replace(/(\d+)\/(\d+)/g, '<span style="display: inline-block; vertical-align: middle; text-align: center; margin: 0 2px;"><span style="border-bottom: 1px solid; padding-bottom: 1px;">$1</span><br><span>$2</span></span>');
        
        // Format common math symbols
        processed = processed.replace(/\bpi\b/g, 'π');
        processed = processed.replace(/\binfinity\b/g, '∞');
        processed = processed.replace(/\balpha\b/g, 'α');
        processed = processed.replace(/\bbeta\b/g, 'β');
        processed = processed.replace(/\bgamma\b/g, 'γ');
        processed = processed.replace(/\bdelta\b/g, 'δ');
        processed = processed.replace(/\btheta\b/g, 'θ');
        processed = processed.replace(/\blambda\b/g, 'λ');
        processed = processed.replace(/\bmu\b/g, 'μ');
        processed = processed.replace(/\bsigma\b/g, 'σ');
        
        // Format multiplication symbols
        processed = processed.replace(/\*/g, '×');
        
        return processed;
    }

    showChunkedResponse(content, isHTML = false) {
        // Split content into chunks of ~400 characters at sentence boundaries
        const chunks = this.chunkText(content, 400);
        
        // Display first chunk immediately
        const firstChunk = chunks[0];
        const processedFirstChunk = this.processContent(firstChunk, isHTML);
        
        this.dragOutput.innerHTML = processedFirstChunk;
        this.dragOutput.dataset.fullText = firstChunk.replace(/<[^>]*>/g, '');
        
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
            this.dragOutput.dataset.fullText = nextChunk.replace(/<[^>]*>/g, '');
            
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

            // Build conversation context with full history for better continuity
            this.showNotification('📝 Step 5: Building conversation context...');
            let conversationContext = '';
            if (this.conversationHistory.length > 0) {
                conversationContext = '\n\nPREVIOUS CONVERSATION (remember this context):\n' + 
                    this.conversationHistory.slice(-10).map((msg, idx) => 
                        `${idx + 1}. ${msg.role === 'user' ? 'User' : 'Jarvis'}: ${msg.content.substring(0, 300)}`
                    ).join('\n');
                this.showNotification('✅ Step 5 complete: Added conversation history to context');
            }
            
            // Call Responses API with screenshot and "answer this" message
            this.showLoadingNotification();
            
            const response = await fetch('https://api.openai.com/v1/responses', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.currentModel,
                    instructions: `You are Jarvis, a GPT-5 Mini powered assistant. Answer directly without any preface, introduction, or phrases like "here's the answer" or "the answer is". Just provide the answer immediately. Respond in ONE sentence only unless asked to elaborate. Be direct and concise.${conversationContext}`,
                    input: [{
                        role: 'user',
                        content: [
                            { type: 'input_text', text: 'answer this' },
                            { type: 'input_image', image_url: this.currentScreenCapture }
                        ]
                    }]
                })
            });
            
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }
            
            const data = await response.json();
            const finalResponse = this.extractText(data);
            // Stop loading animation before showing final response
            this.stopLoadingAnimation();
            
            // Update conversation history
            this.conversationHistory.push({
                role: 'user',
                content: 'answer this'
            });
            this.conversationHistory.push({
                role: 'assistant',
                content: finalResponse
            });
            
            if (this.conversationHistory.length > 30) {
                this.conversationHistory = this.conversationHistory.slice(-30);
            }
            
            this.saveConversationHistory();
            
            // Increment message count for free users
            if (!this.hasPremiumAccess()) {
                this.incrementMessageCount();
            }
            
            this.showNotification(finalResponse, true);
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
        // Show "coming soon" message
        this.showNotification('Coming soon', false);
    }

    positionFloatingClose() {
        try {
            if (!this.closeOutputFloating || !this.dragOutput || this.dragOutput.classList.contains('hidden')) return;
            
            // Wait for next frame to ensure element is positioned, then try again after a small delay
            // Use longer delay if it's a loading notification to ensure container is properly sized
            const isLoading = this.dragOutput && this.dragOutput.classList.contains('loading-notification');
            const delay = isLoading ? 200 : 10;
            
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    setTimeout(() => {
                        try {
                            if (!this.closeOutputFloating || !this.dragOutput || this.dragOutput.classList.contains('hidden')) return;
                            
                            // Get the actual position of drag-output on screen
                            const dragOutputRect = this.dragOutput.getBoundingClientRect();
                            const overlayRect = this.overlay.getBoundingClientRect();
                            
                            // Ensure we have valid dimensions
                            if (dragOutputRect.width === 0 || dragOutputRect.height === 0) {
                                // Retry if element not yet rendered
                                setTimeout(() => this.positionFloatingClose(), 50);
                                return;
                            }
                            
                            // For loading notifications, ensure we account for container position
                            let topPosition;
                            if (isLoading && this.messagesContainer) {
                                // Get container's visible top (accounting for scroll)
                                const containerRect = this.messagesContainer.getBoundingClientRect();
                                // The drag-output is at the top of the visible container area
                                topPosition = containerRect.top - overlayRect.top - 8;
                            } else {
                                // Normal case: use drag-output's position directly
                                topPosition = dragOutputRect.top - overlayRect.top - 8;
                            }
                            
                            // Right: overlay width minus (drag-output right edge - overlay left edge), minus 4px to move it more into the corner
                            const dragOutputRightFromOverlayLeft = dragOutputRect.right - overlayRect.left;
                            const rightPosition = overlayRect.width - dragOutputRightFromOverlayLeft - 4;
                            
                            // Apply the calculated positions
                            this.closeOutputFloating.style.top = `${topPosition}px`;
                            this.closeOutputFloating.style.right = `${rightPosition}px`;
                            this.closeOutputFloating.style.left = 'auto'; // Clear left to use right positioning
                            this.closeOutputFloating.style.display = 'block'; // Ensure it's visible
                            this.closeOutputFloating.style.position = 'absolute'; // Ensure absolute positioning
                            this.closeOutputFloating.classList.remove('hidden');
                        } catch (error) {
                            console.error('Error positioning close button:', error);
                        }
                    }, delay);
                });
            });
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
    }

    handleDragStart(e) {
        // Mark that we're dragging the output
        this.isDraggingOutput = true;
        
        // Ensure window is interactive initially for drag to start
        if (this.isElectron) {
            const { ipcRenderer } = require('electron');
            ipcRenderer.invoke('make-interactive');
        }
        
        const textToDrag = this.dragOutput.dataset.fullText || this.dragOutput.textContent || this.dragOutput.innerText;
        e.dataTransfer.setData('text/plain', textToDrag);
        e.dataTransfer.effectAllowed = 'copy';
        
        // Add visual feedback
        this.dragOutput.style.opacity = '0.7';
    }

    handleDragEnd(e) {
        // Clear drag flag
        this.isDraggingOutput = false;
        
        // Restore opacity
        this.dragOutput.style.opacity = '1';
        
        // Check if mouse is still over overlay after drag ends
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
            
           window.setOpenAIKey = (key) => {
               jarvis.apiKey = key;
               jarvis.showNotification('OpenAI API key updated');
           };
           

    try { jarvis.startJarvis(); } catch (e) {}
});
