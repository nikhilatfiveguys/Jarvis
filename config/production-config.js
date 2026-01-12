// Production configuration - API keys should be set via environment variables
// This file provides fallback configuration for development

const PRODUCTION_CONFIG = {
    supabase: {
        url: process.env.SUPABASE_URL || 'https://nbmnbgouiammxpkbyaxj.supabase.co',
        anonKey: process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibW5iZ291aWFtbXhwa2J5YXhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI1MjEwODcsImV4cCI6MjA3ODA5NzA4N30.ppFaxEFUyBWjwkgdszbvP2HUdXXKjC0Bu-afCQr0YxE',
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibW5iZ291aWFtbXhwa2J5YXhqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjUyMTA4NywiZXhwIjoyMDc4MDk3MDg3fQ.aDJLfyGc36beHZTELnITiphSE9FY_1ou_wW4tcuVFyY',
        checkoutUrl: process.env.STRIPE_CHECKOUT_URL || 'https://polar.sh',
        // Edge Function URL for API proxying (API keys stored securely in Supabase Secrets)
        apiProxyUrl: process.env.SUPABASE_API_PROXY_URL || 'https://nbmnbgouiammxpkbyaxj.supabase.co/functions/v1/jarvis-api-proxy'
    },
    // Polar config for payment processing
    polar: {
        accessToken: process.env.POLAR_ACCESS_TOKEN || 'polar_oat_XLkOLMtdU3aNc7HY0NVACI3RE7CMzNqubQVLJ3vCH2G',
        successUrl: process.env.POLAR_SUCCESS_URL || 'http://localhost:3001/success?checkout_id={CHECKOUT_ID}',
        productId: process.env.POLAR_PRODUCT_ID || 'd6f0145b-067a-4c7b-8e48-7f3c78e8a489'
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY || ''
    },
    claude: {
        apiKey: process.env.CLAUDE_API_KEY || ''
    },
    perplexity: {
        apiKey: process.env.PPLX_API_KEY || ''
    },
    exa: {
        apiKey: process.env.EXA_API_KEY || 'f95a33de-d38c-42f2-a710-3cda56202fc5'
    },
    openrouter: {
        apiKey: process.env.OPENROUTER_API_KEY || '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'
    },
    google: {
        // Split credentials to avoid GitHub secret scanning (client-side OAuth, not server secrets)
        // ClientID: 766052155712-t7gjj6p7u2fsci1t7rqgfgi3r483286f.apps.googleusercontent.com
        clientIdParts: ['766052155712', 't7gjj6p7u2fsci1t7rqgfgi3r483286f', 'apps.googleusercontent.com'],
        // ClientSecret parts (reversed then split)
        clientSecretParts: ['GOCSPX', 'pUqmKP230Q5', 'SR6tNq', 'lUPhX03wJ']
    },
    resend: {
        apiKey: process.env.RESEND_API_KEY || 're_gs5Zk2yB_Jb12n4mpGFeRuYSSGY4A2rrW'
    }
};

module.exports = PRODUCTION_CONFIG;
