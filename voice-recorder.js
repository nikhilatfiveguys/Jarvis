const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');
const FormData = require('form-data');

class VoiceRecorder {
    constructor(apiKey) {
        this.isRecording = false;
        this.recordingProcess = null;
        this.tempDir = os.tmpdir();
        this.audioFile = null;
        this.apiKey = apiKey;
    }

    async startRecording() {
        if (this.isRecording) return;

        this.isRecording = true;
        this.audioFile = path.join(this.tempDir, `jarvis-recording-${Date.now()}.wav`);
        
        try {
            // Use macOS's built-in recording with sox (try different approaches)
            const recordingCommands = [
                ['/opt/homebrew/bin/rec', '-r', '16000', '-c', '1', '-t', 'wav', this.audioFile],
                ['/opt/homebrew/bin/sox', '-t', 'coreaudio', '-r', '16000', '-c', '1', this.audioFile],
                ['/usr/local/bin/rec', '-r', '16000', '-c', '1', '-t', 'wav', this.audioFile],
                ['/usr/local/bin/sox', '-t', 'coreaudio', '-r', '16000', '-c', '1', this.audioFile],
                ['rec', '-r', '16000', '-c', '1', '-t', 'wav', this.audioFile],
                ['sox', '-t', 'coreaudio', '-r', '16000', '-c', '1', this.audioFile],
                ['ffmpeg', '-f', 'avfoundation', '-i', ':0', '-ar', '16000', '-ac', '1', this.audioFile]
            ];

            let commandFound = false;
            for (const cmd of recordingCommands) {
                try {
                    this.recordingProcess = spawn(cmd[0], cmd.slice(1), {
                        stdio: 'pipe'
                    });

                    this.recordingProcess.on('error', (error) => {
                        console.log(`Recording command ${cmd[0]} failed:`, error.message);
                        if (!commandFound) {
                            this.isRecording = false;
                        }
                    });

                    // Test if command works
                    await new Promise((resolve, reject) => {
                        const timeout = setTimeout(() => {
                            if (this.recordingProcess && !this.recordingProcess.killed) {
                                commandFound = true;
                                resolve();
                            } else {
                                reject(new Error('Command failed to start'));
                            }
                        }, 1000);

                        this.recordingProcess.on('close', (code) => {
                            clearTimeout(timeout);
                            if (code === 0 || code === null) {
                                commandFound = true;
                                resolve();
                            } else {
                                reject(new Error(`Command exited with code ${code}`));
                            }
                        });
                    });

                    if (commandFound) {
                        console.log(`Using recording command: ${cmd[0]}`);
                        break;
                    }
                } catch (error) {
                    console.log(`Recording command ${cmd[0]} not available:`, error.message);
                    continue;
                }
            }

            if (!commandFound) {
                throw new Error('No working recording command found. Please install sox: brew install sox\n\nTried paths:\n- /opt/homebrew/bin/rec\n- /opt/homebrew/bin/sox\n- /usr/local/bin/rec\n- /usr/local/bin/sox\n- rec (from PATH)\n- sox (from PATH)\n- ffmpeg (from PATH)');
            }

            return this.audioFile;
        } catch (error) {
            console.error('Failed to start recording:', error);
            this.isRecording = false;
            throw error;
        }
    }

    async stopRecording() {
        if (!this.isRecording || !this.recordingProcess) return null;

        this.isRecording = false;
        
        return new Promise((resolve, reject) => {
            this.recordingProcess.on('close', (code) => {
                if (code === 0) {
                    resolve(this.audioFile);
                } else {
                    reject(new Error(`Recording process exited with code ${code}`));
                }
            });

            // Send SIGTERM to stop recording
            this.recordingProcess.kill('SIGTERM');
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

            // Use axios for better multipart form handling
            const form = new FormData();
            form.append('file', fs.createReadStream(audioFilePath), {
                filename: 'recording.wav',
                contentType: 'audio/wav'
            });
            form.append('model', 'whisper-1');
            form.append('language', 'en');
            form.append('response_format', 'json');

            // Validate API key
            if (!this.apiKey || this.apiKey.trim() === '') {
                throw new Error('OpenAI API key is not configured. Please set OPENAI_API_KEY in your environment variables or .env file.');
            }

            const apiKey = this.apiKey.trim();
            // Log partial key for debugging
            const keyPreview = apiKey.length > 7 ? `${apiKey.substring(0, 7)}...` : '***';
            console.log(`🔊 Transcribing audio with API key: ${keyPreview}`);

            const response = await axios.post('https://api.openai.com/v1/audio/transcriptions', form, {
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    ...form.getHeaders()
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });

            console.log('Transcription result:', response.data);
            return response.data.text || response.data.transcript || '';
        } catch (error) {
            console.error('Transcription error:', error.response?.data || error.message);
            throw error;
        }
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
