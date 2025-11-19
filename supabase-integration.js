const { createClient } = require('@supabase/supabase-js');

class SupabaseIntegration {
    constructor(secureConfig) {
        this.secureConfig = secureConfig;
        this.mainApp = null;
        const supabaseConfig = this.secureConfig.getSupabaseConfig();
        
        if (!supabaseConfig || !supabaseConfig.url || !supabaseConfig.anonKey) {
            throw new Error('Supabase configuration not found. Please check your config.');
        }
        
        this.supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey);
        this.serviceRoleKey = supabaseConfig.serviceRoleKey; // For admin operations
    }

    /**
     * Set reference to main app instance for notifications
     */
    setMainAppInstance(mainApp) {
        this.mainApp = mainApp;
    }

    /**
     * Create a checkout session (for Polar integration via Supabase)
     * This uses Polar for payments and stores subscriptions in Supabase
     */
    async createCheckoutSession(productId, customerEmail = null) {
        try {
            console.log('Creating checkout session via Polar...');
            
            // Use Polar integration to create checkout
            // The actual checkout will be handled by Polar, then we'll store the result in Supabase
            const supabaseConfig = this.secureConfig.getSupabaseConfig();
            const polarConfig = this.secureConfig.getPolarConfig();
            
            // For now, return a placeholder URL - you'll integrate with Polar checkout here
            const checkoutUrl = `${polarConfig?.successUrl || 'https://polar.sh'}?product=${productId}&email=${customerEmail || ''}`;
            
            return {
                success: true,
                checkoutUrl: checkoutUrl,
                checkoutId: `checkout_${Date.now()}`
            };
        } catch (error) {
            console.error('Error creating checkout session:', error);
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
            
            const { data, error } = await this.supabase
                .from('subscriptions')
                .select('*')
                .eq('email', email)
                .eq('status', 'active')
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
                throw error;
            }

            if (data) {
                console.log('Found customer subscription:', data.id);
                return [{
                    id: data.id,
                    email: data.email,
                    status: data.status
                }];
            } else {
                console.log('Customer not found');
                return [];
            }
        } catch (error) {
            console.error('Error looking up customer:', error);
            throw error;
        }
    }

    /**
     * Get subscription status for a customer
     */
    async getSubscriptionStatus(customerId) {
        try {
            console.log('Checking subscription status for customer:', customerId);
            
            const { data, error } = await this.supabase
                .from('subscriptions')
                .select('*')
                .eq('id', customerId)
                .eq('status', 'active')
                .single();

            if (error && error.code !== 'PGRST116') {
                throw error;
            }

            if (data) {
                return {
                    success: true,
                    hasActiveSubscription: data.status === 'active',
                    subscription: {
                        id: data.id,
                        status: data.status,
                        email: data.email,
                        currentPeriodEnd: data.current_period_end,
                        currentPeriodStart: data.current_period_start
                    }
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
            
            const { data, error } = await this.supabase
                .from('subscriptions')
                .select('status')
                .eq('id', customerId)
                .in('status', ['active', 'trialing'])
                .single();

            if (error && error.code !== 'PGRST116') {
                throw error;
            }

            const hasActiveSubscription = !!data && (data.status === 'active' || data.status === 'trialing');
            console.log(`Customer has active subscription: ${hasActiveSubscription}`);
            return hasActiveSubscription;
        } catch (error) {
            console.error('Error checking subscription status by customer ID:', error);
            throw error;
        }
    }

    /**
     * Check subscription by email
     */
    async checkSubscriptionByEmail(email) {
        try {
            console.log('Checking subscription for email:', email);
            
            const { data, error } = await this.supabase
                .from('subscriptions')
                .select('*')
                .eq('email', email)
                .in('status', ['active', 'trialing'])
                .order('created_at', { ascending: false })
                .limit(1)
                .single();

            // PGRST116 = no rows returned (not an error, just no subscription)
            if (error && error.code !== 'PGRST116') {
                console.error('Supabase query error:', error.code, error.message);
                // Don't throw - return error info so caller can decide
                return { 
                    hasSubscription: false, 
                    error: error.message,
                    isError: true // Flag to indicate this is an error, not "no subscription"
                };
            }

            if (data) {
                // Check if current_period_end exists and is valid
                if (!data.current_period_end) {
                    console.warn('⚠️ Subscription found but current_period_end is null/undefined - treating as active');
                    return {
                        hasSubscription: true,
                        subscription: {
                            id: data.id,
                            email: data.email,
                            status: data.status,
                            currentPeriodEnd: data.current_period_end,
                            currentPeriodStart: data.current_period_start,
                            polarSubscriptionId: data.polar_subscription_id,
                            polarCustomerId: data.polar_customer_id
                        }
                    };
                }

                // Check if subscription has expired (current_period_end is in the past)
                const currentPeriodEnd = new Date(data.current_period_end);
                const now = new Date();
                
                // Validate date parsing
                if (isNaN(currentPeriodEnd.getTime())) {
                    console.error('⚠️ Invalid current_period_end date:', data.current_period_end);
                    // If date is invalid, treat as active (safer than revoking)
                    return {
                        hasSubscription: true,
                        subscription: {
                            id: data.id,
                            email: data.email,
                            status: data.status,
                            currentPeriodEnd: data.current_period_end,
                            currentPeriodStart: data.current_period_start,
                            polarSubscriptionId: data.polar_subscription_id,
                            polarCustomerId: data.polar_customer_id
                        }
                    };
                }
                
                const isExpired = currentPeriodEnd < now;
                
                if (isExpired) {
                    console.log('❌ Subscription found but expired:', currentPeriodEnd, 'Now:', now);
                    return { hasSubscription: false };
                }
                
                console.log('✅ Active subscription found, expires:', currentPeriodEnd);
                return {
                    hasSubscription: true,
                    subscription: {
                        id: data.id,
                        email: data.email,
                        status: data.status,
                        currentPeriodEnd: data.current_period_end,
                        currentPeriodStart: data.current_period_start,
                        polarSubscriptionId: data.polar_subscription_id,
                        polarCustomerId: data.polar_customer_id
                    }
                };
            }

            // No subscription found (PGRST116 or no data)
            console.log('ℹ️ No active subscription found for email:', email);
            return { hasSubscription: false };
        } catch (error) {
            console.error('❌ Error checking subscription by email:', error);
            // Return error flag so caller knows this is a temporary error
            return { 
                hasSubscription: false, 
                error: error.message,
                isError: true // Flag to indicate this is an error, not "no subscription"
            };
        }
    }

    /**
     * Create or update subscription
     */
    async createOrUpdateSubscription(subscriptionData) {
        try {
            console.log('Creating/updating subscription:', subscriptionData.email);
            
            const { data, error } = await this.supabase
                .from('subscriptions')
                .upsert({
                    email: subscriptionData.email,
                    status: subscriptionData.status || 'active',
                    polar_subscription_id: subscriptionData.polarSubscriptionId || subscriptionData.subscriptionId,
                    polar_customer_id: subscriptionData.polarCustomerId || subscriptionData.customerId,
                    current_period_start: subscriptionData.currentPeriodStart || new Date().toISOString(),
                    current_period_end: subscriptionData.currentPeriodEnd || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                    updated_at: new Date().toISOString()
                }, {
                    onConflict: 'email',
                    ignoreDuplicates: false
                })
                .select()
                .single();

            if (error) {
                throw error;
            }

            console.log('✅ Subscription created/updated:', data.id);
            return {
                success: true,
                subscription: data
            };
        } catch (error) {
            console.error('Error creating/updating subscription:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Cancel subscription
     */
    async cancelSubscription(email) {
        try {
            console.log('Cancelling subscription for:', email);
            
            const { data, error } = await this.supabase
                .from('subscriptions')
                .update({
                    status: 'canceled',
                    updated_at: new Date().toISOString()
                })
                .eq('email', email)
                .select()
                .single();

            if (error) {
                throw error;
            }

            console.log('✅ Subscription canceled:', data.id);
            return {
                success: true,
                subscription: data
            };
        } catch (error) {
            console.error('Error canceling subscription:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Handle successful checkout completion
     */
    async handleCheckoutSuccess(checkoutId, customerEmail = null) {
        try {
            console.log('Processing successful checkout:', checkoutId);
            
            if (!customerEmail) {
                console.log('⚠️ No customer email provided - not storing subscription data');
                return {
                    success: false,
                    error: 'No customer email provided'
                };
            }

            // Create subscription in Supabase
            const subscriptionData = {
                email: customerEmail,
                status: 'active',
                polar_subscription_id: checkoutId,
                current_period_start: new Date().toISOString(),
                current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            };

            const result = await this.createOrUpdateSubscription(subscriptionData);

            if (result.success) {
                return {
                    success: true,
                    checkoutId: checkoutId,
                    subscriptionData: {
                        email: customerEmail,
                        nextBilling: subscriptionData.current_period_end,
                        features: ['unlimited_messages', 'screenshot_analysis', 'voice_activation'],
                        status: 'active',
                        subscriptionId: result.subscription.id,
                        createdAt: new Date().toISOString()
                    },
                    message: 'Payment processed successfully'
                };
            } else {
                return {
                    success: false,
                    error: result.error
                };
            }
        } catch (error) {
            console.error('Error processing checkout success:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Store subscription data locally (for offline access)
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
     * Handle webhook events from Stripe (via your backend)
     * This would typically be called from your backend API that receives Stripe webhooks
     */
    async handleWebhookEvent(eventType, eventData) {
        try {
            console.log('Processing webhook event:', eventType);
            
            switch (eventType) {
                case 'checkout.session.completed':
                    return await this.handleCheckoutCompleted(eventData);
                case 'customer.subscription.created':
                case 'customer.subscription.updated':
                    return await this.handleSubscriptionUpdated(eventData);
                case 'customer.subscription.deleted':
                    return await this.handleSubscriptionCanceled(eventData);
                default:
                    console.log('Unhandled webhook event type:', eventType);
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
        
        const subscriptionData = {
            email: data.customer_email || data.customer_details?.email,
            polar_subscription_id: data.subscription || data.id,
            polar_customer_id: data.customer || data.customer_id,
            status: 'active',
            current_period_start: new Date().toISOString(),
            current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        };
        
        const result = await this.createOrUpdateSubscription(subscriptionData);
        
        if (result.success && this.mainApp && this.mainApp.storeSubscriptionData) {
            await this.mainApp.storeSubscriptionData({
                email: subscriptionData.email,
                nextBilling: subscriptionData.current_period_end,
                features: ['unlimited_messages', 'screenshot_analysis', 'voice_activation'],
                status: 'active',
                subscriptionId: result.subscription.id,
                createdAt: new Date().toISOString()
            });
        }
        
        return { success: true };
    }

    /**
     * Handle subscription updated webhook
     */
    async handleSubscriptionUpdated(data) {
        console.log('Subscription updated:', data.id);
        
        const subscriptionData = {
            email: data.metadata?.email,
            polar_subscription_id: data.id,
            polar_customer_id: data.customer || data.customer_id,
            status: data.status === 'active' || data.status === 'trialing' ? 'active' : data.status,
            current_period_start: new Date(data.current_period_start * 1000).toISOString(),
            current_period_end: new Date(data.current_period_end * 1000).toISOString()
        };
        
        return await this.createOrUpdateSubscription(subscriptionData);
    }

    /**
     * Handle subscription canceled webhook
     */
    async handleSubscriptionCanceled(data) {
        console.log('⚠️ Subscription canceled via webhook:', data.id);
        
        const email = data.metadata?.email;
        if (email) {
            await this.cancelSubscription(email);
        }
        
        // Remove local subscription data
        const fs = require('fs');
        const path = require('path');
        
        let userDataPath;
        try {
            const { app } = require('electron');
            userDataPath = app ? app.getPath('userData') : 
                path.join(process.env.HOME || process.env.USERPROFILE, 'Library', 'Application Support', 'jarvis-6.0');
        } catch (error) {
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
                
                if (this.mainApp.mainWindow && !this.mainApp.mainWindow.isDestroyed()) {
                    this.mainApp.mainWindow.webContents.send('show-paywall');
                }
                
                if (this.mainApp.accountWindow && !this.mainApp.accountWindow.isDestroyed()) {
                    this.mainApp.accountWindow.webContents.send('subscription-status-changed', { status: 'free' });
                }
            }
        }
        
        return { success: true };
    }
}

module.exports = SupabaseIntegration;

