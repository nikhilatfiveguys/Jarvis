// Production configuration - API keys should be set via environment variables
// This file provides fallback configuration for development

const PRODUCTION_CONFIG = {
    polar: {
        accessToken: process.env.POLAR_ACCESS_TOKEN || 'polar_oat_zp36dHm9MzIXn8Aw9k17zGlrVcuzr8ogRCIrJ2QpDa1',
        successUrl: process.env.POLAR_SUCCESS_URL || 'http://localhost:3001/success?checkout_id={CHECKOUT_ID}',
        productId: process.env.POLAR_PRODUCT_ID || 'd6f0145b-067a-4c7b-8e48-7f3c78e8a489',
        webhookSecret: process.env.POLAR_WEBHOOK_SECRET || 'polar_whs_cpI7jxrN5W7f5DB1enDIv4JVMrp8DiCStg8wm01lxyn',
        organizationId: process.env.POLAR_ORGANIZATION_ID || '',
        webhookUrl: process.env.POLAR_WEBHOOK_URL || 'https://yesjarvis.com/webhook/polar'
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY || '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'
    },
    exa: {
        apiKey: process.env.EXA_API_KEY || 'f95a33de-d38c-42f2-a710-3cda56202fc5'
    },
    claude: {
        apiKey: process.env.CLAUDE_API_KEY || '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'
    },
    perplexity: {
        apiKey: process.env.PPLX_API_KEY || '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'
    }
};

module.exports = PRODUCTION_CONFIG;
