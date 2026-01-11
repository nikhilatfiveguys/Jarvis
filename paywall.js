// Paywall functionality for Jarvis 6.0
const { ipcRenderer } = require('electron');

class PaywallManager {
    constructor() {
        // Subscription management is now handled via Supabase in main.js
        // No need for direct client access here
        this.isUpgrading = false; // Prevent multiple checkout sessions
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

        document.getElementById('sign-in-btn').addEventListener('click', () => {
            this.showSignInModal();
        });

        document.getElementById('sign-in-cancel').addEventListener('click', () => {
            this.hideSignInModal();
        });

        document.getElementById('sign-in-submit').addEventListener('click', () => {
            this.handleSignIn();
        });

        // Allow Enter key to submit sign-in
        document.getElementById('sign-in-email').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.handleSignIn();
            }
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
        // Prevent multiple checkout sessions
        if (this.isUpgrading) {
            console.log('⚠️ Upgrade already in progress, ignoring click');
            return;
        }
        
        this.isUpgrading = true;
        const upgradeBtn = document.getElementById('upgrade-btn');
        upgradeBtn.disabled = true;
        upgradeBtn.textContent = 'Opening...';
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
                const errorMsg = result?.error || 'Failed to start upgrade process. Please try again.';
                this.showError(errorMsg);
                // Re-enable button on error
                this.isUpgrading = false;
                upgradeBtn.disabled = false;
                upgradeBtn.textContent = 'Get';
            }

        } catch (error) {
            console.error('Upgrade failed:', error);
            this.showError('Failed to start upgrade process. Please try again.');
            // Re-enable button on error
            this.isUpgrading = false;
            upgradeBtn.disabled = false;
            upgradeBtn.textContent = 'Get';
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

    showSignInModal() {
        const modal = document.getElementById('sign-in-modal');
        const emailInput = document.getElementById('sign-in-email');
        modal.classList.add('active');
        emailInput.focus();
    }

    hideSignInModal() {
        const modal = document.getElementById('sign-in-modal');
        const emailInput = document.getElementById('sign-in-email');
        const errorDiv = document.getElementById('sign-in-error');
        modal.classList.remove('active');
        emailInput.value = '';
        errorDiv.classList.remove('active');
        errorDiv.textContent = '';
    }

    async handleSignIn() {
        const emailInput = document.getElementById('sign-in-email');
        const errorDiv = document.getElementById('sign-in-error');
        const submitBtn = document.getElementById('sign-in-submit');
        const email = emailInput.value.trim();

        // Validate email
        if (!email) {
            errorDiv.textContent = 'Please enter your email address';
            errorDiv.classList.add('active');
            return;
        }

        if (!email.includes('@') || !email.includes('.')) {
            errorDiv.textContent = 'Please enter a valid email address';
            errorDiv.classList.add('active');
            return;
        }

        errorDiv.classList.remove('active');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Signing in...';

        try {
            // Check subscription via IPC
            const result = await ipcRenderer.invoke('sign-in-user', email);
            
            if (result.success) {
                if (result.hasSubscription) {
                    this.showSuccessMessage('Signed in successfully! Welcome back.');
                    this.hideSignInModal();
                    // Re-check status and proceed
                    setTimeout(() => {
                        this.checkCurrentStatus();
                    }, 500);
                } else {
                    errorDiv.textContent = 'No active subscription found for this email';
                    errorDiv.classList.add('active');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Sign In';
                }
            } else {
                errorDiv.textContent = result.error || 'Failed to sign in. Please try again.';
                errorDiv.classList.add('active');
                submitBtn.disabled = false;
                submitBtn.textContent = 'Sign In';
            }
        } catch (error) {
            console.error('Sign-in error:', error);
            errorDiv.textContent = 'An error occurred. Please try again.';
            errorDiv.classList.add('active');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Sign In';
        }
    }
}

// Handle subscription webhook callbacks (now using Supabase)
class SubscriptionWebhookHandler {
    constructor() {
        this.setupWebhookHandlers();
    }

    setupWebhookHandlers() {
        // Handle successful payment
        ipcRenderer.on('subscription-activated', (event, data) => {
            this.handlePaymentSuccess(data);
        });

        // Handle failed payment
        ipcRenderer.on('subscription-payment-failed', (event, data) => {
            this.handlePaymentFailed(data);
        });

        // Handle subscription cancellation
        ipcRenderer.on('subscription-cancelled', (event, data) => {
            this.handleSubscriptionCancelled(data);
        });
    }

    handlePaymentSuccess(data) {
        console.log('Payment successful:', data);
        
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
    new SubscriptionWebhookHandler();
});
