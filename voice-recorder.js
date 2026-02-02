const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const FormData = require('form-data');

class VoiceRecorder {
    constructor(apiKey) {
        this.isRecording = false;
        this.recordingProcess = null;
        this.tempDir = os.tmpdir();
        this.audioFile = null;
        this.apiKey = apiKey;
        this.useNativeRecording = false;
        this.audioChunks = [];
    }

    // Check if a command exists
    commandExists(cmd) {
        try {
            execSync(`which ${cmd}`, { stdio: 'pipe' });
            return true;
        } catch {
            return false;
        }
    }

    async startRecording() {
        if (this.isRecording) return;

        this.isRecording = true;
        this.audioFile = path.join(this.tempDir, `jarvis-recording-${Date.now()}.wav`);
        
        try {
            // Try external recording commands first
            const recordingCommands = [
                { cmd: '/opt/homebrew/bin/rec', args: ['-r', '16000', '-c', '1', '-t', 'wav', this.audioFile] },
                { cmd: '/opt/homebrew/bin/sox', args: ['-d', '-r', '16000', '-c', '1', this.audioFile] },
                { cmd: '/usr/local/bin/rec', args: ['-r', '16000', '-c', '1', '-t', 'wav', this.audioFile] },
                { cmd: '/usr/local/bin/sox', args: ['-d', '-r', '16000', '-c', '1', this.audioFile] },
                { cmd: 'rec', args: ['-r', '16000', '-c', '1', '-t', 'wav', this.audioFile] },
                { cmd: 'sox', args: ['-d', '-r', '16000', '-c', '1', this.audioFile] },
                { cmd: 'ffmpeg', args: ['-f', 'avfoundation', '-i', ':0', '-ar', '16000', '-ac', '1', '-y', this.audioFile] }
            ];

            let commandFound = false;
            
            for (const { cmd, args } of recordingCommands) {
                // Check if command exists before trying
                const cmdName = path.basename(cmd);
                const fullPath = cmd.startsWith('/') ? cmd : null;
                
                if (fullPath && !fs.existsSync(fullPath)) {
                    continue;
                }
                
                if (!fullPath && !this.commandExists(cmdName)) {
                    continue;
                }

                try {
                    console.log(`Trying recording command: ${cmd}`);
                    this.recordingProcess = spawn(cmd, args, {
                        stdio: ['pipe', 'pipe', 'pipe']
                    });

                    // Wait briefly to see if it starts successfully
                    const started = await new Promise((resolve) => {
                        let resolved = false;
                        
                        this.recordingProcess.on('error', (error) => {
                            console.log(`Recording command ${cmd} error:`, error.message);
                            if (!resolved) {
                                resolved = true;
                                resolve(false);
                            }
                        });

                        // If process is still running after 500ms, it's working
                        setTimeout(() => {
                            if (!resolved && this.recordingProcess && !this.recordingProcess.killed) {
                                resolved = true;
                                resolve(true);
                            }
                        }, 500);

                        this.recordingProcess.on('close', (code) => {
                            if (!resolved) {
                                resolved = true;
                                resolve(code === 0 || code === null);
                            }
                        });
                    });

                    if (started) {
                        console.log(`✅ Using recording command: ${cmd}`);
                        commandFound = true;
                        break;
                    } else {
                        // Kill the failed process
                        if (this.recordingProcess) {
                            try { this.recordingProcess.kill(); } catch {}
                        }
                    }
                } catch (error) {
                    console.log(`Recording command ${cmd} failed:`, error.message);
                    continue;
                }
            }

            if (!commandFound) {
                // Fallback: Use macOS screencapture for audio (available on all Macs)
                // Note: This requires user permission but no external tools
                console.log('⚠️ No sox/ffmpeg found, trying macOS native recording...');
                
                // Try using afrecord (built into macOS)
                const afrecordPath = '/usr/bin/afrecord';
                if (fs.existsSync(afrecordPath)) {
                    try {
                        this.recordingProcess = spawn(afrecordPath, [
                            '-f', 'WAVE',
                            '-c', '1',
                            '-r', '16000',
                            '-d', '300', // Max 5 minutes
                            this.audioFile
                        ], { stdio: ['pipe', 'pipe', 'pipe'] });
                        
                        const started = await new Promise((resolve) => {
                            setTimeout(() => resolve(this.recordingProcess && !this.recordingProcess.killed), 500);
                            this.recordingProcess.on('error', () => resolve(false));
                        });
                        
                        if (started) {
                            console.log('✅ Using macOS afrecord');
                            commandFound = true;
                        }
                    } catch (e) {
                        console.log('afrecord failed:', e.message);
                    }
                }
            }

            if (!commandFound) {
                // Final message with clear instructions
                const errorMsg = `Voice recording requires sox to be installed.

To install sox, open Terminal and run:
    brew install sox

If you don't have Homebrew, first install it from https://brew.sh

After installing sox, restart Jarvis.`;
                
                this.isRecording = false;
                throw new Error(errorMsg);
            }

            return this.audioFile;
        } catch (error) {
            console.error('Failed to start recording:', error);
            this.isRecording = false;
            throw error;
        }
    }

