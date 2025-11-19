// Production configuration - API keys should be set via environment variables
// This file provides fallback configuration for development

const PRODUCTION_CONFIG = {
    supabase: {
        url: process.env.SUPABASE_URL || 'https://nbmnbgouiammxpkbyaxj.supabase.co',
        anonKey: process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibW5iZ291aWFtbXhwa2J5YXhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI1MjEwODcsImV4cCI6MjA3ODA5NzA4N30.ppFaxEFUyBWjwkgdszbvP2HUdXXKjC0Bu-afCQr0YxE',
        serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibW5iZ291aWFtbXhwa2J5YXhqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MjUyMTA4NywiZXhwIjoyMDc4MDk3MDg3fQ.aDJLfyGc36beHZTELnITiphSE9FY_1ou_wW4tcuVFyY',
        checkoutUrl: process.env.STRIPE_CHECKOUT_URL || 'https://polar.sh'
    },
    // Polar config for payment processing
    polar: {
        accessToken: process.env.POLAR_ACCESS_TOKEN || 'polar_oat_JhNo3mK5bbMPTZr4535nh3bCQX4aY6PxCvQS92cK3pO',
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
    }
};

module.exports = PRODUCTION_CONFIG;
