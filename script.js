class JarvisOverlay {
    constructor() {
        this.isActive = false;
        this.currentScreenCapture = null;
        this.isElectron = typeof require !== 'undefined';
        this.isPinkMode = false; // Track pink mode state
        this.currentDocument = null; // Store current document from Exa API
        this.isProcessingDocument = false; // Track document processing state
        
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
        this.setupVoiceRecording();
        this.checkLicense();
        this.updateMessageCounter();
    }

    async checkLicense() {
        try {
            if (this.isElectron && window.require) {
                const { ipcRenderer } = window.require('electron');
                // Check subscription status using the new system
                const subscriptionResult = await ipcRenderer.invoke('check-subscription-status');
                console.log('🔍 Frontend license check result:', subscriptionResult);
                
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
                    console.log('✅ Premium access detected, hiding message counter');
                } else {
                    this.licenseStatus = { valid: false, type: 'free' };
                    this.features = {};
                    console.log('❌ No premium access, showing message counter');
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
            // Request microphone access
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            // Stop the stream immediately as we just needed permission
            stream.getTracks().forEach(track => track.stop());
            console.log('Microphone permission granted');
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
        console.log('🔄 Subscription cancelled, updating UI...');
        
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
        console.log('✅ Subscription activated, updating UI...', data);
        
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
        console.log('🔄 Showing paywall due to subscription cancellation...');
        
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
        this.startBtn = document.getElementById('start-jarvis');
        this.resizeHandle = document.getElementById('resize-handle');
        this.settingsBtn = document.getElementById('settings-btn');
        this.settingsMenu = document.getElementById('settings-menu');
        this.clearChatBtn = document.getElementById('clear-chat-btn');
        this.settingsCloseBtn = document.getElementById('settings-close-btn');
        this.accountInfoBtn = document.getElementById('account-info-btn');
        this.accountModal = document.getElementById('account-modal');
        this.accountModalClose = document.getElementById('account-modal-close');
        this.accountModalOk = document.getElementById('account-modal-ok');
        this.userEmailElement = document.getElementById('user-email');
        this.premiumStatusElement = document.getElementById('premium-status');
        this.messageCounter = document.getElementById('message-counter');
        this.messageCountText = document.getElementById('message-count-text');
        
        
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        this.isDraggingOutput = false; // Track if output element is being dragged
        
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
                description: "Delegates complex questions to Claude AI for deeper analytical thinking, in-depth analysis, philosophical questions, complex reasoning, multi-step problem solving, or when you need a more thorough and nuanced response than you can provide directly. Use this when the user asks for 'more depth', 'deeper analysis', or questions requiring sophisticated reasoning.",
                parameters: {
                    type: "object",
                    properties: {
                        question: {
                            type: "string",
                            description: "The question or prompt to send to Claude for deeper analysis"
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
        
        // Settings button event listeners
        if (this.settingsBtn) {
            this.settingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleSettingsMenu();
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
        
        
        // Google sign-in removed - using simple payment system
        
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
        
        this.showNotification('Analyzing your screen...');
        
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

            this.showNotification('Taking screenshot...');
            await this.captureScreen();
            
            if (!this.currentScreenCapture) {
                this.showNotification('Failed to capture screenshot');
                return;
            }
            
            this.showNotification('Analyzing screenshot...');
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
            
            this.showNotification('🧠 Thinking...');
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
            const claudeHint = this.claudeApiKey ? ' Use askclaude for deeper analytical thinking or in-depth questions.' : '';
            const instructions = `You are Jarvis. An AI assistant powered by many different AI models. Respond concisely. Use getscreenshot for screen questions.${webSearchHint}${claudeHint}${conversationContext}${documentContext}`;

            let response = await fetch('https://api.openai.com/v1/responses', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.currentModel,
                    instructions: instructions,
                    input: [{ role: 'user', content: inputContent }],
                    tools: this.tools
                })
            });
            
            if (!response.ok) {
                throw new Error(`API error: ${response.status}`);
            }
            
            let data = await response.json();
            
            // Check for tool calls in the output array
            const toolCalls = [];
            if (data.output && Array.isArray(data.output)) {
                for (const item of data.output) {
                    if (item.type === 'function_call' && item.status === 'completed') {
                        toolCalls.push({
                            name: item.name,
                            arguments: item.arguments ? JSON.parse(item.arguments) : {},
                            call_id: item.call_id
                        });
                    }
                }
            }
            
            if (toolCalls.length > 0) {
                for (const toolCall of toolCalls) {
                    if (toolCall.name === 'getscreenshot') {
                        const result = await this.executeGetScreenshot();
                        if (result && typeof result === 'object' && result.type === 'screenshot') {
                            inputContent.push({ type: 'input_image', image_url: result.image_url });
                        }
                    } else if (toolCall.name === 'searchweb') {
                        const result = await this.executeSearchWeb(toolCall.arguments.query);
                        inputContent.push({ type: 'input_text', text: `Web search: ${result}` });
                    } else if (toolCall.name === 'askclaude') {
                        const result = await this.executeAskClaude(toolCall.arguments.question);
                        inputContent.push({ type: 'input_text', text: `Claude's analysis: ${result}` });
                    }
                }
                
                // Second call with tool results
                response = await fetch('https://api.openai.com/v1/responses', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: this.currentModel,
                        instructions: `You are Jarvis. Respond concisely.${conversationContext}`,
                        input: [{ role: 'user', content: inputContent }]
                    })
                });
                
                if (!response.ok) {
                    throw new Error(`API error: ${response.status}`);
                }
                
                data = await response.json();
            }
            
            const finalResponse = this.extractText(data);
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
            // Show searching notification
            this.showNotification('🔍 Searching with Perplexity...');
            
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
                return `Web search failed: ${errorData.error?.message || 'API error'}`;
            }
            
            const perplexityData = await perplexityResponse.json();
            return perplexityData.choices[0].message.content;
        } catch (error) {
            console.error('Web search error:', error);
            return `Web search error: ${error.message}`;
        }
    }

    async executeAskClaude(question) {
        // Check if Claude API key is available
        if (!this.claudeApiKey) {
            return `Claude is not available. To enable Claude, set the CLAUDE_API_KEY environment variable with your Anthropic API key.`;
        }

        try {
            // Show thinking notification
            this.showNotification('🧠 Consulting Claude for deeper analysis...');
            
            // Build messages array for Claude API
            const messages = [];
            
            // Add recent conversation history
            if (this.conversationHistory.length > 0) {
                const recentHistory = this.conversationHistory.slice(-5);
                recentHistory.forEach(msg => {
                    if (msg.content && msg.content.trim()) {
                        messages.push({
                            role: msg.role === 'user' ? 'user' : 'assistant',
                            content: msg.content.substring(0, 1000) // Limit each message
                        });
                    }
                });
            }
            
            // Build the current question with document context if available
            let currentQuestion = question;
            if (this.currentDocument) {
                currentQuestion = `Context from current document:
Title: ${this.currentDocument.title}
URL: ${this.currentDocument.url}
Content: ${this.currentDocument.content.substring(0, 2000)}...

Question: ${question}`;
            }
            
            messages.push({
                role: 'user',
                content: currentQuestion
            });
            
            const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'x-api-key': this.claudeApiKey,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'claude-3-5-sonnet-20241022',
                    max_tokens: 4096,
                    messages: messages
                })
            });
            
            if (!claudeResponse.ok) {
                const errorData = await claudeResponse.json().catch(() => ({}));
                console.error('Claude API Error:', errorData);
                return `Claude analysis failed: ${errorData.error?.message || 'API error'}`;
            }
            
            const claudeData = await claudeResponse.json();
            
            // Extract text from Claude's response
            // Claude returns content as an array of text blocks
            if (claudeData.content && Array.isArray(claudeData.content)) {
                return claudeData.content
                    .filter(block => block.type === 'text')
                    .map(block => block.text)
                    .join('\n\n');
            } else if (claudeData.content && typeof claudeData.content === 'string') {
                return claudeData.content;
            } else {
                return 'No response from Claude';
            }
        } catch (error) {
            console.error('Claude API error:', error);
            return `Claude error: ${error.message}`;
        }
    }


    async sendMessage() {
        const message = this.textInput.value.trim();
        if (!message) return;

        this.textInput.value = '';
        this.sendBtn.disabled = true;

        await this.processMessage(message);
    }

    showNotification(text, isHTML = false) {
        if (!this.dragOutput) return;
        
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
        
        document.querySelectorAll('.notification').forEach(n => n.remove());
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
        // Update email
        if (this.userEmailElement) {
            const email = info.email || 'Not signed in';
            this.userEmailElement.textContent = email;
            
            // Google sign-in removed - using simple payment system
        }
        
        // Update message counter
        this.updateMessageCounter();
        
        // Update premium status
        if (this.premiumStatusElement && this.statusIndicator && this.statusText) {
            this.statusText.textContent = info.premiumStatus || 'Free';
            
            // Update status indicator color
            this.statusIndicator.className = 'status-indicator';
            if (info.premiumStatus === 'Free Access (aaron2)') {
                this.statusIndicator.classList.add('status-free-access');
            } else if (info.premiumStatus === 'Premium') {
                this.statusIndicator.classList.add('status-premium');
            } else {
                this.statusIndicator.classList.add('status-free');
            }
        }
    }

    // Google sign-in methods removed - using simple payment system


    updateAccountInfo() {
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
            const instructions = `You are Jarvis. Answer the user's question based on the provided document context. Be specific and cite relevant parts of the document when possible.

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

            this.showNotification('Taking screenshot...');
            
            // Take screenshot directly
            await this.captureScreen();
            
            if (!this.currentScreenCapture) {
                this.showNotification('Failed to capture screenshot');
                return;
            }

            // Build conversation context with full history for better continuity
            let conversationContext = '';
            if (this.conversationHistory.length > 0) {
                conversationContext = '\n\nPREVIOUS CONVERSATION (remember this context):\n' + 
                    this.conversationHistory.slice(-10).map((msg, idx) => 
                        `${idx + 1}. ${msg.role === 'user' ? 'User' : 'Jarvis'}: ${msg.content.substring(0, 300)}`
                    ).join('\n');
            }
            
            // Call Responses API with screenshot and "answer this" message
            this.showNotification('Analyzing...');
            
            const response = await fetch('https://api.openai.com/v1/responses', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.currentModel,
                    instructions: `You are Jarvis, a GPT-5 Mini powered assistant. Respond in ONE sentence only unless asked to elaborate. Be direct and concise.${conversationContext}`,
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