    async stopRecording() {
        if (!this.isRecording) return null;
        
        this.isRecording = false;
        
        if (!this.recordingProcess) return null;

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                // Force kill if it doesn't stop gracefully
                try { this.recordingProcess.kill('SIGKILL'); } catch {}
                resolve(this.audioFile);
            }, 3000);

            this.recordingProcess.on('close', (code) => {
                clearTimeout(timeout);
                // Accept any exit code since we're forcefully stopping
                resolve(this.audioFile);
            });

            // Send SIGTERM to stop recording gracefully
            try {
                this.recordingProcess.kill('SIGTERM');
            } catch (e) {
                clearTimeout(timeout);
                resolve(this.audioFile);
            }
        });
    }

    async transcribeAudio(audioFilePath) {
        try {
            // Check if file exists and has content
            if (!fs.existsSync(audioFilePath)) {
                throw new Error('Audio file not found');
            }

            const stats = fs.statSync(audioFilePath);
            if (stats.size === 0) {
                throw new Error('Audio file is empty');
            }

            console.log(`Transcribing audio file: ${audioFilePath} (${stats.size} bytes)`);

            return this._transcribeWithForm(fs.createReadStream(audioFilePath), 'recording.wav', 'audio/wav');
        } catch (error) {
            console.error('Transcription error:', error.response?.data || error.message);
            throw error;
        }
    }

    // Transcribe audio from a Buffer (used by browser-based recording)
    async transcribeAudioBuffer(audioBuffer, mimeType = 'audio/webm') {
        try {
            if (!audioBuffer || audioBuffer.length === 0) {
                throw new Error('Audio buffer is empty');
            }

            console.log(`Transcribing audio buffer: ${audioBuffer.length} bytes, type: ${mimeType}`);

            // Determine file extension from mime type
            let extension = 'webm';
            let contentType = mimeType;
            if (mimeType.includes('wav')) {
                extension = 'wav';
                contentType = 'audio/wav';
            } else if (mimeType.includes('mp4') || mimeType.includes('m4a')) {
                extension = 'm4a';
                contentType = 'audio/mp4';
            } else if (mimeType.includes('ogg')) {
                extension = 'ogg';
                contentType = 'audio/ogg';
            } else if (mimeType.includes('webm')) {
                extension = 'webm';
                contentType = 'audio/webm';
            }

            // Create a readable stream from the buffer
            const { Readable } = require('stream');
            const audioStream = new Readable();
            audioStream.push(audioBuffer);
            audioStream.push(null);

            return this._transcribeWithForm(audioStream, `recording.${extension}`, contentType);
        } catch (error) {
            console.error('Buffer transcription error:', error.message);
            throw error;
        }
    }

    // Internal method to handle transcription with FormData
    async _transcribeWithForm(audioSource, filename, contentType) {
        // Validate API key
        if (!this.apiKey || this.apiKey.trim() === '') {
            throw new Error('OpenAI API key is not configured. Please set OPENAI_API_KEY in your environment variables or .env file.');
        }

        const apiKey = this.apiKey.trim();
        const keyPreview = apiKey.length > 7 ? `${apiKey.substring(0, 7)}...` : '***';
        console.log(`🔊 Transcribing audio with API key: ${keyPreview}`);

        // Use form-data with https for multipart form handling
        const form = new FormData();
        form.append('file', audioSource, {
            filename: filename,
            contentType: contentType
        });
        form.append('model', 'whisper-1');
        form.append('language', 'en');
        form.append('response_format', 'json');

        const response = await new Promise((resolve, reject) => {
            const req = https.request({
                hostname: 'api.openai.com',
                path: '/v1/audio/transcriptions',
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    ...form.getHeaders()
                }
            }, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed.error) {
                            reject(new Error(parsed.error.message || 'Transcription failed'));
                        } else {
                            resolve({ data: parsed });
                        }
                    } catch (e) {
                        reject(new Error(`Failed to parse response: ${data}`));
                    }
                });
            });
            req.on('error', reject);
            form.pipe(req);
        });

        console.log('Transcription result:', response.data);
        return response.data.text || response.data.transcript || '';
    }

    async processVoiceInput() {
        const audioFile = await this.startRecording();
        
        // Wait for user to stop recording (this would be triggered by releasing Fn key)
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.stopRecording().then((file) => {
                    if (file) {
                        this.transcribeAudio(file)
                            .then(text => {
                                // Clean up temp file
                                try { fs.unlinkSync(file); } catch (e) {}
                                resolve(text);
                            })
                            .catch(reject);
                    } else {
                        resolve('');
                    }
                }).catch(reject);
            }, 10000); // 10 second timeout

            // This would be called when Fn key is released
            this.onStopRecording = () => {
                clearTimeout(timeout);
                this.stopRecording().then((file) => {
                    if (file) {
                        this.transcribeAudio(file)
                            .then(text => {
                                try { fs.unlinkSync(file); } catch (e) {}
                                resolve(text);
                            })
                            .catch(reject);
                    } else {
                        resolve('');
                    }
                }).catch(reject);
            };
        });
    }
}

module.exports = VoiceRecorder;
