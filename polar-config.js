// Load secure configuration
const SecureConfig = require('./config/secure-config');

// Get Polar configuration from secure config
const config = new SecureConfig();
const polarConfig = config.getPolarConfig();

const POLAR_CONFIG = {
    organizationId: polarConfig.organizationId,
    accessToken: polarConfig.accessToken,
    baseUrl: polarConfig.baseUrl
};

class PolarClient {
    constructor(config) {
        this.config = config;
        this.baseUrl = config.baseUrl;
        this.accessToken = config.accessToken;
    }

    async makeRequest(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
            ...options.headers
        };

        try {
            const response = await fetch(url, { ...options, headers });
            if (!response.ok) {
                throw new Error(`Polar API error: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            throw error;
        }
    }

    async getProducts() {
        return this.makeRequest(`/organizations/${this.config.organizationId}/products`);
    }

    async getFirstProduct() {
        const products = await this.getProducts();
        if (products && products.length > 0) {
            return products[0];
        }
        throw new Error('No products found');
    }

    async createCheckoutSession(productId, customerEmail, successUrl, cancelUrl) {
        return this.makeRequest('/checkout/sessions', {
            method: 'POST',
            body: JSON.stringify({
                product_id: productId,
                customer_email: customerEmail,
                success_url: successUrl,
                cancel_url: cancelUrl,
                metadata: {
                    app: 'jarvis-5.0',
                    user_email: customerEmail
                }
            })
        });
    }

    async getCustomerByEmail(email) {
        return this.makeRequest(`/customers?email=${encodeURIComponent(email)}`);
    }

    async getSubscriptionStatus(customerId) {
        return this.makeRequest(`/customers/${customerId}/subscriptions`);
    }

    async verifyLicense(licenseKey) {
        // This would be implemented based on your license verification system
        // For now, return a mock response
        return {
            valid: true,
            subscription: {
                status: 'active',
                product_id: 'your-product-id'
            }
        };
    }

    async validateLicense(licenseKey) {
        try {
            // In a real implementation, you'd validate the license key with Polar
            // For now, we'll simulate a successful validation
            return {
                customerEmail: 'user@example.com',
                expiryDate: '2025-12-31',
                features: ['unlimited_messages', 'screenshot_analysis', 'voice_activation'],
                status: 'active'
            };
        } catch (error) {
            throw new Error('Invalid license key');
        }
    }
}

class LicenseManager {
    constructor(polarClient) {
        this.polarClient = polarClient;
        this.licenseKey = null;
        this.trialStartDate = null;
        this.trialDays = 7;
    }

    get isTrialActive() {
        if (!this.trialStartDate) return false;
        const trialEnd = new Date(this.trialStartDate);
        trialEnd.setDate(trialEnd.getDate() + this.trialDays);
        return new Date() < trialEnd;
    }

    async checkLicense(userEmail = null) {
        try {
            if (this.isTrialActive) {
                return { valid: true, type: 'trial' };
            }

            if (this.licenseKey) {
                const verification = await this.polarClient.verifyLicense(this.licenseKey);
                if (verification.valid) {
                    return { valid: true, type: 'paid', subscription: verification.subscription };
                }
            }

            if (userEmail) {
                try {
                    const customer = await this.polarClient.getCustomerByEmail(userEmail);
                    if (customer && customer.length > 0) {
                        const subscriptions = await this.polarClient.getSubscriptionStatus(customer[0].id);
                        if (subscriptions && subscriptions.length > 0) {
                            const activeSubscription = subscriptions.find(sub => sub.status === 'active');
                            if (activeSubscription) {
                                return { 
                                    valid: true, 
                                    type: 'paid', 
                                    subscription: activeSubscription,
                                    customer: customer[0]
                                };
                            }
                        }
                    }
                } catch (emailError) {
                    // Silently handle email lookup errors
                }
            }

            return { valid: false, type: 'none' };
        } catch (error) {
            return { valid: false, type: 'error', error: error.message };
        }
    }

    getFeatureAccess() {
        return {
            unlimitedMessages: true,
            screenshotAnalysis: true,
            voiceActivation: true,
            appControl: true,
            cloudSync: true
        };
    }

    startTrial() {
        this.trialStartDate = new Date().toISOString();
    }
}

const polarClient = new PolarClient(POLAR_CONFIG);
const licenseManager = new LicenseManager(polarClient);

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { POLAR_CONFIG, PolarClient, LicenseManager, polarClient, licenseManager };
}