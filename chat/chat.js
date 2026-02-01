// Supabase Configuration (for future use)
const SUPABASE_URL = 'https://nbmnbgouiammxpkbyaxj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibW5iZ291aWFtbXhwa2J5YXhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI1MjEwODcsImV4cCI6MjA3ODA5NzA4N30.ppFaxEFUyBWjwkgdszbvP2HUdXXKjC0Bu-afCQr0YxE';

// DOM Elements
const chatContainer = document.getElementById('chatContainer');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const attachButton = document.getElementById('attachButton');
const typingIndicator = document.getElementById('typingIndicator');
const welcomeMessage = document.getElementById('welcomeMessage');

// State
let conversationHistory = [];
let isStreaming = false;
let currentAbortController = null;
let isRecording = false;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadConversationHistory();
    setupEventListeners();
    setupVoiceInput();
});

// Load conversation history from localStorage
function loadConversationHistory() {
    const saved = localStorage.getItem('jarvis-chat-history');
    if (saved) {
        try {
            conversationHistory = JSON.parse(saved);
            conversationHistory.forEach(msg => {
                if (msg.role === 'user' || msg.role === 'assistant') {
                    displayMessage(msg.content, msg.role);
                }
            });
        } catch (e) {
            console.error('Error loading conversation history:', e);
        }
    }
}

// Save conversation history to localStorage
function saveConversationHistory() {
    localStorage.setItem('jarvis-chat-history', JSON.stringify(conversationHistory));
}

// Setup event listeners
function setupEventListeners() {
    sendButton.addEventListener('click', handleSend);
    messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });
    
    messageInput.addEventListener('input', () => {
        sendButton.disabled = messageInput.value.trim() === '' || isStreaming;
    });
}

// Setup voice input (hold Ctrl to speak, release to stop)
function setupVoiceInput() {
    let recognition = null;
    let ctrlKeyDown = false;
    let otherKeyPressed = false;
    
    // Check if browser supports speech recognition
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = true; // Keep listening while key is held
        recognition.interimResults = true; // Show results as user speaks
        recognition.lang = 'en-US';
        
        recognition.onresult = (event) => {
            let finalTranscript = '';
            let interimTranscript = '';
            
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }
            
            // Show interim results while speaking, final when done
            if (finalTranscript) {
                messageInput.value = finalTranscript;
            } else if (interimTranscript) {
                messageInput.value = interimTranscript;
            }
            sendButton.disabled = messageInput.value.trim() === '';
        };
        
        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
            isRecording = false;
            ctrlKeyDown = false;
            messageInput.placeholder = 'Ask Jarvis Anything...';
        };
        
        recognition.onend = () => {
            // Only restart if we're still supposed to be recording
            if (isRecording && ctrlKeyDown) {
                try {
                    recognition.start();
                } catch (e) {
                    // Already started, ignore
                }
            }
        };
    }
    
    // Track if another key is pressed during Ctrl hold (indicates a combo)
    document.addEventListener('keydown', (e) => {
        if (ctrlKeyDown && e.key !== 'Control') {
            otherKeyPressed = true;
            // Stop recording if it was a Ctrl+key combo
            if (isRecording && recognition) {
                recognition.stop();
                isRecording = false;
                messageInput.placeholder = 'Ask Jarvis Anything...';
            }
            return;
        }
        
        // Start recording when Control is pressed (not repeated, not already recording)
        if (e.key === 'Control' && !e.repeat && recognition && !isRecording && !ctrlKeyDown) {
            ctrlKeyDown = true;
            otherKeyPressed = false;
            
            // Small delay to catch Ctrl+key combos
            setTimeout(() => {
                if (!otherKeyPressed && ctrlKeyDown && !isRecording) {
                    e.preventDefault();
                    isRecording = true;
                    try {
                        recognition.start();
                        messageInput.placeholder = 'Listening... (release Ctrl to stop)';
                        console.log('🎤 Voice input started (Ctrl held)');
                    } catch (err) {
                        console.error('Failed to start recognition:', err);
                        isRecording = false;
                    }
                }
            }, 50);
        }
    });
    
    // Stop recording when Control is released
    document.addEventListener('keyup', (e) => {
        if (e.key === 'Control') {
            ctrlKeyDown = false;
            
            if (isRecording && recognition) {
                recognition.stop();
                isRecording = false;
                messageInput.placeholder = 'Ask Jarvis Anything...';
                console.log('🎤 Voice input stopped (Ctrl released)');
            }
            
            otherKeyPressed = false;
        }
    });
    
    // Stop recording if window loses focus
    window.addEventListener('blur', () => {
        if (isRecording && recognition) {
            recognition.stop();
            isRecording = false;
            ctrlKeyDown = false;
            messageInput.placeholder = 'Ask Jarvis Anything...';
        }
    });
}

