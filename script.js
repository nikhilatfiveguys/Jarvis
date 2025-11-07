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
        
        // Message tracking for free users
        this.messageCount = this.loadMessageCount();
        this.maxFreeMessages = 10;
        
        // Check for free access
        this.checkFreeAccess();
        
        this.initializeElements();
        this.setupEventListeners();
        this.setupHotkeys();
        this.setupElectronIntegration();
        this.setupDragFunctionality();
        this.setupVoiceRecording(); // Voice recording handlers disabled inside, but subscription listeners still active
        this.checkLicense();
        this.updateMessageCounter();
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
                } else {
                    this.licenseStatus = { valid: false, type: 'free' };
                    this.features = {};
                }
                
                // Update message counter display
                this.updateMessageCounter();
            }
        } catch (error) {
            console.error('Failed to check license:', error);
            this.licenseStatus = { valid: false, type: 'error' };
            this.features = {};
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
        this.showNotification('Your subscription has been cancelled. You now have 10 free messages available.', 'error');
        
        // Update any UI elements that show subscription status
        this.updateAccountInfo();
    }

    handleSubscriptionActivated(data) {
        
        // Update license status to premium
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
        
        // Show success notification
        this.showNotification(data.message || 'Your Jarvis Premium subscription is now active!', 'success');
        
        // Reset message count for premium users
        this.resetMessageCount();
        
        // Update account info to reflect new subscription status
        this.updateAccountInfo();
    }

    showPaywall() {
        
        // Show the paywall overlay
        this.showUpgradePrompt();
        
        // Show notification
        this.showNotification('Please subscribe to continue using Jarvis Premium features.', 'info');
    }


    showUpgradePrompt() {
        // Show upgrade prompt in the chat
        const upgradeMessage = `
🚀 **Upgrade to Jarvis Pro**
Unlock advanced features like screenshot analysis, voice commands, and more!

**Pro Features:**
• Advanced screenshot analysis
• Voice activation & commands  
• App control & automation
• Cloud sync & backup
• Unlimited conversations

**Start your 7-day free trial today!**
        `;
        
        this.addMessage('assistant', upgradeMessage);
        
        // Add upgrade button
        const upgradeButton = document.createElement('button');
        upgradeButton.textContent = 'Upgrade to Pro';
        upgradeButton.className = 'upgrade-button';
        upgradeButton.style.cssText = `
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            cursor: pointer;
            margin-top: 10px;
            font-weight: 600;
        `;
        
        upgradeButton.onclick = () => {
            // Open paywall window
            if (this.isElectron && window.require) {
                const { ipcRenderer } = window.require('electron');
                ipcRenderer.send('open-paywall');
            }
        };
        
        // Find the last message and add the button
        const messages = document.querySelectorAll('.message.assistant');
        if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            lastMessage.appendChild(upgradeButton);
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
        
        
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.isDraggingOutput = false; // Track if output element is being dragged
        this.pendingAttachments = [];
        
        this.currentModel = 'gpt-5-mini';
        this.apiKey = process.env.OPENAI_API_KEY || '';
        this.perplexityApiKey = process.env.PPLX_API_KEY || '';
        this.claudeApiKey = process.env.CLAUDE_API_KEY || '';
        
        // Define available tools for Responses API (flat structure)
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
        
        // Update tools based on available API keys
        this.updateAvailableTools();
        
        // Listen for API keys from main process
        if (this.isElectron && window.require) {
            const { ipcRenderer } = window.require('electron');
            ipcRenderer.on('api-keys', (event, keys) => {
                console.log('Received API keys from main process:', {
                    openai: keys.openai ? `${keys.openai.substring(0, 20)}...` : 'missing',
                    perplexity: keys.perplexity ? `${keys.perplexity.substring(0, 20)}...` : 'missing',
                    claude: keys.claude ? `${keys.claude.substring(0, 20)}...` : 'missing'
                });
                if (keys.openai) {
                    this.apiKey = keys.openai;
                    console.log('OpenAI API key set, length:', this.apiKey.length);
                } else {
                    console.warn('OpenAI API key not received from main process');
                }
                if (keys.perplexity) this.perplexityApiKey = keys.perplexity;
                if (keys.claude) this.claudeApiKey = keys.claude;
                
                // Update tools based on available API keys
                this.updateAvailableTools();
            });
        }
    }
    
    updateAvailableTools() {
        // Reset tools to base set
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
        
        // Add web search tool if API key is available
        if (this.perplexityApiKey) {
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
        }
        
        // Add Claude tool if API key is available
        if (this.claudeApiKey) {
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
        }
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
            this.settingsCloseBtn.addEventListener('click', () => this.hideSettingsMenu());
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
        if (this.dragOutput) {
            this.dragOutput.addEventListener('dragstart', (e) => this.handleDragStart(e));
            this.dragOutput.addEventListener('dragend', (e) => this.handleDragEnd(e));
            // Track drag to keep window interactive during drag (especially important on Windows)
            this.dragOutput.addEventListener('drag', (e) => {
                if (this.isDraggingOutput && this.isElectron) {
                    const { ipcRenderer } = require('electron');
                    // On Windows, keep window fully interactive during drag to allow dropping to other windows
                    // On other platforms, we can enable drag-through when outside overlay
                    if (process.platform === 'win32') {
                        // Windows: Always keep interactive during drag to allow cross-window drag
                        ipcRenderer.invoke('make-interactive');
                    } else {
                        // macOS/Linux: Enable drag-through when outside overlay
                        const overlayRect = this.overlay.getBoundingClientRect();
                        const mouseX = e.clientX;
                        const mouseY = e.clientY;
                        
                        if (mouseX < overlayRect.left || mouseX > overlayRect.right || 
                            mouseY < overlayRect.top || mouseY > overlayRect.bottom) {
                            ipcRenderer.invoke('enable-drag-through');
                        } else {
                            ipcRenderer.invoke('make-interactive');
                        }
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
            this.isDragging = true;
            this.dragOffset.x = e.clientX - this.overlay.offsetLeft;
            this.dragOffset.y = e.clientY - this.overlay.offsetTop;
            this.overlay.style.cursor = 'grabbing';
                e.preventDefault();
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!this.isDragging) return;
            
            const newX = e.clientX - this.dragOffset.x;
            const newY = e.clientY - this.dragOffset.y;
            
            const maxX = window.innerWidth - this.overlay.offsetWidth;
            const maxY = window.innerHeight - this.overlay.offsetHeight;
            
            this.overlay.style.left = `${Math.max(0, Math.min(newX, maxX))}px`;
            this.overlay.style.top = `${Math.max(0, Math.min(newY, maxY))}px`;
            this.overlay.style.transform = 'none';
        });
        
        document.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.overlay.style.cursor = 'default';
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

    showOverlay() {
        if (!this.overlay) return;
        
        this.overlay.classList.remove('hidden');
        this.instructions.classList.add('hidden');
        this.recenterOverlay();
        this.isActive = true;
        this.textInput.focus();
        
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
            // Wait for API key if not yet received (max 5 seconds)
            if (!this.apiKey || this.apiKey.trim() === '') {
                console.log('API key not yet received, waiting...');
                let waited = 0;
                while ((!this.apiKey || this.apiKey.trim() === '') && waited < 5000) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    waited += 100;
                }
                
                if (!this.apiKey || this.apiKey.trim() === '') {
                    throw new Error('API key not received from main process. Please restart the app.');
                }
                console.log('API key received after waiting', waited, 'ms');
            }
            
            // Check message limit for free users
            if (!this.hasPremiumAccess() && this.hasReachedMessageLimit()) {
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
            const errorMessage = error.message || 'Unknown error';
            console.error('Full error details:', error);
            this.showNotification(`Error: ${errorMessage}. Please check the console for details.`);
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
            console.log('API Key present:', !!this.apiKey, 'Length:', this.apiKey ? this.apiKey.length : 0);

            // Check if API key is available
            if (!this.apiKey || this.apiKey.trim() === '') {
                throw new Error('OpenAI API key is not set. Please check your configuration.');
            }

            this.showLoadingNotification();
            
            let response = await fetch('https://api.openai.com/v1/responses', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestPayload)
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('API Error Response:', response.status, errorText);
                throw new Error(`API error: ${response.status} - ${errorText.substring(0, 200)}`);
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
        // Check if Perplexity API key is available
        if (!this.perplexityApiKey) {
            return `Web search is not available. To enable web search, set the PPLX_API_KEY environment variable with your Perplexity API key.`;
        }

        try {
            // Start loading notification with search context (don't stop it here - let it continue until final answer)
            this.showLoadingNotification(null, 'search');
            
            const perplexityResponse = await fetch('https://api.perplexity.ai/chat/completions', {
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
        // Check if Claude API key is available
        if (!this.claudeApiKey) {
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
        
        // Check if this is a long response and chunk it
        if (content.length > 800 && content.toLowerCase().includes('elaborate')) {
            this.showChunkedResponse(content, isHTML);
            return;
        }
        
        // Process content for links and math formatting
        const processedContent = this.processContent(content, isHTML);
        
        this.dragOutput.innerHTML = processedContent;
        this.dragOutput.dataset.fullText = content.replace(/<[^>]*>/g, '');
        
        this.dragOutput.classList.remove('hidden');
        this.positionFloatingClose();
        
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
        
        // Stop any existing loading animation
        this.stopLoadingAnimation();
        
        // Context-specific loading messages that rotate
        const messageSets = {
            'default': ['analyzing', 'thinking', 'preparing', 'processing', 'answering', 'working'],
            'search': ['searching', 'querying', 'fetching', 'analyzing results', 'processing data', 'gathering information'],
            'claude': ['analyzing', 'reasoning', 'thinking deeply', 'processing', 'formulating', 'synthesizing'],
            'file': ['processing files', 'reading files', 'analyzing content', 'extracting data', 'preparing files', 'uploading'],
            'document': ['processing document', 'extracting content', 'analyzing text', 'reading document', 'preparing content', 'loading document']
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
            this.dragOutput.innerHTML = processedContent;
        };
        
        // Initial display
        updateDisplay();
        this.dragOutput.classList.add('loading-notification');
        this.dragOutput.classList.remove('hidden');
        this.positionFloatingClose();
        
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
            // Show loading notification for file processing
            this.showLoadingNotification(null, 'file');
            
            const newAttachments = [];
            for (const file of files) {
                const pf = await this.processFile(file);
                if (pf) newAttachments.push(pf);
            }
            
            // Stop loading animation
            this.stopLoadingAnimation();
            
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
            this.stopLoadingAnimation();
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
        // Use the animated loading notification instead of static indicator
        this.showLoadingNotification(null, 'document');
    }

    hideDocumentProcessingIndicator() {
        // Stop the loading animation
        this.stopLoadingAnimation();
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

    saveMessageCount() {
        try {
            localStorage.setItem('jarvis_message_count', this.messageCount.toString());
        } catch (e) {
            console.error('Failed to save message count:', e);
        }
    }

    incrementMessageCount() {
        this.messageCount++;
        this.saveMessageCount();
        this.updateMessageCounter();
    }

    resetMessageCount() {
        this.messageCount = 0;
        this.saveMessageCount();
        this.updateMessageCounter();
    }

    hasReachedMessageLimit() {
        return this.messageCount >= this.maxFreeMessages;
    }

    getRemainingMessages() {
        return Math.max(0, this.maxFreeMessages - this.messageCount);
    }

    updateMessageCounter() {
        if (!this.messageCounter || !this.messageCountText) return;
        
        // Only show counter for free users
        if (this.hasPremiumAccess()) {
            this.messageCounter.classList.add('hidden');
            return;
        }
        
        // Show counter for free users
        this.messageCounter.classList.remove('hidden');
        this.messageCountText.textContent = `${this.messageCount}/${this.maxFreeMessages}`;
        
        // Update styling based on remaining messages
        this.messageCounter.classList.remove('warning', 'critical');
        const remaining = this.getRemainingMessages();
        
        if (remaining <= 2) {
            this.messageCounter.classList.add('critical');
        } else if (remaining <= 5) {
            this.messageCounter.classList.add('warning');
        }
    }

    hasPremiumAccess() {
        // Check if user has premium subscription
        return this.licenseStatus && this.licenseStatus.valid && 
               (this.licenseStatus.type === 'premium' || this.licenseStatus.type === 'active');
    }

    showMessageLimitReached() {
        const remaining = this.getRemainingMessages();
        const message = `
            <div style="text-align: center; padding: 20px;">
                <h3 style="color: #ff6b6b; margin-bottom: 15px;">🚫 Message Limit Reached</h3>
                <p style="margin-bottom: 20px; color: #666;">
                    You've used all ${this.maxFreeMessages} free messages. 
                    Upgrade to Jarvis Premium for unlimited conversations!
                </p>
                <div style="margin-bottom: 20px;">
                    <button id="upgrade-to-premium" style="
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        border: none;
                        padding: 12px 24px;
                        border-radius: 8px;
                        font-size: 16px;
                        font-weight: 600;
                        cursor: pointer;
                        transition: transform 0.2s;
                    " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                        Get Premium - Unlimited Messages
                    </button>
                </div>
                <p style="font-size: 14px; color: #999;">
                    Premium includes: Unlimited messages, Screenshot analysis, Voice activation
                </p>
            </div>
        `;
        
        this.showNotification(message, true);
        
        // Add click handler for upgrade button
        setTimeout(() => {
            const upgradeBtn = document.getElementById('upgrade-to-premium');
            if (upgradeBtn) {
                upgradeBtn.addEventListener('click', () => {
                    this.showUpgradePrompt();
                });
            }
        }, 100);
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
            if (!this.hasPremiumAccess() && this.hasReachedMessageLimit()) {
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

    async humanize() {
        try {
            if (!this.dragOutput || this.dragOutput.classList.contains('hidden')) {
                this.showNotification('No text to humanize');
                return;
            }

            // Get the text content from the output
            const textToHumanize = this.dragOutput.dataset.fullText || this.dragOutput.innerText || this.dragOutput.textContent;
            
            if (!textToHumanize || textToHumanize.trim().length === 0) {
                this.showNotification('No text to humanize');
                return;
            }

            const previewText = textToHumanize.length > 40 ? textToHumanize.substring(0, 40) + '...' : textToHumanize;
            this.showNotification(`✍️ Humanizing text: "${previewText}"`);
            this.showNotification('🔄 Processing with Natural Write API...');

            // Call Natural Write API
            const response = await fetch('https://naturalwrite.com/api/v1/humanize', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': 'nw_6f9427e5026add995264a567970f5b0ce09f39be867f8921'
                },
                body: JSON.stringify({
                    text: textToHumanize
                })
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                const errorMessage = errorData.message || errorData.error || `API error: ${response.status}`;
                console.error('Natural Write API error:', errorData);
                throw new Error(errorMessage);
            }

            const result = await response.json();
            
            // Extract humanized text from response
            // The API might return different structures, so we handle both
            const humanizedText = result.humanized_text || result.text || result.result || JSON.stringify(result);
            
            if (!humanizedText || humanizedText.trim().length === 0) {
                throw new Error('No humanized text received from API');
            }

            // Update the output with humanized text
            this.showNotification(humanizedText, false);
            
        } catch (error) {
            console.error('Humanize error:', error);
            this.showNotification(`Error: ${error.message || "Couldn't humanize the text"}`);
        }
    }

    positionFloatingClose() {
        try {
            if (!this.closeOutputFloating || this.dragOutput.classList.contains('hidden')) return;
            const overlayRect = this.overlay.getBoundingClientRect();
            const outRect = this.dragOutput.getBoundingClientRect();
            const relLeft = (outRect.right - overlayRect.left) - 8; // top-right with 8px offset
            const relTop = (outRect.top - overlayRect.top) - 8; // top with 8px offset
            this.closeOutputFloating.style.left = `${relLeft}px`;
            this.closeOutputFloating.style.top = `${relTop}px`;
            this.closeOutputFloating.classList.remove('hidden');
        } catch (_) {}
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
        if (this.dragOutput) {
            this.dragOutput.classList.add('hidden');
        }
        if (this.closeOutputFloating) {
            this.closeOutputFloating.classList.add('hidden');
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
        
        // Ensure window is interactive for drag to start (critical on Windows for cross-window drag)
        if (this.isElectron) {
            const { ipcRenderer } = require('electron');
            // Make window fully interactive to allow drag to other windows
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
        // On Windows, use a longer delay to ensure drag operation completes fully
        const delay = (this.isElectron && typeof process !== 'undefined' && process.platform === 'win32') ? 200 : 50;
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
            
           window.setOpenAIKey = (key) => {
               jarvis.apiKey = key;
               jarvis.showNotification('OpenAI API key updated');
           };
           

    try { jarvis.startJarvis(); } catch (e) {}
});
