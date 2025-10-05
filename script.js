class JarvisOverlay {
    constructor() {
        this.isActive = false;
        this.currentScreenCapture = null;
        this.isElectron = typeof require !== 'undefined';
        this.conversationHistory = [];
        
        this.initializeElements();
        this.setupEventListeners();
        this.setupHotkeys();
        this.setupElectronIntegration();
        this.setupDragFunctionality();
    }

    initializeElements() {
        this.overlay = document.getElementById('jarvis-overlay');
        this.instructions = document.getElementById('instructions');
        this.activationIndicator = document.getElementById('activation-indicator');
        this.textInput = document.getElementById('text-input');
        this.sendBtn = document.getElementById('send-btn');
        this.attachBtn = document.getElementById('attach-btn');
        this.attachmentsPreview = document.getElementById('attachments-preview');
        this.attachMenu = document.getElementById('attach-menu');
               this.dragOutput = document.getElementById('drag-output');
        this.dragHandle = document.getElementById('drag-handle');
        this.closeOutputBtn = document.getElementById('close-output');
        this.closeOutputFloating = document.getElementById('close-output-floating');
        this.humanizeBtn = document.getElementById('humanize-btn');
        this.answerThisBtn = document.getElementById('answer-this-btn');
        
        this.startBtn = document.getElementById('start-jarvis');
        
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        
        this.currentModel = 'gpt-4o';
        // API keys should be set via environment variables
        // For development: export OPENAI_API_KEY="your-key-here"
        // For production: Store securely or prompt user for key
        this.apiKey = process.env.OPENAI_API_KEY || '';
        this.assistantId = process.env.OPENAI_ASSISTANT_ID || '';
    }

    setupEventListeners() {
        if (this.startBtn) this.startBtn.addEventListener('click', () => this.startJarvis());
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.textInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
        
        if (this.humanizeBtn) {
            this.humanizeBtn.addEventListener('click', () => this.humanizeLastResponse());
        }
        
        if (this.answerThisBtn) {
            this.answerThisBtn.addEventListener('click', () => this.answerThis());
        }
        
        // Make overlay interactive when hovering over input area
        if (this.overlay) {
            this.overlay.addEventListener('mouseenter', () => {
                if (this.isElectron) {
                    const { ipcRenderer } = require('electron');
                    ipcRenderer.invoke('make-interactive');
                }
            });
            
            this.overlay.addEventListener('mouseleave', () => {
            if (this.isElectron) {
                const { ipcRenderer } = require('electron');
                    ipcRenderer.invoke('make-click-through');
                }
            });
        }
        
        this.attachments = [];
        if (this.attachBtn) {
            this.attachBtn.addEventListener('click', (e) => this.toggleAttachMenu(e));
        }
        if (this.attachMenu) {
            this.attachMenu.addEventListener('click', (e) => this.handleAttachAction(e));
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

    async captureAndAnalyze() {
        try {
            this.showNotification('Taking screenshot...');
            await this.captureScreen();
            this.analyzeContent();
        } catch (error) {
            this.showNotification('Screenshot failed. Please try again.');
            console.error('Capture failed:', error);
        }
    }

    async captureAndAnalyzeWithMessage(userMessage) {
        try {
            this.showNotification('Taking screenshot...');
            await this.captureScreen();
            this.analyzeContent(userMessage);
        } catch (error) {
            this.showNotification('Screenshot failed. Please try again.');
            console.error('Capture failed:', error);
        }
    }

    async captureScreen() {
        if (this.isElectron) {
            const { ipcRenderer } = require('electron');
            console.log('Taking screenshot via Electron...');
            this.currentScreenCapture = await ipcRenderer.invoke('take-screenshot');
            console.log('Screenshot result:', this.currentScreenCapture ? 'Success' : 'Failed');
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
            const apiKey = this.apiKey;
            const prompt = userQuestion || "What am I looking at? Please analyze the screen content and describe what you see.";
            
            const messages = [
                {
                    role: 'system',
                    content: 'Answer ONLY with the direct answer. No preface, no restating the question, no phrases like "the answer is" or "sure". Be as short as possible while correct. If describing the image, only describe what is necessary to answer. For tables, use proper HTML table format: <table><tr><th>Header1</th><th>Header2</th></tr><tr><td>Data1</td><td>Data2</td></tr></table>'
                },
                ...this.conversationHistory,
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: prompt
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: imageUrl,
                                detail: 'high'
                            }
                        }
                    ]
                }
            ];

            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-4o',
                    messages: messages,
                    max_tokens: 600,
                    temperature: 0.2
                })
            });

            if (!response.ok) {
                throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const analysis = data.choices[0].message.content;
            
                this.conversationHistory.push({
                    role: 'user',
                    content: prompt
                });
                this.conversationHistory.push({
                    role: 'assistant',
                content: analysis
            });
            
            if (this.conversationHistory.length > 20) {
                this.conversationHistory = this.conversationHistory.slice(-20);
            }
            
            return analysis;
        } catch (error) {
            console.error('OpenAI API error:', error);
            throw error;
        }
    }

    async processMessage(message) {
        try {
            if (this.tryOpenApplication(message)) {
                return;
            }
            
            if (this.tryAppAction(message)) {
            return;
        }
        
            if (this.needsCurrentInformation(message)) {
                this.showNotification('Getting current information...');
                const currentInfo = await this.getCurrentInformation(message);
                if (currentInfo) {
                    this.showNotification(currentInfo, true);
            return;
                }
            }
            
            // Show thinking notification for general chat
            this.showNotification('Thinking...');
            const response = await this.callChatGPT(message);
            this.showNotification(response, true);
            
        } catch (error) {
            console.error('Message processing error:', error);
            this.showNotification("Sorry, I'm having trouble processing that request right now.");
        }
    }

    async callChatGPT(message) {
        try {
            const needsCurrentInfo = this.needsCurrentInformation(message);
            
            let currentInfo = '';
            if (needsCurrentInfo) {
                currentInfo = await this.getCurrentInformation(message);
            }
            
            const messages = [
                {
                    role: 'system',
                    content: 'Answer ONLY with the direct answer. No preface, no restating the question, no phrases like "the answer is" or "sure". Be as short as possible while correct. If a URL is requested, output ONLY the URL. If a list is necessary, use the fewest bullet points with minimal words. For tables, use proper HTML table format: <table><tr><th>Header1</th><th>Header2</th></tr><tr><td>Data1</td><td>Data2</td></tr></table>'
                },
                ...this.conversationHistory,
                {
                    role: 'user',
                    content: currentInfo ? `${message}\n\nCurrent context: ${currentInfo}` : message
                }
            ];
            
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: this.currentModel,
                    messages: messages,
                    max_tokens: 600,
                    temperature: 0.2
                })
            });
            
            if (!response.ok) {
                throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            const assistantMessage = data.choices[0].message.content;
            
            this.conversationHistory.push({
                role: 'user',
                content: message
            });
            this.conversationHistory.push({
                role: 'assistant',
                content: assistantMessage
            });
            
            if (this.conversationHistory.length > 20) {
                this.conversationHistory = this.conversationHistory.slice(-20);
            }
            
            return assistantMessage;
        } catch (error) {
            console.error('ChatGPT API error:', error);
            throw error;
        }
    }

    needsCurrentInformation(message) {
        const lowerMessage = message.toLowerCase();
        
        const currentInfoKeywords = [
            'what am i looking at', 'what is this', 'what\'s on my screen',
            'analyze this', 'what do you see', 'describe this',
            'what\'s happening', 'current', 'now', 'here',
            'screenshot', 'screen', 'capture', 'on my screen',
            "what's the answer", 'whats the answer', 'what\'s the answer to this', 'whats the answer to this',
            'answer to this', 'answer this'
        ];
        
        const hasCurrentInfoKeyword = currentInfoKeywords.some(keyword => 
            lowerMessage.includes(keyword)
        );
        
        const screenAnalysisPatterns = [
            /what is this/i, /what am i looking at/i, /what's the answer( to this)?/i,
            /whats the answer( to this)?/i, /answer this/i, /answer to this/i,
            /help me with this/i, /what does this say/i,
            /read this/i, /explain this/i, /solve this/i, /what does this mean/i,
            /can you see/i, /look at this/i, /analyze this/i, /tell me about this/i,
            /on my screen/i
        ];
        
        const needsScreenAnalysis = screenAnalysisPatterns.some(pattern => 
            pattern.test(message)
        );
        
        return hasCurrentInfoKeyword || needsScreenAnalysis;
    }

    async getCurrentInformation(message) {
        try {
            const screenAnalysisPatterns = [
                /what is this/i, /what am i looking at/i, /what's the answer( to this)?/i,
                /whats the answer( to this)?/i, /answer this/i, /answer to this/i,
                /help me with this/i, /what does this say/i,
                /read this/i, /explain this/i, /solve this/i, /what does this mean/i,
                /can you see/i, /look at this/i, /analyze this/i, /tell me about this/i,
                /on my screen/i
            ];
            
            const needsScreenAnalysis = screenAnalysisPatterns.some(pattern => 
                pattern.test(message)
            );
            
            if (needsScreenAnalysis) {
                this.showNotification('Taking screenshot...');
                await this.captureScreen();
                
                console.log('Screen capture result:', this.currentScreenCapture ? 'Success' : 'Failed');
                if (this.currentScreenCapture) {
                    const analysis = await this.analyzeWithOpenAI(this.currentScreenCapture, message);
                    return analysis; // Return just the analysis, not prefixed
                } else {
                    return 'Unable to capture screen for analysis';
                }
            } else {
                return `You can ask me to analyze your screen by saying "what is this" or "analyze this".`;
            }
        } catch (error) {
            console.error('Error getting current information:', error);
            return 'Unable to fetch current information at this time.';
        }
    }

    tryOpenApplication(message) {
        try {
            if (!this.isElectron) return false;
            const { ipcRenderer } = require('electron');
            const lower = message.toLowerCase().trim();

            let mTab = lower.match(/^\s*(open|launch|start)\s+new\s+tab(?:\s+in\s+(safari|chrome|google chrome))?$/i);
            if (mTab) {
                const appName = (mTab[2] && mTab[2].toLowerCase().includes('chrome')) ? 'Google Chrome' : 'Safari';
                this.showNotification(`New tab in ${appName}...`);
                ipcRenderer.invoke('app-action', { appName, action: 'new_tab' })
                    .then(() => this.showNotification(`New tab opened in ${appName}`))
                    .catch(err => { this.showNotification(`Failed to open new tab in ${appName}: ${err.message || err}`); console.error(err); });
                return true;
            }

            const match = lower.match(/^(open|launch|start)\s+([\w .+-]+)$/i);
            if (!match) return false;
            const appNameRaw = match[2].trim();
            if (!appNameRaw) return false;
            
            const nameMap = {
                'notes': 'Notes',
                'safari': 'Safari',
                'chrome': 'Google Chrome',
                'google chrome': 'Google Chrome',
                'xcode': 'Xcode',
                'spotify': 'Spotify',
                'messages': 'Messages',
                'mail': 'Mail',
                'calendar': 'Calendar',
                'photos': 'Photos',
                'vscode': 'Visual Studio Code',
                'visual studio code': 'Visual Studio Code'
            };
            const key = appNameRaw.toLowerCase();
            if (!nameMap[key]) return false;
            const appName = nameMap[key];
            this.showNotification(`Opening ${appName}...`);
            ipcRenderer.invoke('open-application', appName)
                .then(() => {
                    this.showNotification(`${appName} opened`);
                })
                .catch((err) => {
                    this.showNotification(`Could not open ${appName}. You can say: "open Safari"`);
                    console.error('open-application failed:', err);
                });
            return true;
        } catch (_) {
            return false;
        }
    }

    tryAppAction(message) {
        try {
            if (!this.isElectron) return false;
            const { ipcRenderer } = require('electron');
            const lower = message.toLowerCase().trim();

            let m = lower.match(/^(new tab|open new tab) in (safari|chrome|google chrome)$/i);
            if (m) {
                const appName = m[2].toLowerCase().includes('chrome') ? 'Google Chrome' : 'Safari';
                this.showNotification(`New tab in ${appName}...`);
                ipcRenderer.invoke('app-action', { appName, action: 'new_tab' })
                    .then(() => this.showNotification(`New tab opened in ${appName}`))
                    .catch(err => { this.showNotification(`Failed to open new tab in ${appName}: ${err.message || err}`); console.error(err); });
                return true;
            }

            m = lower.match(/^(new tab|open new tab)$/i);
            if (m) {
                const appName = 'Safari';
                this.showNotification(`New tab in ${appName}...`);
                ipcRenderer.invoke('app-action', { appName, action: 'new_tab' })
                    .then(() => this.showNotification(`New tab opened in ${appName}`))
                    .catch(err => { this.showNotification(`Failed to open new tab in ${appName}: ${err.message || err}`); console.error(err); });
                return true;
            }

            m = lower.match(/^(search|google) (.+) in (safari|chrome|google chrome)$/i);
            if (m) {
                const query = m[2].trim();
                const appName = m[3].toLowerCase().includes('chrome') ? 'Google Chrome' : 'Safari';
                this.showNotification(`Searching "${query}" in ${appName}...`);
                ipcRenderer.invoke('app-action', { appName, action: 'search', query })
                    .then(() => this.showNotification(`Search opened in ${appName}`))
                    .catch(err => { this.showNotification(`Failed to search in ${appName}: ${err.message || err}`); console.error(err); });
                return true;
            }

            m = lower.match(/^(search|google)\s+(.+)$/i);
            if (m) {
                const query = m[2].trim();
                const appName = 'Safari';
                this.showNotification(`Searching "${query}" in ${appName}...`);
                ipcRenderer.invoke('app-action', { appName, action: 'search', query })
                    .then(() => this.showNotification(`Search opened in ${appName}`))
                    .catch(err => { this.showNotification(`Failed to search in ${appName}: ${err.message || err}`); console.error(err); });
                return true;
            }

            // new google doc in background (Safari or Chrome)
            m = lower.match(/^(?:new|create|start) (?:a )?(?:google )?doc(?:ument)?(?: in (chrome|google chrome|safari))?(?: in background)?$/i);
            if (m) {
                const appName = (m[1] && m[1].toLowerCase().includes('chrome')) ? 'Google Chrome' : 'Safari';
                this.showNotification('Starting new Google Doc in background...');
                ipcRenderer.invoke('app-action', { appName, action: 'new_google_doc' })
                    .then(() => this.showNotification('New Google Doc created'))
                    .catch(err => { this.showNotification(`Failed to create Google Doc: ${err.message || err}`); console.error(err); });
                return true;
            }

            // summarize website
            m = lower.match(/^(?:summarize|summarise) (?:this )?(?:website|page|site)(?:\s*:?\s*(.+))?$/i);
            if (m) {
                const url = m[1] ? m[1].trim() : null;
                const fullMessage = message; // Send the entire original message for context
                this.showNotification('Summarizing website...');
                ipcRenderer.invoke('summarize-website', url, fullMessage)
                    .then((summary) => this.showNotification(summary, true))
                    .catch(err => { this.showNotification(`Failed to summarize website: ${err.message || err}`); console.error(err); });
                return true;
            }


            m = lower.match(/^(?:new note|start a new note|create a note)(?:\s+with\s+(.*))?$/i);
            if (m) {
                const body = (m[2] || '').trim();
                const appName = 'Notes';
                this.showNotification('Creating note...');
                ipcRenderer.invoke('app-action', { appName, action: 'new_note', query: body })
                    .then(() => this.showNotification('Created a new note'))
                    .catch(err => { this.showNotification(`Failed to create note: ${err.message || err}`); console.error(err); });
                return true;
            }

            m = lower.match(/^create(?:\s+(?:a|new))?(?:\s+note)?(?:\s+with\s+(.*))?$/i);
            if (m) {
                const body = (m[1] || '').trim();
                const appName = 'Notes';
                this.showNotification('Creating note...');
                ipcRenderer.invoke('app-action', { appName, action: 'new_note', query: body })
                    .then(() => this.showNotification('Created a new note'))
                    .catch(err => { this.showNotification(`Failed to create note: ${err.message || err}`); console.error(err); });
                return true;
            }

            return false;
        } catch (_) {
            return false;
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
        if (!this.dragOutput) {
            console.error('dragOutput element not found!');
            return;
        }
        const content = String(text || '');
        
        // Store last response for humanize feature
        this.lastResponse = content;
        
        if (isHTML) {
            this.dragOutput.innerHTML = content;
            this.dragOutput.dataset.fullText = content.replace(/<[^>]*>/g, '');
            } else {
        this.dragOutput.textContent = content;
        this.dragOutput.dataset.fullText = content;
        }
        
        this.dragOutput.classList.remove('hidden');
        this.positionFloatingClose();
        
        // Show humanize button
        if (this.humanizeBtn) {
            this.humanizeBtn.classList.remove('hidden');
        }
        
        // Move answer this button next to humanize (remove default positioning)
        if (this.answerThisBtn) {
            this.answerThisBtn.classList.remove('hidden');
            this.answerThisBtn.classList.remove('answer-this-default');
        }
        
        document.querySelectorAll('.notification').forEach(n => n.remove());
    }

    async humanizeLastResponse() {
        if (!this.lastResponse) {
            this.showNotification('No response to humanize');
            return;
        }

        this.showNotification('Humanizing...');
        
        const humanizePrompt = `increase burstiness and perplexity of the last thing you sent me and make it sound like a 40 year old with a 9th grade education. add this character after every other word: ‎  

Last response: ${this.lastResponse}`;

        try {
            const response = await this.callChatGPT(humanizePrompt);
            this.showNotification(response, true);
        } catch (error) {
            console.error('Humanize error:', error);
            this.showNotification("Sorry, I couldn't humanize that response.");
        }
    }

    async answerThis() {
        this.showNotification('Taking screenshot and analyzing...');
        
        try {
            // Take a screenshot
            await this.captureScreen();
            
            console.log('Screenshot capture complete, screenshot exists:', !!this.currentScreenCapture);
            
            if (!this.currentScreenCapture) {
                console.error('No screenshot captured');
                this.showNotification('Failed to capture screen');
                return;
            }

            // Send "answer this" with the screenshot to OpenAI
            console.log('Calling analyzeWithOpenAI with "answer this"');
            const response = await this.analyzeWithOpenAI(this.currentScreenCapture, "answer this");
            
            console.log('Got response:', response ? 'Success' : 'Empty');
            
            // Display the response
            this.showNotification(response, true);
            this.lastResponse = response;
        } catch (error) {
            console.error('Answer this error:', error);
            console.error('Error stack:', error.stack);
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
        if (this.humanizeBtn) {
            this.humanizeBtn.classList.add('hidden');
        }
        // Move answer this button back under HUD (add default positioning)
        if (this.answerThisBtn) {
            this.answerThisBtn.classList.add('answer-this-default');
        }
    }

    toggleAttachMenu(e) {
            e.stopPropagation();
        if (this.attachMenu) {
            this.attachMenu.classList.toggle('hidden');
        }
    }

    handleAttachAction(e) {
        const action = e.target.dataset.action;
        if (!action) return;
        
        this.attachMenu.classList.add('hidden');
        
        switch (action) {
            case 'upload-file':
                this.uploadFile();
                break;
            case 'upload-photo':
                this.uploadPhoto();
                break;
            case 'take-screenshot':
                this.captureAndAnalyze();
                break;
            case 'take-photo':
                this.attachCameraPhoto();
                break;
        }
    }

    uploadFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.onchange = (e) => {
            Array.from(e.target.files).forEach(file => {
                this.readFileAsDataURL(file).then(dataUrl => {
                    this.attachments.push({ name: file.name, type: file.type, dataUrl });
                    this.renderAttachments();
                });
            });
        };
        input.click();
    }

    uploadPhoto() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = (e) => {
            Array.from(e.target.files).forEach(file => {
                this.readFileAsDataURL(file).then(dataUrl => {
                    this.attachments.push({ name: file.name, type: file.type, dataUrl });
                    this.renderAttachments();
                });
            });
        };
        input.click();
    }

    async attachCameraPhoto() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true });
            const video = document.createElement('video');
            video.srcObject = stream;
            video.play();
            
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            video.addEventListener('loadedmetadata', () => {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                ctx.drawImage(video, 0, 0);
                const dataUrl = canvas.toDataURL('image/png');
                stream.getTracks().forEach(track => track.stop());

                this.attachments.push({ name: 'photo.png', type: 'image/png', dataUrl });
                this.renderAttachments();
            });
        } catch (e) { 
            console.error('camera failed', e); 
        }
    }

    readFileAsDataURL(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    renderAttachments() {
        if (!this.attachmentsPreview) return;
        if (!this.attachments.length) {
            this.attachmentsPreview.classList.add('hidden');
            this.attachmentsPreview.innerHTML = '';
            return;
        }
        this.attachmentsPreview.classList.remove('hidden');
        this.attachmentsPreview.innerHTML = '';
        const overlayRect = this.overlay.getBoundingClientRect();
        const hudRect = this.overlay.querySelector('.minimal-hud').getBoundingClientRect();
        const top = (hudRect.top - overlayRect.top) - 180;
        const left = hudRect.left - overlayRect.left;
        this.attachmentsPreview.style.top = `${Math.max(top, 0)}px`;
        this.attachmentsPreview.style.left = `${Math.max(left, 0)}px`;
        for (let i = 0; i < this.attachments.length; i++) {
            const a = this.attachments[i];
            const chip = document.createElement('div');
            chip.className = 'attachment-chip';
            if (a.type.startsWith('image/')) {
                const img = document.createElement('img');
                img.src = a.dataUrl;
                chip.appendChild(img);
            }
            const span = document.createElement('span');
            span.textContent = a.name || 'image';
            chip.appendChild(span);
            const removeBtn = document.createElement('button');
            removeBtn.textContent = '×';
            removeBtn.onclick = () => {
                this.attachments.splice(i, 1);
                this.renderAttachments();
            };
            chip.appendChild(removeBtn);
            this.attachmentsPreview.appendChild(chip);
        }
    }

    handleDragStart(e) {
        e.dataTransfer.setData('text/plain', this.dragOutput.dataset.fullText || this.dragOutput.textContent);
        e.dataTransfer.effectAllowed = 'copy';
    }

    handleDragEnd(e) {
        // Optional: Add visual feedback
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
           
           console.log('🔑 To set your OpenAI API key, run: setOpenAIKey("your-api-key-here")');
           console.log('📝 Get a new API key from: https://platform.openai.com/api-keys');

    try { jarvis.startJarvis(); } catch (e) {}
});
