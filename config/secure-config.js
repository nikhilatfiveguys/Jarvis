// Secure configuration management for Jarvis 5.0
const fs = require('fs');
const path = require('path');

class SecureConfig {
    constructor() {
        this.config = this.loadConfig();
    }

    loadConfig() {
        // Try to load from environment variables first (production)
        if (process.env.NODE_ENV === 'production') {
            return this.loadFromEnvironment();
        }
        
        // For development, try to load from .env file
        try {
            const envPath = path.join(__dirname, '..', '.env');
            if (fs.existsSync(envPath)) {
                this.loadEnvFile(envPath);
            }
        } catch (error) {
            console.warn('No .env file found, using default configuration');
        }
        
        // Load from environment variables
        const envConfig = this.loadFromEnvironment();
        
        // If no environment variables are set, use production config
        if (!envConfig.polar.organizationId) {
            console.log('No environment variables found, using production configuration');
            return this.loadProductionConfig();
        }
        
        return envConfig;
    }

    loadEnvFile(filePath) {
        const envFile = fs.readFileSync(filePath, 'utf8');
        const lines = envFile.split('\n');
        
        lines.forEach(line => {
            const trimmedLine = line.trim();
            if (trimmedLine && !trimmedLine.startsWith('#')) {
                const [key, ...valueParts] = trimmedLine.split('=');
                const value = valueParts.join('=').replace(/^["']|["']$/g, '');
                if (key && value) {
                    process.env[key] = value;
                }
            }
        });
    }

    loadFromEnvironment() {
        return {
            polar: {
                accessToken: process.env.POLAR_ACCESS_TOKEN || '',
                successUrl: process.env.POLAR_SUCCESS_URL || '',
                productId: process.env.POLAR_PRODUCT_ID || '',
                webhookSecret: process.env.POLAR_WEBHOOK_SECRET || '',
                organizationId: process.env.POLAR_ORGANIZATION_ID || ''
            },
            openai: {
                apiKey: process.env.OPENAI_API_KEY || ''
            },
            exa: {
                apiKey: process.env.EXA_API_KEY || ''
            },
            claude: {
                apiKey: process.env.CLAUDE_API_KEY || ''
            },
            perplexity: {
                apiKey: process.env.PPLX_API_KEY || ''
            },
            app: {
                environment: process.env.NODE_ENV || 'development',
                isProduction: process.env.NODE_ENV === 'production'
            }
        };
    }

    loadProductionConfig() {
        try {
            const productionConfig = require('./production-config');
            return {
                polar: {
                    accessToken: productionConfig.polar.accessToken,
                    successUrl: productionConfig.polar.successUrl,
                    productId: productionConfig.polar.productId,
                    webhookSecret: productionConfig.polar.webhookSecret || '',
                    organizationId: productionConfig.polar.organizationId || '',
                    webhookUrl: productionConfig.polar.webhookUrl || ''
                },
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
        return this.config.claude;
    }

    getPerplexityConfig() {
        return this.config.perplexity;
    }

    isProduction() {
        return this.config.app.isProduction;
    }

    validateConfig() {
        const errors = [];
        
        if (!this.config.polar.organizationId) {
            errors.push('POLAR_ORGANIZATION_ID is required');
        }
        
        if (!this.config.polar.apiKey) {
            errors.push('POLAR_API_KEY is required');
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
