const { Polar } = require('@polar-sh/sdk');

class PolarIntegration {
    constructor(secureConfig) {
        this.secureConfig = secureConfig;
        this.mainApp = null;
        const polarConfig = this.secureConfig.getPolarConfig();
        
        if (!polarConfig || !polarConfig.accessToken) {
            throw new Error('Polar configuration not found. Please check your config.');
        }
        
        this.polar = new Polar({
            accessToken: polarConfig.accessToken
        });
    }

    /**
     * Set reference to main app instance for webhook notifications
     */
    setMainAppInstance(mainApp) {
        this.mainApp = mainApp;
    }

    /**
     * Create a checkout session using Polar's official SDK
     */
    async createCheckoutSession(productId, customerEmail = null) {
        try {
            console.log('Creating Polar checkout session...', { productId, customerEmail: customerEmail || 'not provided (user will enter during checkout)' });
            
            const polarConfig = this.secureConfig.getPolarConfig();
            
            // Build checkout data - email is optional, user can enter it on checkout page
            const checkoutData = {
                products: [productId],
                successUrl: polarConfig.successUrl
            };
            
            // Only add email if provided (Polar allows checkout without pre-filled email)
            if (customerEmail) {
                checkoutData.customerEmail = customerEmail;
                checkoutData.metadata = {
                    app: 'jarvis-6.0',
                    user_email: customerEmail
                };
            } else {
                checkoutData.metadata = {
                    app: 'jarvis-5.0'
                };
            }

            const checkout = await this.polar.checkouts.create(checkoutData);
            
            console.log('✅ Checkout session created:', checkout.id);
            return {
                success: true,
                checkoutUrl: checkout.url,
                checkoutId: checkout.id
            };
        } catch (error) {
            console.error('❌ Error creating checkout session:', error);
            // Provide a more helpful error message
            let errorMessage = error.message;
            if (error.message && error.message.includes('customerEmail')) {
                errorMessage = 'Please enter your email address on the checkout page to continue.';
            }
            return {
                success: false,
                error: errorMessage
            };
        }
    }