// Handle send message
async function handleSend() {
    const message = messageInput.value.trim();
    if (!message || isStreaming) return;
    
    // Hide welcome message
    if (welcomeMessage) {
        welcomeMessage.style.display = 'none';
    }
    
    // Display user message
    displayMessage(message, 'user');
    conversationHistory.push({ role: 'user', content: message });
    saveConversationHistory();
    
    // Clear input
    messageInput.value = '';
    sendButton.disabled = true;
    
    // Show typing indicator
    showTypingIndicator();
    
    // Get API key from Supabase
    try {
        // Send message - will get API key from backend
        await streamChatResponse(message);
    } catch (error) {
        console.error('Error sending message:', error);
        displayMessage('Sorry, I encountered an error. Please try again.', 'assistant');
    } finally {
        hideTypingIndicator();
        isStreaming = false;
        sendButton.disabled = false;
        messageInput.focus();
    }
}

// Note: API key retrieval is now handled by the Firebase Cloud Function
// which securely accesses Supabase to get the OpenAI API key

// Stream chat response from OpenAI
async function streamChatResponse(userMessage) {
    isStreaming = true;
    currentAbortController = new AbortController();
    
    // Prepare messages for API
    const messages = conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content
    }));
    
    // Add system message if not present
    if (!messages.find(m => m.role === 'system')) {
        messages.unshift({
            role: 'system',
            content: 'You are Jarvis, a helpful AI assistant. Be concise, friendly, and helpful.'
        });
    }
    
    try {
        // Use Firebase Cloud Function to proxy the request
        // This will get the API key from Supabase automatically
        const firebaseFunctionUrl = 'https://us-central1-zofa-1aa85.cloudfunctions.net/chat';
        
        const response = await fetch(firebaseFunctionUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                messages: messages
            }),
            signal: currentAbortController.signal
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to get response');
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        // Create assistant message element
        const messageElement = createMessageElement('', 'assistant');
        chatContainer.appendChild(messageElement);
        const contentElement = messageElement.querySelector('.message-content');
        
        let fullResponse = '';
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const data = line.slice(6);
                    if (data === '[DONE]') {
                        break;
                    }
                    
                    try {
                        const json = JSON.parse(data);
                        const delta = json.choices?.[0]?.delta?.content || '';
                        if (delta) {
                            fullResponse += delta;
                            // Re-render with code block parsing
                            contentElement.innerHTML = parseMessageContent(fullResponse);
                            setupCodeBlockCopy(contentElement);
                            scrollToBottom();
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                }
            }
        }
        
        // Save assistant response to history
        conversationHistory.push({ role: 'assistant', content: fullResponse });
        saveConversationHistory();
        
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('Request aborted');
        } else {
            throw error;
        }
    } finally {
        currentAbortController = null;
    }
}

// Display message in chat
function displayMessage(content, role) {
    const messageElement = createMessageElement(content, role);
    chatContainer.appendChild(messageElement);
    scrollToBottom();
}

// Create message element
function createMessageElement(content, role) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    
    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'message-bubble';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    // Parse and render content with code blocks
    contentDiv.innerHTML = parseMessageContent(content);
    
    // Add copy functionality to code blocks
    setupCodeBlockCopy(contentDiv);
    
    bubbleDiv.appendChild(contentDiv);
    messageDiv.appendChild(bubbleDiv);
    
    return messageDiv;
}

