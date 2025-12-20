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
        this.platform = process.platform;
    }

    getRecordingCommands() {
        const audioFile = this.audioFile;
        
        if (this.platform === 'win32') {
            // Windows recording commands
            return [
                // FFmpeg with DirectShow (most common on Windows)
                ['ffmpeg', '-f', 'dshow', '-i', 'audio=Microphone', '-ar', '16000', '-ac', '1', '-y', audioFile],
                // FFmpeg with default audio device
                ['ffmpeg', '-f', 'dshow', '-i', 'audio=@device_cm_{33D9A762-90C8-11D0-BD43-00A0C911CE86}\\wave_{00000000-0000-0000-0000-000000000000}', '-ar', '16000', '-ac', '1', '-y', audioFile],
                // SoX on Windows (if installed)
                ['sox', '-t', 'waveaudio', '-d', '-r', '16000', '-c', '1', audioFile],
                ['rec', '-r', '16000', '-c', '1', '-t', 'wav', audioFile],
                // PowerShell-based recording as fallback
                ['powershell', '-Command', `
                    Add-Type -AssemblyName System.Speech;
                    Add-Type -TypeDefinition @"
                    using System;
                    using System.Runtime.InteropServices;
                    public class AudioRecorder {
                        [DllImport("winmm.dll")]
                        public static extern int mciSendString(string command, System.Text.StringBuilder returnValue, int returnLength, IntPtr callback);
                    }
"@;
                    [AudioRecorder]::mciSendString("open new Type waveaudio Alias recsound", $null, 0, 0);
                    [AudioRecorder]::mciSendString("record recsound", $null, 0, 0);
                    Start-Sleep -Seconds 30;
                    [AudioRecorder]::mciSendString("save recsound ${audioFile}", $null, 0, 0);
                    [AudioRecorder]::mciSendString("close recsound", $null, 0, 0);
                `]
            ];
        } else if (this.platform === 'darwin') {
            // macOS recording commands
            return [
                ['/opt/homebrew/bin/rec', '-r', '16000', '-c', '1', '-t', 'wav', audioFile],
                ['/opt/homebrew/bin/sox', '-t', 'coreaudio', 'default', '-r', '16000', '-c', '1', audioFile],
                ['/usr/local/bin/rec', '-r', '16000', '-c', '1', '-t', 'wav', audioFile],
                ['/usr/local/bin/sox', '-t', 'coreaudio', 'default', '-r', '16000', '-c', '1', audioFile],
                ['rec', '-r', '16000', '-c', '1', '-t', 'wav', audioFile],
                ['sox', '-t', 'coreaudio', 'default', '-r', '16000', '-c', '1', audioFile],
                ['ffmpeg', '-f', 'avfoundation', '-i', ':0', '-ar', '16000', '-ac', '1', '-y', audioFile]
            ];
        } else {
            // Linux recording commands
            return [
                ['arecord', '-f', 'S16_LE', '-r', '16000', '-c', '1', audioFile],
                ['sox', '-t', 'alsa', 'default', '-r', '16000', '-c', '1', audioFile],
                ['rec', '-r', '16000', '-c', '1', '-t', 'wav', audioFile],
                ['ffmpeg', '-f', 'alsa', '-i', 'default', '-ar', '16000', '-ac', '1', '-y', audioFile],
                ['ffmpeg', '-f', 'pulse', '-i', 'default', '-ar', '16000', '-ac', '1', '-y', audioFile]
            ];
        }
    }

    async startRecording() {
        if (this.isRecording) return;

        this.isRecording = true;
        this.audioFile = path.join(this.tempDir, `jarvis-recording-${Date.now()}.wav`);
        
        try {
            const recordingCommands = this.getRecordingCommands();

            let commandFound = false;
            for (const cmd of recordingCommands) {
                try {
                    const spawnOptions = {
                        stdio: 'pipe'
                    };
                    
                    // On Windows, hide the console window
                    if (this.platform === 'win32') {
                        spawnOptions.windowsHide = true;
                    }
                    
                    this.recordingProcess = spawn(cmd[0], cmd.slice(1), spawnOptions);

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
                const installInstructions = this.platform === 'win32'
                    ? 'Please install FFmpeg: https://ffmpeg.org/download.html and add it to your PATH'
                    : this.platform === 'darwin'
                    ? 'Please install sox: brew install sox'
                    : 'Please install sox or arecord: sudo apt install sox or sudo apt install alsa-utils';
                    
                throw new Error(`No working recording command found. ${installInstructions}`);
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
                // Accept code 0 or code 1 (ffmpeg returns 1 when killed)
                if (code === 0 || code === 1 || code === null) {
                    resolve(this.audioFile);
                } else {
                    reject(new Error(`Recording process exited with code ${code}`));
                }
            });

            // On Windows, use different signal
            if (this.platform === 'win32') {
                // Send 'q' to stdin for ffmpeg, or kill for other processes
                if (this.recordingProcess.stdin) {
                    this.recordingProcess.stdin.write('q');
                    this.recordingProcess.stdin.end();
                }
                // Give it a moment, then force kill if needed
                setTimeout(() => {
                    if (this.recordingProcess && !this.recordingProcess.killed) {
                        this.recordingProcess.kill();
                    }
                }, 500);
            } else {
                // Send SIGTERM to stop recording on Unix
                this.recordingProcess.kill('SIGTERM');
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
