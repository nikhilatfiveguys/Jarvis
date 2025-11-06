// Paywall functionality for Jarvis 5.0
const { ipcRenderer } = require('electron');

class PaywallManager {
    constructor() {
        this.polarClient = new PolarClient(POLAR_CONFIG);
        this.licenseManager = new LicenseManager(this.polarClient);
        this.setupEventListeners();
        this.checkCurrentStatus();
    }

    setupEventListeners() {
        document.getElementById('upgrade-btn').addEventListener('click', () => {
            this.startUpgrade();
        });

        document.getElementById('skip-btn').addEventListener('click', () => {
            this.skipUpgrade();
        });
    }

    async checkCurrentStatus() {
        try {
            console.log('🔍 Checking current subscription status...');
            
            // Check subscription status using the same system as the settings window
            const result = await ipcRenderer.invoke('check-subscription-status');
            
            if (result && result.hasActiveSubscription) {
                console.log('✅ User already has active subscription, skipping paywall');
                this.showAlreadySubscribed();
                
                // Auto-proceed to app since user is already subscribed
                // But still check for onboarding
                setTimeout(() => {
                    console.log('Auto-proceeding from paywall (has subscription)');
                    this.proceedToApp();
                }, 1500);
            } else {
                console.log('ℹ️ No active subscription found, showing paywall');
            }
        } catch (error) {
            console.error('Failed to check subscription status:', error);
        }
    }

    showTrialActive() {
        document.querySelector('.subtitle').textContent = 'Your free trial is active!';
        document.getElementById('upgrade-btn').textContent = 'Upgrade Now';
    }

    showAlreadySubscribed() {
        document.querySelector('.subtitle').textContent = 'You have an active subscription!';
        document.getElementById('upgrade-btn').textContent = 'Manage Subscription';
    }

    async startUpgrade() {
        this.showLoading(true);
        
        try {
            console.log('🎯 STARTING UPGRADE PROCESS');
            
            // Create checkout session using the same system as the settings window
            const result = await ipcRenderer.invoke('create-checkout-session');
            
            if (result && result.success) {
                console.log('✅ Checkout session created successfully');
                this.showSuccessMessage('Opening checkout page... Please complete your purchase in the browser.');
                
                // The main process will handle opening the external URL
                // Just wait a moment and then proceed to app
                setTimeout(() => {
                    this.proceedToApp();
                }, 2000);
            } else {
                console.error('❌ Error creating checkout session:', result?.error);
                this.showError('Failed to start upgrade process. Please try again.');
            }

        } catch (error) {
            console.error('Upgrade failed:', error);
            this.showError('Failed to start upgrade process. Please try again.');
        } finally {
            this.showLoading(false);
        }
    }


    skipUpgrade() {
        // Continue with limited features
        ipcRenderer.send('paywall-skipped');
        this.proceedToApp();
    }


    proceedToApp() {
        // Navigate to main app
        ipcRenderer.send('paywall-complete');
    }

    showLoading(show) {
        const loading = document.getElementById('loading');
        if (show) {
            loading.classList.add('active');
        } else {
            loading.classList.remove('active');
        }
    }

    showError(message) {
        const error = document.getElementById('error');
        error.textContent = message;
        error.classList.add('active');
        setTimeout(() => {
            error.classList.remove('active');
        }, 5000);
    }

    showSuccessMessage(message) {
        // Create success notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #4ade80;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            z-index: 1000;
            font-size: 14px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }
}

// Handle Polar webhook callbacks
class PolarWebhookHandler {
    constructor() {
        this.setupWebhookHandlers();
    }

    setupWebhookHandlers() {
        // Handle successful payment
        ipcRenderer.on('polar-payment-success', (event, data) => {
            this.handlePaymentSuccess(data);
        });

        // Handle failed payment
        ipcRenderer.on('polar-payment-failed', (event, data) => {
            this.handlePaymentFailed(data);
        });

        // Handle subscription cancellation
        ipcRenderer.on('polar-subscription-cancelled', (event, data) => {
            this.handleSubscriptionCancelled(data);
        });
    }

    handlePaymentSuccess(data) {
        console.log('Payment successful:', data);
        
        // Store license key
        if (data.license_key) {
            const licenseManager = new LicenseManager(new PolarClient(POLAR_CONFIG));
            licenseManager.storeLicense(data.license_key);
        }

        // Show success message
        this.showSuccessMessage('Welcome to Jarvis Pro! Your subscription is now active.');
        
        // Proceed to main app
        setTimeout(() => {
            ipcRenderer.send('paywall-complete');
        }, 2000);
    }

    handlePaymentFailed(data) {
        console.log('Payment failed:', data);
        this.showErrorMessage('Payment failed. Please try again or contact support.');
    }

    handleSubscriptionCancelled(data) {
        console.log('Subscription cancelled:', data);
        
        // Clear license
        const licenseManager = new LicenseManager(new PolarClient(POLAR_CONFIG));
        licenseManager.clearLicense();
        
        this.showInfoMessage('Your subscription has been cancelled. You can resubscribe anytime.');
    }

    showSuccessMessage(message) {
        // Create success notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #4ade80;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            z-index: 1000;
            font-size: 14px;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }

    showErrorMessage(message) {
        // Create error notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #ef4444;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            z-index: 1000;
            font-size: 14px;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }

    showInfoMessage(message) {
        // Create info notification
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #3b82f6;
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            z-index: 1000;
            font-size: 14px;
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.remove();
        }, 5000);
    }
}

// Initialize paywall when page loads
document.addEventListener('DOMContentLoaded', () => {
    new PaywallManager();
    new PolarWebhookHandler();
});
