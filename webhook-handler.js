// Webhook handler for Polar subscription updates
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const SecureConfig = require('./config/secure-config');

class PolarWebhookHandler {
    constructor() {
        this.config = new SecureConfig();
        const polarConfig = this.config.getPolarConfig();
        this.webhookSecret = polarConfig.webhookSecret;
        
        if (!this.webhookSecret) {
            throw new Error('Polar webhook secret not configured. Please set POLAR_WEBHOOK_SECRET environment variable.');
        }
    }

    async handleWebhook(req, res) {
        try {
            const body = req.body;
            const signature = req.headers['polar-signature'];
            
            // Verify webhook signature
            if (!this.verifySignature(body, signature)) {
                return res.status(401).json({ error: 'Invalid signature' });
            }

            const event = body.type;
            const data = body.data;

            switch (event) {
                case 'subscription.created':
                    await this.handleSubscriptionCreated(data);
                    break;
                case 'subscription.updated':
                    await this.handleSubscriptionUpdated(data);
                    break;
                case 'subscription.cancelled':
                    await this.handleSubscriptionCancelled(data);
                    break;
                case 'payment.succeeded':
                    await this.handlePaymentSucceeded(data);
                    break;
                case 'payment.failed':
                    await this.handlePaymentFailed(data);
                    break;
                default:
                    console.log('Unhandled webhook event:', event);
            }

            res.status(200).json({ received: true });
        } catch (error) {
            console.error('Webhook handling error:', error);
            res.status(500).json({ error: 'Internal server error' });
        }
    }

    verifySignature(payload, signature) {
        if (!signature) return false;
        
        const expectedSignature = crypto
            .createHmac('sha256', this.webhookSecret)
            .update(JSON.stringify(payload))
            .digest('hex');
        
        return signature === `sha256=${expectedSignature}`;
    }

    async handleSubscriptionCreated(data) {
        console.log('Subscription created:', data);
        // Update user's subscription status
        await this.updateUserSubscriptionStatus(data.customer.email, 'active');
    }

    async handleSubscriptionUpdated(data) {
        console.log('Subscription updated:', data);
        // Update user's subscription status
        await this.updateUserSubscriptionStatus(data.customer.email, data.status);
    }

    async handleSubscriptionCancelled(data) {
        console.log('Subscription cancelled:', data);
        // Update user's subscription status
        await this.updateUserSubscriptionStatus(data.customer.email, 'cancelled');
    }

    async handlePaymentSucceeded(data) {
        console.log('Payment succeeded:', data);
        // Update user's subscription status
        await this.updateUserSubscriptionStatus(data.customer.email, 'active');
    }

    async handlePaymentFailed(data) {
        console.log('Payment failed:', data);
        // Update user's subscription status
        await this.updateUserSubscriptionStatus(data.customer.email, 'payment_failed');
    }

    async updateUserSubscriptionStatus(userEmail, status) {
        try {
            const userDataPath = path.join(process.env.HOME || process.env.USERPROFILE, 'Library', 'Application Support', 'Jarvis 6.0');
            const userFile = path.join(userDataPath, 'jarvis_user.json');
            
            if (fs.existsSync(userFile)) {
                const userData = JSON.parse(fs.readFileSync(userFile, 'utf8'));
                userData.subscriptionStatus = status;
                userData.lastUpdated = new Date().toISOString();
                
                fs.writeFileSync(userFile, JSON.stringify(userData, null, 2));
                console.log(`Updated subscription status for ${userEmail}: ${status}`);
            }
        } catch (error) {
            console.error('Error updating user subscription status:', error);
        }
    }
}

module.exports = PolarWebhookHandler;