    /**
     * Get the first available product for checkout
     */
    async getFirstProduct() {
        try {
            console.log('Fetching products from Polar...');
            
            const products = await this.polar.products.list({
                organizationId: config.polar.organizationId,
                limit: 1
            });

            if (products.items && products.items.length > 0) {
                const product = products.items[0];
                console.log('Found product:', product.name);
                return {
                    success: true,
                    product: product
                };
            } else {
                throw new Error('No products found in Polar organization');
            }
        } catch (error) {
            console.error('Error fetching products:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get customer by email
     */
    async getCustomerByEmail(email) {
        try {
            console.log('Looking up customer by email:', email);
            
            const customers = await this.polar.customers.list({
                email: email,
                limit: 1
            });

            if (customers.items && customers.items.length > 0) {
                const customer = customers.items[0];
                console.log('Found customer:', customer.id);
                return customer; // Return the customer object directly
            } else {
                console.log('Customer not found');
                return null;
            }
        } catch (error) {
            console.error('Error looking up customer:', error);
            // Don't return null on API errors - let the caller handle it
            throw error;
        }
    }

    /**
     * Get subscription status for a customer
     */
    async getSubscriptionStatus(customerId) {
        try {
            console.log('Checking subscription status for customer:', customerId);
            
            const subscriptions = await this.polar.subscriptions.list({
                customerId: customerId,
                limit: 1
            });

            if (subscriptions.items && subscriptions.items.length > 0) {
                const subscription = subscriptions.items[0];
                return {
                    success: true,
                    hasActiveSubscription: subscription.status === 'active',
                    subscription: subscription
                };
            } else {
                return {
                    success: true,
                    hasActiveSubscription: false
                };
            }
        } catch (error) {
            console.error('Error checking subscription status:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Get subscription status by customer ID (for validation)
     */
    async getSubscriptionStatusByCustomerId(customerId) {
        try {
            console.log(`Checking subscription status for customer ID: ${customerId}`);
            
            // Get subscriptions for this customer
            const subscriptions = await this.polar.subscriptions.list({
                customerId: customerId,
                limit: 1
            });

            console.log(`Found ${subscriptions.items?.length || 0} subscriptions for customer`);
            
            // Check if any subscription is active
            const hasActiveSubscription = subscriptions.items?.some(sub => 
                sub.status === 'active' || sub.status === 'trialing'
            ) || false;

            console.log(`Customer has active subscription: ${hasActiveSubscription}`);
            return hasActiveSubscription;

        } catch (error) {
            console.error('Error checking subscription status by customer ID:', error);
            // Don't return false on API errors - let the caller handle it
            throw error;
        }
    }

    /**
     * Handle successful checkout completion
     */
    async handleCheckoutSuccess(checkoutId, customerEmail = null) {
        try {
            console.log('Processing successful checkout:', checkoutId);
            
            // Only store subscription data if we have a real customer email
            if (!customerEmail) {
                console.log('⚠️ No customer email provided - not storing subscription data');
                return {
                    success: false,
                    error: 'No customer email provided'
                };
            }

            // Prepare subscription data (but don't store here - let mainApp handle it)
            const subscriptionData = {
                email: customerEmail, // Use actual customer email from checkout
                nextBilling: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days from now
                features: ['unlimited_messages', 'screenshot_analysis', 'voice_activation'],
                status: 'active',
                subscriptionId: checkoutId,
                checkoutId: checkoutId,
                createdAt: new Date().toISOString()
            };

            // Note: Don't store here - polar-success-handler will use mainApp.storeSubscriptionData()
            // which uses the correct Electron app.getPath('userData') path
            
            console.log('✅ Checkout completed successfully:', checkoutId);
            console.log('✅ Subscription data prepared:', subscriptionData);
            
            return {
                success: true,
                checkoutId: checkoutId,
                subscriptionData: subscriptionData,
                message: 'Payment processed successfully'
            };
        } catch (error) {
            console.error('Error processing checkout success:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Store subscription data locally
     */
    async storeSubscriptionData(subscriptionData) {
        const fs = require('fs');
        const path = require('path');
        
        // Use user's data directory instead of app bundle directory
        const userDataPath = path.join(process.env.HOME || process.env.USERPROFILE, 'Library', 'Application Support', 'Jarvis 6.0');
        
        // Ensure the directory exists
        if (!fs.existsSync(userDataPath)) {
            fs.mkdirSync(userDataPath, { recursive: true });
        }
        
        const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
        
        try {
            fs.writeFileSync(subscriptionFile, JSON.stringify(subscriptionData, null, 2));
            console.log('✅ Subscription data saved to:', subscriptionFile);
        } catch (error) {
            console.error('❌ Error saving subscription data:', error);
        }
    }

    /**
     * Get customer email from checkout ID
     */
    async getCustomerEmailFromCheckout(checkoutId) {
        try {
            console.log('Getting customer email for checkout:', checkoutId);
            
            // Get checkout details from Polar API
            const checkout = await this.polar.checkouts.get({ id: checkoutId });
            console.log('Checkout details:', checkout);
            
            // Extract customer email from checkout
            if (checkout && checkout.customerEmail) {
                return checkout.customerEmail;
            }
            
            console.log('No customer email found in checkout');
            return null;
        } catch (error) {
            console.error('Error getting customer email from checkout:', error);
            return null;
        }
    }

    /**
     * Verify checkout was actually completed and paid
     * Returns { isPaid: boolean, checkout: object, error: string }
     */
    async verifyCheckoutPayment(checkoutId) {
        try {
            console.log('Verifying checkout payment status:', checkoutId);
            
            // Get checkout details from Polar API
            const checkout = await this.polar.checkouts.get({ id: checkoutId });
            console.log('Checkout status:', checkout.status, 'Checkout:', JSON.stringify(checkout, null, 2));
            
            // Check if checkout is completed/paid
            // Polar checkout statuses: 'open', 'complete', 'completed', 'succeeded', 'expired', 'canceled'
            // Also check for payment status if available
            const status = checkout.status?.toLowerCase() || '';
            const isPaid = status === 'complete' || status === 'completed' || status === 'succeeded';
            
            // Additional check: verify payment was actually made
            // Check if there's a payment or order associated
            const hasPayment = !!(checkout.payment_id || checkout.order_id || checkout.subscription_id);
            
            if (!isPaid) {
                console.warn('⚠️ Checkout not paid - status:', checkout.status);
                console.warn('⚠️ Full checkout object:', JSON.stringify(checkout, null, 2));
                return {
                    isPaid: false,
                    checkout: checkout,
                    error: `Checkout status is "${checkout.status}", not completed`
                };
            }
            
            // Double-check: if status is complete but no payment/subscription, be suspicious
            if (isPaid && !hasPayment) {
                console.warn('⚠️ Checkout marked complete but no payment/subscription found');
                console.warn('⚠️ This might be a test checkout or incomplete payment');
                // Still allow it, but log warning - webhook might create subscription later
            }
            
            // Also verify that a subscription was created from this checkout
            // Check if checkout has a subscription_id or order_id
            let subscriptionId = checkout.subscription_id || checkout.order_id;
            
            // If no subscription_id on checkout, try to find subscription via customer
            if (!subscriptionId && checkout.customer_id) {
                try {
                    console.log('No subscription_id on checkout, checking customer subscriptions...');
                    const subscriptions = await this.polar.subscriptions.list({
                        customerId: checkout.customer_id,
                        limit: 1
                    });
                    
                    if (subscriptions.items && subscriptions.items.length > 0) {
                        const sub = subscriptions.items[0];
                        if (sub.status === 'active' || sub.status === 'trialing') {
                            subscriptionId = sub.id;
                            console.log('✅ Found active subscription for customer:', subscriptionId);
                        }
                    }
                } catch (error) {
                    console.warn('Could not verify subscription via customer:', error.message);
                    // Continue anyway - webhook might create it later
                }
            }
            
            if (!subscriptionId) {
                console.warn('⚠️ Checkout completed but no subscription/order found');
                // Still allow if status is complete - subscription might be created via webhook
                // But log a warning
            }
            
            console.log('✅ Checkout verified as paid');
            return {
                isPaid: true,
                checkout: checkout,
                subscriptionId: subscriptionId,
                orderId: checkout.order_id
            };
        } catch (error) {
            console.error('❌ Error verifying checkout payment:', error);
            return {
                isPaid: false,
                checkout: null,
                error: error.message
            };
        }
    }

    /**
     * Verify webhook signature
     */
    verifyWebhookSignature(payload, signature) {
        try {
            const crypto = require('crypto');
            const expectedSignature = crypto
                .createHmac('sha256', config.polar.webhookSecret)
                .update(payload)
                .digest('hex');
            
            return signature === expectedSignature;
        } catch (error) {
            console.error('Error verifying webhook signature:', error);
            return false;
        }
    }

    /**
     * Process webhook event
     */
    async processWebhookEvent(event) {
        try {
            console.log('Processing webhook event:', event.type);
            
            switch (event.type) {
                case 'checkout.completed':
                    return await this.handleCheckoutCompleted(event.data);
                case 'subscription.created':
                    return await this.handleSubscriptionCreated(event.data);
                case 'subscription.updated':
                    return await this.handleSubscriptionUpdated(event.data);
                case 'subscription.canceled':
                    return await this.handleSubscriptionCanceled(event.data);
                default:
                    console.log('Unhandled webhook event type:', event.type);
                    return { success: true };
            }
        } catch (error) {
            console.error('Error processing webhook event:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Handle checkout completed webhook
     */
    async handleCheckoutCompleted(data) {
        console.log('Checkout completed:', data.id);
        
        // Try to get customer email from checkout
        let customerEmail = null;
        try {
            customerEmail = await this.getCustomerEmailFromCheckout(data.id);
        } catch (error) {
            console.error('Error getting customer email from checkout:', error);
        }
        
        // Prepare subscription data
        const subscriptionData = {
            email: customerEmail || 'unknown@example.com', // Will be updated if we can get email
            checkoutId: data.id,
            customerId: data.customerId,
            productId: data.productId,
            status: 'active',
            nextBilling: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            features: ['unlimited_messages', 'screenshot_analysis', 'voice_activation'],
            createdAt: new Date().toISOString()
        };
        
        // Store in Supabase via mainApp's supabaseIntegration
        if (this.mainApp && this.mainApp.supabaseIntegration) {
            try {
                const supabaseData = {
                    email: customerEmail || subscriptionData.email,
                    status: 'active',
                    polar_subscription_id: data.subscriptionId || data.id,
                    polar_customer_id: data.customerId,
                    current_period_start: new Date().toISOString(),
                    current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
                };
                
                const result = await this.mainApp.supabaseIntegration.createOrUpdateSubscription(supabaseData);
                if (result.success) {
                    console.log('✅ Subscription synced to Supabase:', result.subscription.id);
                } else {
                    console.error('❌ Failed to sync to Supabase:', result.error);
                }
            } catch (error) {
                console.error('❌ Error syncing to Supabase:', error);
            }
        }
        
        // Store via mainApp if available (uses correct Electron path)
        if (this.mainApp && this.mainApp.storeSubscriptionData) {
            await this.mainApp.storeSubscriptionData(subscriptionData);
            console.log('✅ Webhook subscription data stored locally');
        } else {
            // Fallback: use direct file write (shouldn't happen in normal flow)
            console.warn('⚠️ mainApp not available, using fallback storage');
            const fs = require('fs');
            const path = require('path');
            const { app } = require('electron');
            const userDataPath = app ? app.getPath('userData') : 
                path.join(process.env.HOME || process.env.USERPROFILE, 'Library', 'Application Support', 'jarvis-6.0');
            
            if (!fs.existsSync(userDataPath)) {
                fs.mkdirSync(userDataPath, { recursive: true });
            }
            
            const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
            fs.writeFileSync(subscriptionFile, JSON.stringify(subscriptionData, null, 2));
        }
        
        return { success: true };
    }

    /**
     * Handle subscription created webhook
     */
    async handleSubscriptionCreated(data) {
        console.log('Subscription created:', data.id);
        
        // Sync to Supabase
        if (this.mainApp && this.mainApp.supabaseIntegration) {
            try {
                const subscriptionData = {
                    email: data.customer?.email || data.metadata?.email,
                    status: data.status === 'active' || data.status === 'trialing' ? 'active' : data.status,
                    polar_subscription_id: data.id,
                    polar_customer_id: data.customer?.id || data.customerId,
                    current_period_start: data.current_period_start ? new Date(data.current_period_start * 1000).toISOString() : new Date().toISOString(),
                    current_period_end: data.current_period_end ? new Date(data.current_period_end * 1000).toISOString() : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
                };
                
                const result = await this.mainApp.supabaseIntegration.createOrUpdateSubscription(subscriptionData);
                if (result.success) {
                    console.log('✅ Subscription created synced to Supabase');
                }
            } catch (error) {
                console.error('❌ Error syncing subscription created to Supabase:', error);
            }
        }
        
        return { success: true };
    }

    /**
     * Handle subscription updated webhook
     */
    async handleSubscriptionUpdated(data) {
        console.log('Subscription updated:', data.id);
        
        // Sync to Supabase
        if (this.mainApp && this.mainApp.supabaseIntegration) {
            try {
                const subscriptionData = {
                    email: data.customer?.email || data.metadata?.email,
                    status: data.status === 'active' || data.status === 'trialing' ? 'active' : data.status,
                    polar_subscription_id: data.id,
                    polar_customer_id: data.customer?.id || data.customerId,
                    current_period_start: data.current_period_start ? new Date(data.current_period_start * 1000).toISOString() : new Date().toISOString(),
                    current_period_end: data.current_period_end ? new Date(data.current_period_end * 1000).toISOString() : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
                };
                
                const result = await this.mainApp.supabaseIntegration.createOrUpdateSubscription(subscriptionData);
                if (result.success) {
                    console.log('✅ Subscription updated synced to Supabase');
                }
            } catch (error) {
                console.error('❌ Error syncing subscription updated to Supabase:', error);
            }
        }
        
        return { success: true };
    }

    /**
     * Handle subscription canceled webhook
     */
    async handleSubscriptionCanceled(data) {
        console.log('⚠️ Subscription canceled via webhook:', data.id);
        
        // Sync cancellation to Supabase
        if (this.mainApp && this.mainApp.supabaseIntegration) {
            try {
                const email = data.customer?.email || data.metadata?.email;
                if (email) {
                    const result = await this.mainApp.supabaseIntegration.cancelSubscription(email);
                    if (result.success) {
                        console.log('✅ Subscription cancellation synced to Supabase');
                    }
                }
            } catch (error) {
                console.error('❌ Error syncing cancellation to Supabase:', error);
            }
        }
        
        // Remove subscription data using correct Electron path
        const fs = require('fs');
        const path = require('path');
        
        // Use Electron's app.getPath if available, otherwise fallback
        let userDataPath;
        try {
            const { app } = require('electron');
            userDataPath = app ? app.getPath('userData') : 
                path.join(process.env.HOME || process.env.USERPROFILE, 'Library', 'Application Support', 'jarvis-6.0');
        } catch (error) {
            // Fallback if Electron not available
            userDataPath = path.join(process.env.HOME || process.env.USERPROFILE, 'Library', 'Application Support', 'jarvis-5.0');
        }
        
        const subscriptionFile = path.join(userDataPath, 'subscription_status.json');
        
        if (fs.existsSync(subscriptionFile)) {
            fs.unlinkSync(subscriptionFile);
            console.log('✅ Subscription file removed from:', subscriptionFile);
            
            // Notify main app about cancellation
            if (this.mainApp) {
                if (this.mainApp.mainWindow && !this.mainApp.mainWindow.isDestroyed()) {
                    this.mainApp.mainWindow.webContents.send('subscription-cancelled');
                }
                
                // Show paywall if main window is visible
                if (this.mainApp.mainWindow && !this.mainApp.mainWindow.isDestroyed()) {
                    this.mainApp.mainWindow.webContents.send('show-paywall');
                }
                
                // Also notify any open account windows to refresh
                if (this.mainApp.accountWindow && !this.mainApp.accountWindow.isDestroyed()) {
                    this.mainApp.accountWindow.webContents.send('subscription-status-changed', { status: 'free' });
                }
            }
        } else {
            console.log('⚠️ Subscription file not found at:', subscriptionFile);
        }
        
        return { success: true };
    }
}

module.exports = PolarIntegration;
