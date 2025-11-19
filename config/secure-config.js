// Secure configuration management for Jarvis 6.0
const fs = require('fs');
const path = require('path');

class SecureConfig {
    constructor() {
        // Load .env file if it exists (works cross-platform)
        this.loadEnvFile();
        this.config = this.loadConfig();
    }

    loadConfig() {
        // Load production configuration (reads from process.env which is populated by .env file)
        console.log('Loading production configuration');
        return this.loadProductionConfig();
    }

    loadEnvFile() {
        // Try to load .env file from project root (works on both macOS and Windows)
        const envPath = path.join(__dirname, '..', '.env');
        if (fs.existsSync(envPath)) {
            console.log('Loading .env file from:', envPath);
            this.loadEnvFileContents(envPath);
        } else {
            console.log('No .env file found. Using environment variables or defaults.');
        }
    }

    loadEnvFileContents(filePath) {
        try {
            const envFile = fs.readFileSync(filePath, 'utf8');
            const lines = envFile.split('\n');
            
            lines.forEach(line => {
                const trimmedLine = line.trim();
                if (trimmedLine && !trimmedLine.startsWith('#')) {
                    const [key, ...valueParts] = trimmedLine.split('=');
                    const value = valueParts.join('=').replace(/^["']|["']$/g, '');
                    if (key && value && value !== 'your-perplexity-api-key-here' && value !== 'your-openai-api-key-here') {
                        process.env[key] = value;
                    }
                }
            });
            console.log('✅ .env file loaded successfully');
        } catch (error) {
            console.warn('⚠️ Failed to load .env file:', error.message);
        }
    }


    loadFromEnvironment() {
        // Hardcoded API keys - always return production config
        return this.loadProductionConfig();
    }

    loadProductionConfig() {
        try {
            const productionConfig = require('./production-config');
            return {
                supabase: productionConfig.supabase,
                polar: productionConfig.polar, // Legacy support
                openai: productionConfig.openai,
                exa: productionConfig.exa,
                claude: productionConfig.claude || { apiKey: '' },
                perplexity: productionConfig.perplexity || { apiKey: '' },
                app: {
                    environment: 'production',
                    isProduction: true
                }
            };
        } catch (error) {
            console.error('Failed to load production configuration:', error);
            return this.loadFromEnvironment();
        }
    }

    // Google OAuth removed - using simple payment system

    getSupabaseConfig() {
        return this.config.supabase;
    }

    getPolarConfig() {
        return this.config.polar;
    }

    getOpenAIConfig() {
        return this.config.openai;
    }

    getExaConfig() {
        return this.config.exa;
    }

    getClaudeConfig() {
        return this.config.claude || { apiKey: '' };
    }

    getPerplexityConfig() {
        return this.config.perplexity || { apiKey: '' };
    }

    getSupabaseApiProxyUrl() {
        return this.config.supabase?.apiProxyUrl || '';
    }

    isProduction() {
        return this.config.app.isProduction;
    }

    validateConfig() {
        const errors = [];
        
        // Validate Supabase config
        if (!this.config.supabase || !this.config.supabase.url) {
            errors.push('SUPABASE_URL is required');
        }
        
        if (!this.config.supabase || !this.config.supabase.anonKey) {
            errors.push('SUPABASE_ANON_KEY is required');
        }
        
        if (!this.config.openai.apiKey) {
            errors.push('OPENAI_API_KEY is required');
        }
        
        if (!this.config.exa.apiKey) {
            errors.push('EXA_API_KEY is required');
        }
        
        if (errors.length > 0) {
            throw new Error(`Configuration validation failed:\n${errors.join('\n')}`);
        }
        
        return true;
    }
}

module.exports = SecureConfig;
