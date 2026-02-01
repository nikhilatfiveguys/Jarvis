// OpenClaw Gateway Integration for Jarvis Overlay
// Connects to OpenClaw's local gateway at ws://127.0.0.1:18789

class OpenClawClient {
    constructor(options = {}) {
        this.url = options.url || 'ws://127.0.0.1:18789';
        this.token = options.token || null;
        this.password = options.password || null;
        this.ws = null;
        this.pending = new Map();
        this.connected = false;
        this.connectSent = false;
        this.connectNonce = null;
        this.lastSeq = null;
        this.reconnectTimer = null;
        this.backoffMs = 800;
        this.instanceId = this.generateUUID();
        
        // Track current running operation for cancellation
        this.currentRunId = null;
        this.currentRunAborted = false;
        this.runHandlers = {};
        
        // Callbacks
        this.onConnect = options.onConnect || (() => {});
        this.onDisconnect = options.onDisconnect || (() => {});
        this.onMessage = options.onMessage || (() => {});
        this.onEvent = options.onEvent || (() => {});
        this.onError = options.onError || (() => {});
        this.onAgentStream = options.onAgentStream || (() => {});
    }

    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }

    start() {
        if (this.ws) {
            this.ws.close();
        }
        
        try {
            this.ws = new WebSocket(this.url);
            
            this.ws.onopen = () => {
                console.log('[OpenClaw] WebSocket connected');
                this.queueConnect();
            };
            
            this.ws.onmessage = (event) => {
                this.handleMessage(event.data);
            };
            
            this.ws.onclose = (event) => {
                console.log('[OpenClaw] WebSocket closed:', event.code, event.reason);
                this.connected = false;
                this.connectSent = false;
                this.flushPending(new Error(`Gateway closed (${event.code}): ${event.reason}`));
                this.onDisconnect({ code: event.code, reason: event.reason });
                this.scheduleReconnect();
            };
            
            this.ws.onerror = (error) => {
                console.error('[OpenClaw] WebSocket error:', error);
                this.onError(error);
            };
        } catch (error) {
            console.error('[OpenClaw] Failed to create WebSocket:', error);
            this.onError(error);
            this.scheduleReconnect();
        }
    }

    stop() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.connected = false;
        this.flushPending(new Error('Client stopped'));
    }

    scheduleReconnect() {
        if (this.reconnectTimer) return;
        
        const delay = this.backoffMs;
        this.backoffMs = Math.min(this.backoffMs * 1.7, 15000);
        
        console.log(`[OpenClaw] Reconnecting in ${delay}ms...`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.start();
        }, delay);
    }

    flushPending(error) {
        for (const [, pending] of this.pending) {
            pending.reject(error);
        }
        this.pending.clear();
    }

    queueConnect() {
        this.connectNonce = null;
        this.connectSent = false;
        
        // Wait a bit for challenge event, then send connect
        setTimeout(() => {
            if (!this.connectSent) {
                this.sendConnect();
            }
        }, 750);
    }

    sendConnect() {
        if (this.connectSent) return;
        this.connectSent = true;

        const params = {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
                id: 'gateway-client',
                version: '1.0.0',
                platform: 'electron',
                mode: 'webchat',
                instanceId: this.instanceId
            },
            caps: [],
            auth: { token: this.token || '' },
            userAgent: 'Jarvis-Overlay/1.0'
        };

        this.request('connect', params)
            .then((hello) => {
                console.log('[OpenClaw] Connected successfully:', hello);
                this.connected = true;
                this.backoffMs = 800;
                this.onConnect(hello);
            })
            .catch((error) => {
                console.error('[OpenClaw] Connect failed:', error);
                this.ws?.close(4008, 'connect failed');
            });
    }

    handleMessage(raw) {
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            console.error('[OpenClaw] Failed to parse message:', raw);
            return;
        }

        const frame = parsed;

        // Handle events
        if (frame.type === 'event') {
            // Handle connect challenge
            if (frame.event === 'connect.challenge') {
                const nonce = frame.payload?.nonce;
                if (nonce) {
                    this.connectNonce = nonce;
                    this.sendConnect();
                }
                return;
            }

            // Track sequence numbers
            if (typeof frame.seq === 'number') {
                if (this.lastSeq !== null && frame.seq > this.lastSeq + 1) {
                    console.warn('[OpenClaw] Event gap detected:', this.lastSeq + 1, 'to', frame.seq);
                }
                this.lastSeq = frame.seq;
            }

            // Handle agent events (streaming)
            if (frame.event === 'agent') {
                const payload = frame.payload;
                const runId = payload?.runId;
                
                // Route to run handler if exists
                if (runId && this.runHandlers && this.runHandlers[runId]) {
                    this.runHandlers[runId](payload);
                }
                
                this.onAgentStream(payload);
            }

            this.onEvent(frame);
            return;
        }

        // Handle responses
        if (frame.type === 'res') {
            const pending = this.pending.get(frame.id);
            if (!pending) return;
            
            this.pending.delete(frame.id);
            
            if (frame.ok) {
                pending.resolve(frame.payload);
            } else {
                pending.reject(new Error(frame.error?.message || 'Request failed'));
            }
            return;
        }
    }

    request(method, params) {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('Gateway not connected'));
                return;
            }

            const id = this.generateUUID();
            const frame = {
                type: 'req',
                id,
                method,
                params
            };

            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify(frame));
        });
    }

    // Send a message to the OpenClaw agent and get a response
    // options.onStream: callback(text, streamType) - called with each chunk of streaming content
    //   streamType: 'thinking' | 'response' | 'tool' | 'status'
    async sendMessage(message, options = {}) {
        // Reset abort flag for new request
        this.currentRunAborted = false;
        
        const params = {
            message: message,
            idempotencyKey: this.generateUUID(),
            thinking: options.thinking || 'medium',
            sessionKey: options.sessionKey || 'jarvis-main'
        };

        // Only add optional params if they're explicitly set
        if (options.agentId) params.agentId = options.agentId;
        if (options.timeout) params.timeout = options.timeout;
        if (options.extraSystemPrompt) params.extraSystemPrompt = options.extraSystemPrompt;

        // Stream callback for real-time updates
        const onStream = options.onStream || (() => {});

        // Send the request and get the runId
        const acceptResponse = await this.request('agent', params);
        const runId = acceptResponse?.runId;
        
        if (!runId) {
            throw new Error('No runId received from agent request');
        }

        // Track current run for cancellation
        this.currentRunId = runId;

        // Set up to collect streamed response
        return new Promise((resolve, reject) => {
            let responseText = '';
            let thinkingText = '';
            let completed = false;
            const timeoutMs = options.timeout || 120000;
            
            const timeout = setTimeout(() => {
                if (!completed) {
                    completed = true;
                    this.currentRunId = null;
                    delete this.runHandlers[runId];
                    if (responseText) {
                        resolve(responseText);
                    } else {
                        reject(new Error('Agent response timeout'));
                    }
                }
            }, timeoutMs);

            // Store handler for this run
            this.runHandlers[runId] = (payload) => {
                // Check if this run was aborted
                if (this.currentRunAborted && this.currentRunId === runId) {
                    if (!completed) {
                        completed = true;
                        clearTimeout(timeout);
                        this.currentRunId = null;
                        delete this.runHandlers[runId];
                        reject(new Error('Request cancelled by user'));
                    }
                    return;
                }
                
                const stream = payload?.stream;
                const data = payload?.data;
                
                // Handle different stream types
                if (stream === 'thinking' || stream === 'thought') {
                    // Thinking/reasoning stream
                    const chunk = data?.delta || data?.text || data?.content || '';
                    if (chunk) {
                        thinkingText += chunk;
                        onStream(thinkingText, 'thinking');
                    }
                } else if (stream === 'tool' || stream === 'tool_call' || stream === 'function') {
                    // Tool usage stream
                    const toolName = data?.name || data?.tool || 'tool';
                    const toolStatus = data?.status || data?.phase || '';
                    onStream(`🔧 ${toolName}${toolStatus ? ': ' + toolStatus : ''}`, 'tool');
                } else if (stream === 'status' || stream === 'lifecycle') {
                    // Status updates
                    const phase = data?.phase || '';
                    if (phase === 'start') {
                        onStream('Starting...', 'status');
                    } else if (phase === 'end') {
                        // Completion
                        if (!completed) {
                            completed = true;
                            clearTimeout(timeout);
                            this.currentRunId = null;
                            delete this.runHandlers[runId];
                            resolve(responseText || 'No response received');
                        }
                        return;
                    }
                } else {
                    // Response text stream (default)
                    const chunk = data?.delta || '';
                    const text = data?.text || '';
                    const content = data?.content || '';
                    
                    if (chunk) {
                        responseText += chunk;
                        onStream(responseText, 'response');
                    } else if (text && stream !== 'lifecycle') {
                        responseText += text;
                        onStream(responseText, 'response');
                    } else if (content && typeof content === 'string') {
                        responseText += content;
                        onStream(responseText, 'response');
                    }
                }
            };
        });
    }

    // Abort the current running command
    abortCurrentRun() {
        if (this.currentRunId) {
            console.log('[OpenClaw] Aborting current run:', this.currentRunId);
            this.currentRunAborted = true;
            
            // Try to send abort request to the gateway
            try {
                this.request('agent.abort', { runId: this.currentRunId })
                    .then(() => console.log('[OpenClaw] Abort request sent'))
                    .catch(err => console.log('[OpenClaw] Abort request failed (may not be supported):', err.message));
            } catch (e) {
                // Ignore errors - the abort flag will handle cleanup
            }
            
            // Clean up the run handler
            if (this.runHandlers[this.currentRunId]) {
                delete this.runHandlers[this.currentRunId];
            }
            
            const abortedRunId = this.currentRunId;
            this.currentRunId = null;
            return abortedRunId;
        }
        return null;
    }

    // Check if there's a running command
    isRunning() {
        return this.currentRunId !== null && !this.currentRunAborted;
    }

    // Get the current status
    async getStatus() {
        return await this.request('status', {});
    }

    // List available sessions
    async listSessions() {
        return await this.request('sessions.list', {});
    }

    // Reset a session (delete it to clear all context)
    async resetSession(sessionKey = 'jarvis-main') {
        try {
            // First try to delete the session completely
            await this.request('sessions.delete', { sessionKey });
        } catch (e) {
            console.log('[OpenClaw] Session delete failed, trying reset:', e.message);
            // Fall back to reset if delete fails
            try {
                await this.request('sessions.reset', { sessionKey });
            } catch (e2) {
                console.log('[OpenClaw] Session reset also failed:', e2.message);
            }
        }
        return { success: true };
    }

    // Get session history
    async getSessionHistory(sessionKey = 'jarvis-main', limit = 50) {
        return await this.request('sessions.history', { sessionKey, limit });
    }
}

// Export for use in Jarvis
if (typeof module !== 'undefined' && module.exports) {
    module.exports = OpenClawClient;
}

// Also make available globally for browser context
if (typeof window !== 'undefined') {
    window.OpenClawClient = OpenClawClient;
}