// Parse message content and convert code blocks to HTML with copy buttons
function parseMessageContent(content) {
    if (!content) return '';
    
    // Regex to match code blocks with optional language
    const codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
    
    let result = '';
    let lastIndex = 0;
    let match;
    
    while ((match = codeBlockRegex.exec(content)) !== null) {
        // Add text before the code block
        const textBefore = content.slice(lastIndex, match.index);
        result += escapeHtml(textBefore);
        
        const language = match[1] || '';
        const code = match[2].trim();
        
        // Create code block HTML with copy button
        result += createCodeBlockHtml(code, language);
        
        lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text after last code block
    result += escapeHtml(content.slice(lastIndex));
    
    // Convert newlines to <br> for non-code content
    result = result.replace(/\n/g, '<br>');
    
    return result;
}

// Create HTML for a code block with copy button
function createCodeBlockHtml(code, language) {
    const escapedCode = escapeHtml(code);
    const langDisplay = language || 'code';
    
    return `
        <div class="code-block-container" data-code="${escapedCode.replace(/"/g, '&quot;')}">
            <div class="code-block-header">
                <span class="code-language">${langDisplay}</span>
                <button class="copy-button" onclick="copyCodeBlock(this, event)">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    Copy
                </button>
            </div>
            <pre><code>${escapedCode}</code></pre>
        </div>
    `.replace(/\n/g, '');
}

// Escape HTML special characters
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Setup click-to-copy on code blocks
function setupCodeBlockCopy(contentDiv) {
    const codeBlocks = contentDiv.querySelectorAll('.code-block-container');
    codeBlocks.forEach(container => {
        const pre = container.querySelector('pre');
        if (pre) {
            pre.addEventListener('click', (e) => {
                // Don't trigger if clicking the copy button
                if (e.target.closest('.copy-button')) return;
                
                const code = container.querySelector('code');
                if (code) {
                    copyToClipboard(code.textContent, container);
                }
            });
        }
    });
}

// Copy code block content
function copyCodeBlock(button, event) {
    event.stopPropagation();
    const container = button.closest('.code-block-container');
    const code = container.querySelector('code');
    if (code) {
        copyToClipboard(code.textContent, container, button);
    }
}

// Copy text to clipboard with visual feedback
async function copyToClipboard(text, container, button = null) {
    try {
        await navigator.clipboard.writeText(text);
        
        // Visual feedback
        if (button) {
            const originalText = button.innerHTML;
            button.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
                Copied!
            `;
            button.classList.add('copied');
            
            setTimeout(() => {
                button.innerHTML = originalText;
                button.classList.remove('copied');
            }, 2000);
        } else {
            // Flash the container when clicking the pre element
            const pre = container.querySelector('pre');
            if (pre) {
                pre.style.background = 'rgba(34, 197, 94, 0.2)';
                setTimeout(() => {
                    pre.style.background = '';
                }, 300);
            }
        }
    } catch (err) {
        console.error('Failed to copy:', err);
    }
}

// Make copyCodeBlock available globally
window.copyCodeBlock = copyCodeBlock;

// Show typing indicator
function showTypingIndicator() {
    typingIndicator.style.display = 'flex';
    chatContainer.appendChild(typingIndicator);
    scrollToBottom();
}

// Hide typing indicator
function hideTypingIndicator() {
    typingIndicator.style.display = 'none';
    if (typingIndicator.parentNode) {
        typingIndicator.parentNode.removeChild(typingIndicator);
    }
}

// Scroll to bottom
function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Clear conversation
function clearConversation() {
    conversationHistory = [];
    localStorage.removeItem('jarvis-chat-history');
    chatContainer.innerHTML = '';
    if (welcomeMessage) {
        welcomeMessage.style.display = 'block';
        chatContainer.appendChild(welcomeMessage);
    }
}

// Export for potential use
window.jarvisChat = {
    clearConversation,
    sendMessage: handleSend
};

