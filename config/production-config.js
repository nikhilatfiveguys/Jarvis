// Production configuration - API keys should be set via environment variables
// This file provides fallback configuration for development

const PRODUCTION_CONFIG = {
    polar: {
        accessToken: process.env.POLAR_ACCESS_TOKEN || '',
        successUrl: process.env.POLAR_SUCCESS_URL || 'http://localhost:3001/success?checkout_id={CHECKOUT_ID}',
        productId: process.env.POLAR_PRODUCT_ID || ''
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY || ''
    },
    exa: {
        apiKey: process.env.EXA_API_KEY || ''
    },
    claude: {
        apiKey: process.env.CLAUDE_API_KEY || ''
    }
};

module.exports = PRODUCTION_CONFIG;
