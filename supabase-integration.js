const { createClient } = require('@supabase/supabase-js');

class SupabaseIntegration {
    constructor(secureConfig) {
        this.secureConfig = secureConfig;
        this.mainApp = null;
        
        // Initialize Supabase client
        try {
            const supabaseConfig = secureConfig.getSupabaseConfig();
            if (supabaseConfig && supabaseConfig.url && supabaseConfig.anonKey) {
                this.supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey);
                console.log('✅ Supabase client initialized');
            } else {
                console.error('❌ Supabase config missing - URL or anon key not found');
                this.supabase = null;
            }
        } catch (error) {
            console.error('❌ Error initializing Supabase client:', error);
            this.supabase = null;
        }
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
            // #region agent log
            const fs = require('fs');
            const logPath = 'e:\\Jarvis-windowsOS\\.cursor\\debug.log';
            try {
                fs.appendFileSync(logPath, JSON.stringify({location:'supabase-integration.js:180',message:'checkSubscriptionByEmail called',data:{email,emailLength:email?.length,hasAtSymbol:email?.includes('@'),hasSupabaseClient:!!this.supabase},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})+'\n');
            } catch(e) {}
            // #endregion
            
            // Check if Supabase client is initialized
            if (!this.supabase) {
                // Try to initialize it now
                try {
                    const supabaseConfig = this.secureConfig.getSupabaseConfig();
                    if (supabaseConfig && supabaseConfig.url && supabaseConfig.anonKey) {
                        this.supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey);
                        console.log('✅ Supabase client initialized (lazy init)');
                    } else {
                        console.error('❌ Cannot initialize Supabase - config missing');
                        return { 
                            hasSubscription: false, 
                            error: 'Supabase client not initialized',
                            isError: true
                        };
                    }
                } catch (error) {
                    console.error('❌ Error initializing Supabase client:', error);
                    return { 
                        hasSubscription: false, 
                        error: error.message,
                        isError: true
                    };
                }
            }
            
            console.log('Checking subscription for email:', email);
            
            const { data, error } = await this.supabase
                .from('subscriptions')
                .select('*')
                .eq('email', email)
                .in('status', ['active', 'trialing'])
                .order('created_at', { ascending: false })
                .limit(1)
                .single();
            
            // #region agent log
            try {
                fs.appendFileSync(logPath, JSON.stringify({location:'supabase-integration.js:169',message:'Supabase query completed',data:{hasData:!!data,hasError:!!error,errorCode:error?.code,errorMessage:error?.message,dataStatus:data?.status,dataEmail:data?.email,dataCurrentPeriodEnd:data?.current_period_end},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})+'\n');
            } catch(e) {}
            // #endregion

            // PGRST116 = no rows returned (not an error, just no subscription)
            if (error && error.code !== 'PGRST116') {
                // #region agent log
                try {
                    fs.appendFileSync(logPath, JSON.stringify({location:'supabase-integration.js:172',message:'Supabase query error (not PGRST116)',data:{errorCode:error.code,errorMessage:error.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})+'\n');
                } catch(e) {}
                // #endregion
                console.error('Supabase query error:', error.code, error.message);
                // Don't throw - return error info so caller can decide
                return { 
                    hasSubscription: false, 
                    error: error.message,
                    isError: true // Flag to indicate this is an error, not "no subscription"
                };
            }

            if (data) {
                // #region agent log
                try {
                    fs.appendFileSync(logPath, JSON.stringify({location:'supabase-integration.js:182',message:'Subscription data found',data:{subscriptionId:data.id,email:data.email,status:data.status,currentPeriodEnd:data.current_period_end,hasCurrentPeriodEnd:!!data.current_period_end},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})+'\n');
                } catch(e) {}
                // #endregion
                // Check if current_period_end exists and is valid
                if (!data.current_period_end) {
                    // #region agent log
                    try {
                        fs.appendFileSync(logPath, JSON.stringify({location:'supabase-integration.js:185',message:'Subscription found but current_period_end is null',data:{subscriptionId:data.id,status:data.status},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})+'\n');
                    } catch(e) {}
                    // #endregion
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
                
                // #region agent log
                try {
                    fs.appendFileSync(logPath, JSON.stringify({location:'supabase-integration.js:201',message:'Checking subscription expiration',data:{currentPeriodEnd:data.current_period_end,parsedDate:currentPeriodEnd.toISOString(),now:now.toISOString(),isValidDate:!isNaN(currentPeriodEnd.getTime())},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})+'\n');
                } catch(e) {}
                // #endregion
                
                // Validate date parsing
                if (isNaN(currentPeriodEnd.getTime())) {
                    // #region agent log
                    try {
                        fs.appendFileSync(logPath, JSON.stringify({location:'supabase-integration.js:206',message:'Invalid current_period_end date',data:{currentPeriodEnd:data.current_period_end},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})+'\n');
                    } catch(e) {}
                    // #endregion
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
                
                // #region agent log
                try {
                    fs.appendFileSync(logPath, JSON.stringify({location:'supabase-integration.js:222',message:'Subscription expiration check result',data:{isExpired,currentPeriodEnd:currentPeriodEnd.toISOString(),now:now.toISOString(),timeDifference:currentPeriodEnd.getTime()-now.getTime()},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})+'\n');
                } catch(e) {}
                // #endregion
                
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
            // #region agent log
            try {
                fs.appendFileSync(logPath, JSON.stringify({location:'supabase-integration.js:245',message:'No subscription found',data:{email,errorCode:error?.code,errorMessage:error?.message},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})+'\n');
            } catch(e) {}
            // #endregion
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
        const os = require('os');
        
        // Use cross-platform user data directory
        // On macOS: ~/Library/Application Support/Jarvis 6.0
        // On Windows: %APPDATA%\Jarvis 6.0 (C:\Users\Username\AppData\Roaming\Jarvis 6.0)
        // On Linux: ~/.config/Jarvis 6.0
        const platform = os.platform();
        const homeDir = os.homedir();
        let userDataPath;
        
        if (platform === 'darwin') {
            userDataPath = path.join(homeDir, 'Library', 'Application Support', 'Jarvis 6.0');
        } else if (platform === 'win32') {
            userDataPath = path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'Jarvis 6.0');
        } else {
            userDataPath = path.join(homeDir, '.config', 'Jarvis 6.0');
        }
        
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
     * Set password for a user
     * Uses SHA-256 hash (via crypto-js) for password storage
     */
    async setPassword(email, password) {
        try {
            console.log('🔐 Setting password for:', email);
            
            if (!password || password.length < 6) {
                return {
                    success: false,
                    error: 'Password must be at least 6 characters'
                };
            }

            // Hash the password using SHA-256
            const CryptoJS = require('crypto-js');
            const passwordHash = CryptoJS.SHA256(password).toString();

            const { data, error } = await this.supabase
                .from('subscriptions')
                .update({
                    password_hash: passwordHash,
                    updated_at: new Date().toISOString()
                })
                .eq('email', email)
                .select()
                .single();

            if (error) {
                throw error;
            }

            console.log('✅ Password set for:', email);
            return {
                success: true
            };
        } catch (error) {
            console.error('❌ Error setting password:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Verify password for a user
     */
    async verifyPassword(email, password) {
        try {
            console.log('🔐 Verifying password for:', email);

            const { data, error } = await this.supabase
                .from('subscriptions')
                .select('password_hash')
                .eq('email', email)
                .single();

            if (error) {
                throw error;
            }

            if (!data || !data.password_hash) {
                return {
                    success: false,
                    error: 'No password set for this account'
                };
            }

            // Hash the provided password and compare
            const CryptoJS = require('crypto-js');
            const providedHash = CryptoJS.SHA256(password).toString();

            if (providedHash === data.password_hash) {
                console.log('✅ Password verified for:', email);
                return {
                    success: true
                };
            } else {
                console.log('❌ Password incorrect for:', email);
                return {
                    success: false,
                    error: 'Incorrect password'
                };
            }
        } catch (error) {
            console.error('❌ Error verifying password:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Check if user has a password set
     */
    async hasPassword(email) {
        try {
            const { data, error } = await this.supabase
                .from('subscriptions')
                .select('password_hash')
                .eq('email', email)
                .single();

            if (error && error.code !== 'PGRST116') {
                throw error;
            }

            return {
                success: true,
                hasPassword: !!(data && data.password_hash)
            };
        } catch (error) {
            console.error('❌ Error checking password:', error);
            return {
                success: false,
                hasPassword: false,
                error: error.message
            };
        }
    }

    /**
     * Generate a password reset token and store it
     */
    async generatePasswordResetToken(email) {
        try {
            console.log('🔐 Generating password reset token for:', email);

            // First check if the email exists and has an active subscription
            const { data: user, error: userError } = await this.supabase
                .from('subscriptions')
                .select('id, email')
                .eq('email', email)
                .single();

            if (userError && userError.code !== 'PGRST116') {
                throw userError;
            }

            if (!user) {
                return {
                    success: false,
                    error: 'No account found with this email'
                };
            }

            // Generate a 6-digit code
            const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
            
            // Set expiration to 15 minutes from now
            const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

            // Store the reset token
            const { error: updateError } = await this.supabase
                .from('subscriptions')
                .update({
                    reset_token: resetCode,
                    reset_token_expires: expiresAt,
                    updated_at: new Date().toISOString()
                })
                .eq('email', email);

            if (updateError) {
                throw updateError;
            }

            console.log('✅ Password reset token generated for:', email);
            return {
                success: true,
                resetCode: resetCode
            };
        } catch (error) {
            console.error('❌ Error generating reset token:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Verify password reset token
     */
    async verifyPasswordResetToken(email, token) {
        try {
            console.log('🔐 Verifying password reset token for:', email);

            const { data, error } = await this.supabase
                .from('subscriptions')
                .select('reset_token, reset_token_expires')
                .eq('email', email)
                .single();

            if (error) {
                throw error;
            }

            if (!data || !data.reset_token) {
                return {
                    success: false,
                    error: 'No reset code found. Please request a new one.'
                };
            }

            // Check if token has expired
            const expiresAt = new Date(data.reset_token_expires);
            if (expiresAt < new Date()) {
                return {
                    success: false,
                    error: 'Reset code has expired. Please request a new one.'
                };
            }

            // Check if token matches
            if (data.reset_token !== token) {
                return {
                    success: false,
                    error: 'Invalid reset code'
                };
            }

            console.log('✅ Password reset token verified for:', email);
            return {
                success: true
            };
        } catch (error) {
            console.error('❌ Error verifying reset token:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Reset password using token
     */
    async resetPasswordWithToken(email, token, newPassword) {
        try {
            // First verify the token
            const verifyResult = await this.verifyPasswordResetToken(email, token);
            if (!verifyResult.success) {
                return verifyResult;
            }

            // Hash the new password
            const CryptoJS = require('crypto-js');
            const passwordHash = CryptoJS.SHA256(newPassword).toString();

            // Update password and clear reset token
            const { error } = await this.supabase
                .from('subscriptions')
                .update({
                    password_hash: passwordHash,
                    reset_token: null,
                    reset_token_expires: null,
                    updated_at: new Date().toISOString()
                })
                .eq('email', email);

            if (error) {
                throw error;
            }

            console.log('✅ Password reset successfully for:', email);
            return {
                success: true
            };
        } catch (error) {
            console.error('❌ Error resetting password:', error);
            return {
                success: false,
                error: error.message
            };
        }
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

    // ============================================
    // COST-BASED USAGE TRACKING & LIMITING
    // ============================================

    // Pricing per 1K tokens (in cents) - Updated Dec 2024
    // Based on: GPT-5.2 ($1.75/1M in, $14/1M out), Claude Opus 4.5 ($5/1M in, $25/1M out), Gemini ($2/1M in, $12/1M out)
    // Format: { input: cents per 1K input tokens, output: cents per 1K output tokens }
    MODEL_PRICING = {
        // ============ CLAUDE MODELS - Use Claude Opus 4.5 pricing ($5/1M in, $25/1M out) ============
        'claude': { input: 0.5, output: 2.5 },
        'claude-3-opus': { input: 0.5, output: 2.5 },
        'claude-3-opus-20240229': { input: 0.5, output: 2.5 },
        'claude-3-sonnet': { input: 0.5, output: 2.5 },
        'claude-3-5-sonnet': { input: 0.5, output: 2.5 },
        'claude-3-5-sonnet-20241022': { input: 0.5, output: 2.5 },
        'claude-sonnet-4-5-20250929': { input: 0.5, output: 2.5 },
        'claude-opus-4-5': { input: 0.5, output: 2.5 },
        'claude-3-haiku': { input: 0.5, output: 2.5 },
        'anthropic/claude-sonnet-4.5': { input: 0.5, output: 2.5 },
        'anthropic/claude-opus-4.5': { input: 0.5, output: 2.5 },
        'anthropic/claude-3-opus': { input: 0.5, output: 2.5 },
        'anthropic/claude-3-sonnet': { input: 0.5, output: 2.5 },
        'anthropic/claude-3-haiku': { input: 0.5, output: 2.5 },
        
        // ============ GEMINI MODELS - Use Gemini pricing ($2/1M in, $12/1M out) ============
        'gemini': { input: 0.2, output: 1.2 },
        'gemini-pro': { input: 0.2, output: 1.2 },
        'gemini-2.5-pro': { input: 0.2, output: 1.2 },
        'gemini-1.5-pro': { input: 0.2, output: 1.2 },
        'gemini-1.5-flash': { input: 0.2, output: 1.2 },
        'google/gemini-pro': { input: 0.2, output: 1.2 },
        'google/gemini-2.5-pro': { input: 0.2, output: 1.2 },
        'google/gemini-1.5-pro': { input: 0.2, output: 1.2 },
        'google/gemini-flash': { input: 0.2, output: 1.2 },
        
        // ============ ALL OTHER MODELS - Use GPT-5.2 pricing ($1.75/1M in, $14/1M out) ============
        // OpenAI models
        'gpt-5.2': { input: 0.175, output: 1.4 },
        'gpt-5': { input: 0.175, output: 1.4 },
        'gpt-4': { input: 0.175, output: 1.4 },
        'gpt-4-turbo': { input: 0.175, output: 1.4 },
        'gpt-4-turbo-preview': { input: 0.175, output: 1.4 },
        'gpt-4o': { input: 0.175, output: 1.4 },
        'gpt-4o-mini': { input: 0.175, output: 1.4 },
        'gpt-3.5-turbo': { input: 0.175, output: 1.4 },
        'o1-preview': { input: 0.175, output: 1.4 },
        'o1-mini': { input: 0.175, output: 1.4 },
        'openai/gpt-4o': { input: 0.175, output: 1.4 },
        'openai/gpt-4o-mini': { input: 0.175, output: 1.4 },
        'openai/gpt-4': { input: 0.175, output: 1.4 },
        'openai/o1-preview': { input: 0.175, output: 1.4 },
        
        // Perplexity models - use GPT-5.2 pricing
        'llama-3.1-sonar-small-128k-online': { input: 0.175, output: 1.4 },
        'llama-3.1-sonar-large-128k-online': { input: 0.175, output: 1.4 },
        'llama-3.1-sonar-huge-128k-online': { input: 0.175, output: 1.4 },
        'perplexity': { input: 0.175, output: 1.4 },
        
        // Other OpenRouter models - use GPT-5.2 pricing
        'meta-llama/llama-3.1-70b-instruct': { input: 0.175, output: 1.4 },
        'mistral': { input: 0.175, output: 1.4 },
        'mixtral': { input: 0.175, output: 1.4 },
        
        // Default fallback - use GPT-5.2 pricing
        'default': { input: 0.175, output: 1.4 }
    };

    /**
     * Calculate cost in cents for a given usage
     * Pricing: Claude ($5/1M in, $25/1M out), Gemini ($2/1M in, $12/1M out), Default/GPT ($1.75/1M in, $14/1M out)
     */
    calculateCost(tokensInput, tokensOutput, model) {
        // Get pricing for model, fallback to default
        let pricing = this.MODEL_PRICING[model];
        
        // Try partial match if exact match not found
        if (!pricing) {
            const modelLower = (model || '').toLowerCase();
            
            // Check for Claude models first (use Claude Opus 4.5 pricing)
            if (modelLower.includes('claude') || modelLower.includes('anthropic')) {
                pricing = { input: 0.5, output: 2.5 };  // $5/1M in, $25/1M out
            }
            // Check for Gemini models (use Gemini pricing)
            else if (modelLower.includes('gemini') || modelLower.includes('google')) {
                pricing = { input: 0.2, output: 1.2 };  // $2/1M in, $12/1M out
            }
            // Everything else uses GPT-5.2 pricing (default)
            else {
                pricing = this.MODEL_PRICING['default'];  // $1.75/1M in, $14/1M out
            }
        }
        
        if (!pricing) {
            pricing = this.MODEL_PRICING['default'];
        }
        
        // Calculate cost: (tokens / 1000) * price per 1K tokens (pricing is in cents per 1K)
        const inputCost = (tokensInput / 1000) * pricing.input;
        const outputCost = (tokensOutput / 1000) * pricing.output;
        const totalCostCents = inputCost + outputCost;
        
        // Return cost in cents, minimum 1 cent per request
        return Math.max(1, Math.round(totalCostCents));
    }

    /**
     * Record usage with cost for a user
     * @param {string} email - User email
     * @param {number} tokensInput - Input tokens
     * @param {number} tokensOutput - Output tokens
     * @param {string} model - Model name
     * @param {string} provider - Provider name (openai, openrouter, etc.)
     * @param {string} requestType - Type of request (chat, web_search, etc.)
     * @param {number|null} apiProvidedCost - Cost in dollars if provided by API (optional)
     */
    async recordUsage(email, tokensInput, tokensOutput, model = 'gpt-4', provider = 'openai', requestType = 'chat', apiProvidedCost = null) {
        try {
            const tokensTotal = (tokensInput || 0) + (tokensOutput || 0);
            
            // Use API-provided cost if available (convert from dollars to cents), otherwise calculate
            let costCents;
            if (apiProvidedCost !== null && apiProvidedCost !== undefined) {
                costCents = Math.round(apiProvidedCost * 100); // Convert dollars to cents
                console.log(`💰 Using API-provided cost: $${apiProvidedCost} (${costCents} cents)`);
            } else {
                costCents = this.calculateCost(tokensInput || 0, tokensOutput || 0, model);
                console.log(`💰 Calculated cost: $${(costCents / 100).toFixed(4)} (${costCents} cents)`);
            }
            
            console.log(`💰 Recording usage for ${email}: ${tokensTotal} tokens, $${(costCents / 100).toFixed(4)} (${model})`);
            
            const { data, error } = await this.supabase
                .from('usage_tracking')
                .insert({
                    email: email,
                    tokens_input: tokensInput || 0,
                    tokens_output: tokensOutput || 0,
                    tokens_total: tokensTotal,
                    cost_cents: costCents,
                    model: model,
                    provider: provider,
                    request_type: requestType
                })
                .select()
                .single();

            if (error) {
                console.error('❌ Error recording usage:', error);
                return { success: false, error: error.message };
            }

            console.log(`✅ Usage recorded: $${(costCents / 100).toFixed(4)} (ID: ${data.id})`);
            return { success: true, usage: data, costCents: costCents };
        } catch (error) {
            console.error('❌ Error recording usage:', error);
            return { success: false, error: error.message };
        }
    }

    // Alias for backward compatibility
    async recordTokenUsage(email, tokensInput, tokensOutput, model = 'gpt-4', provider = 'openai', requestType = 'chat', apiProvidedCost = null) {
        return this.recordUsage(email, tokensInput, tokensOutput, model, provider, requestType, apiProvidedCost);
    }

    /**
     * Check if user is within their cost limits
     */
    async checkUserLimits(email) {
        try {
            console.log(`🔍 Checking cost limits for ${email}`);
            
            // First check if user is blocked or has limits set
            const { data: subscription, error: subError } = await this.supabase
                .from('subscriptions')
                .select('cost_limit_cents, is_blocked, block_reason, status')
                .eq('email', email)
                .single();

            if (subError && subError.code !== 'PGRST116') {
                throw subError;
            }

            // No subscription found - allow (free tier handled elsewhere)
            if (!subscription) {
                return { allowed: true, reason: 'No subscription found' };
            }

            // Check if blocked by admin
            if (subscription.is_blocked) {
                return { 
                    allowed: false, 
                    reason: subscription.block_reason || 'Account blocked by admin',
                    isBlocked: true
                };
            }

            // Check subscription status
            if (subscription.status !== 'active' && subscription.status !== 'trialing') {
                return { allowed: false, reason: 'Subscription not active' };
            }

            // If no limit set (NULL), allow unlimited
            if (subscription.cost_limit_cents === null || subscription.cost_limit_cents === undefined) {
                return { allowed: true, reason: 'Unlimited', costUsedCents: 0, costLimitCents: null };
            }

            // Get monthly cost
            const usage = await this.getMonthlyCost(email);
            
            if (usage.totalCostCents >= subscription.cost_limit_cents) {
                return { 
                    allowed: false, 
                    reason: `Monthly spending limit of $${(subscription.cost_limit_cents / 100).toFixed(2)} reached`,
                    costUsedCents: usage.totalCostCents,
                    costUsedDollars: (usage.totalCostCents / 100).toFixed(2),
                    costLimitCents: subscription.cost_limit_cents,
                    costLimitDollars: (subscription.cost_limit_cents / 100).toFixed(2),
                    isBlocked: false // Not admin blocked, just limit reached
                };
            }

            return { 
                allowed: true, 
                reason: 'OK',
                costUsedCents: usage.totalCostCents,
                costUsedDollars: (usage.totalCostCents / 100).toFixed(2),
                costLimitCents: subscription.cost_limit_cents,
                costLimitDollars: (subscription.cost_limit_cents / 100).toFixed(2),
                costRemainingCents: subscription.cost_limit_cents - usage.totalCostCents,
                costRemainingDollars: ((subscription.cost_limit_cents - usage.totalCostCents) / 100).toFixed(2)
            };
        } catch (error) {
            console.error('❌ Error checking user limits:', error);
            // On error, allow the request (fail open)
            return { allowed: true, reason: 'Error checking limits', error: error.message };
        }
    }

    /**
     * Get monthly cost usage for a user
     */
    async getMonthlyCost(email) {
        try {
            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);

            const { data, error } = await this.supabase
                .from('usage_tracking')
                .select('tokens_input, tokens_output, tokens_total, cost_cents')
                .eq('email', email)
                .gte('created_at', startOfMonth.toISOString());

            if (error) {
                throw error;
            }

            const totalCostCents = data.reduce((sum, row) => sum + (row.cost_cents || 0), 0);
            const totalTokens = data.reduce((sum, row) => sum + (row.tokens_total || 0), 0);
            const totalInput = data.reduce((sum, row) => sum + (row.tokens_input || 0), 0);
            const totalOutput = data.reduce((sum, row) => sum + (row.tokens_output || 0), 0);
            const requestCount = data.length;

            return {
                totalCostCents,
                totalCostDollars: (totalCostCents / 100).toFixed(2),
                totalTokens,
                totalInput,
                totalOutput,
                requestCount,
                periodStart: startOfMonth.toISOString()
            };
        } catch (error) {
            console.error('❌ Error getting monthly cost:', error);
            return { totalCostCents: 0, totalCostDollars: '0.00', totalTokens: 0, totalInput: 0, totalOutput: 0, requestCount: 0, error: error.message };
        }
    }

    // Alias for backward compatibility
    async getMonthlyUsage(email) {
        return this.getMonthlyCost(email);
    }

    /**
     * Get detailed usage history for a user
     */
    async getUsageHistory(email, days = 30) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days);

            const { data, error } = await this.supabase
                .from('usage_tracking')
                .select('*')
                .eq('email', email)
                .gte('created_at', startDate.toISOString())
                .order('created_at', { ascending: false })
                .limit(1000);

            if (error) {
                throw error;
            }

            return { success: true, history: data };
        } catch (error) {
            console.error('❌ Error getting usage history:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get all users' usage summary (admin function)
     */
    async getAllUsersUsage() {
        try {
            console.log('📊 Getting all users usage summary');
            
            const startOfMonth = new Date();
            startOfMonth.setDate(1);
            startOfMonth.setHours(0, 0, 0, 0);

            // Get all subscriptions with their usage
            const { data: subscriptions, error: subError } = await this.supabase
                .from('subscriptions')
                .select('email, status, token_limit, is_blocked, block_reason, current_period_end, created_at');

            if (subError) {
                throw subError;
            }

            // Get usage for each user
            const usersWithUsage = await Promise.all(subscriptions.map(async (sub) => {
                const usage = await this.getMonthlyUsage(sub.email);
                return {
                    email: sub.email,
                    status: sub.status,
                    tokenLimit: sub.token_limit,
                    isBlocked: sub.is_blocked,
                    blockReason: sub.block_reason,
                    tokensUsedThisMonth: usage.totalTokens,
                    requestsThisMonth: usage.requestCount,
                    subscriptionEnd: sub.current_period_end,
                    createdAt: sub.created_at
                };
            }));

            // Sort by usage (highest first)
            usersWithUsage.sort((a, b) => b.tokensUsedThisMonth - a.tokensUsedThisMonth);

            return { success: true, users: usersWithUsage };
        } catch (error) {
            console.error('❌ Error getting all users usage:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Set token limit for a user (admin function)
     */
    async setUserTokenLimit(email, tokenLimit) {
        try {
            console.log(`🔧 Setting token limit for ${email}: ${tokenLimit === null ? 'unlimited' : tokenLimit}`);
            
            const { data, error } = await this.supabase
                .from('subscriptions')
                .update({
                    token_limit: tokenLimit,
                    updated_at: new Date().toISOString()
                })
                .eq('email', email)
                .select()
                .single();

            if (error) {
                throw error;
            }

            console.log('✅ Token limit updated for:', email);
            return { success: true, subscription: data };
        } catch (error) {
            console.error('❌ Error setting token limit:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Block or unblock a user (admin function)
     */
    async setUserBlocked(email, isBlocked, reason = null) {
        try {
            console.log(`🔧 ${isBlocked ? 'Blocking' : 'Unblocking'} user: ${email}`);
            
            const { data, error } = await this.supabase
                .from('subscriptions')
                .update({
                    is_blocked: isBlocked,
                    block_reason: isBlocked ? reason : null,
                    updated_at: new Date().toISOString()
                })
                .eq('email', email)
                .select()
                .single();

            if (error) {
                throw error;
            }

            console.log(`✅ User ${isBlocked ? 'blocked' : 'unblocked'}:`, email);
            return { success: true, subscription: data };
        } catch (error) {
            console.error('❌ Error blocking/unblocking user:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Set default token limit for all new users (updates existing unlimited users too)
     */
    async setDefaultTokenLimit(tokenLimit) {
        try {
            console.log(`🔧 Setting default token limit: ${tokenLimit === null ? 'unlimited' : tokenLimit}`);
            
            // Update all users that currently have no limit
            const { data, error } = await this.supabase
                .from('subscriptions')
                .update({
                    token_limit: tokenLimit,
                    updated_at: new Date().toISOString()
                })
                .is('token_limit', null)
                .select();

            if (error) {
                throw error;
            }

            console.log(`✅ Updated ${data.length} users with default limit`);
            return { success: true, updatedCount: data.length };
        } catch (error) {
            console.error('❌ Error setting default token limit:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = SupabaseIntegration;

