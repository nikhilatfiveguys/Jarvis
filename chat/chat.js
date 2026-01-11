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

// Setup voice input (Ctrl to speak)
function setupVoiceInput() {
    let recognition = null;
    
    // Check if browser supports speech recognition
    if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = false;
        recognition.lang = 'en-US';
        
        recognition.onresult = (event) => {
            const transcript = event.results[0][0].transcript;
            messageInput.value = transcript;
            sendButton.disabled = false;
        };
        
        recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
        };
    }
    
    // Ctrl key to start/stop recording
    document.addEventListener('keydown', (e) => {
        if (e.ctrlKey && recognition && !isRecording) {
            e.preventDefault();
            isRecording = true;
            recognition.start();
            messageInput.placeholder = 'Listening...';
        }
    });
    
    document.addEventListener('keyup', (e) => {
        if (!e.ctrlKey && recognition && isRecording) {
            recognition.stop();
            isRecording = false;
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
                            contentElement.textContent = fullResponse;
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
    contentDiv.textContent = content;
    
    bubbleDiv.appendChild(contentDiv);
    messageDiv.appendChild(bubbleDiv);
    
    return messageDiv;
}

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

