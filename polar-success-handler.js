const http = require('http');
const url = require('url');
const path = require('path');
const fs = require('fs');

class PolarSuccessHandler {
    constructor(polarIntegration, mainApp = null) {
        this.polarIntegration = polarIntegration;
        this.mainApp = mainApp;
        this.server = null;
        this.port = 3001; // Different port from main app
    }

    /**
     * Start the success handler server
     */
    start() {
        this.server = http.createServer((req, res) => {
            const parsedUrl = url.parse(req.url, true);
            const pathname = parsedUrl.pathname;
            const query = parsedUrl.query;

            // Set CORS headers
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') {
                res.writeHead(200);
                res.end();
                return;
            }

            if (pathname === '/success') {
                this.handleSuccess(req, res, query);
            } else if (pathname === '/cancel') {
                this.handleCancel(req, res, query);
            } else {
                res.writeHead(404);
                res.end('Not Found');
            }
        });

        this.server.listen(this.port, () => {
            console.log(`Polar success handler running on port ${this.port}`);
        });
    }

    /**
     * Handle successful checkout
     */
        async handleSuccess(req, res, query) {
            try {
                const checkoutId = query.checkout_id;

                if (!checkoutId) {
                    res.writeHead(400);
                    res.end('Missing checkout_id');
                    return;
                }

                console.log('Processing checkout callback:', checkoutId);

                // CRITICAL: Verify that checkout was actually paid before granting access
                const verification = await this.polarIntegration.verifyCheckoutPayment(checkoutId);
                
                if (!verification.isPaid) {
                    console.error('❌ Checkout not paid - refusing to grant premium access:', verification.error);
                    console.error('❌ Checkout details:', JSON.stringify(verification.checkout, null, 2));
                    const errorPage = this.getErrorPage(`Payment not completed: ${verification.error || 'Checkout status invalid'}`);
                    res.writeHead(400, { 'Content-Type': 'text/html' });
                    res.end(errorPage);
                    return;
                }

                // Additional verification: Check if subscription actually exists in Polar
                // This prevents granting access if checkout is complete but subscription wasn't created
                try {
                    const checkout = verification.checkout;
                    if (checkout.customer_id) {
                        const subscriptions = await this.polarIntegration.polar.subscriptions.list({
                            customerId: checkout.customer_id,
                            limit: 1
                        });
                        
                        const hasActiveSubscription = subscriptions.items?.some(sub => 
                            sub.status === 'active' || sub.status === 'trialing'
                        );
                        
                        if (!hasActiveSubscription) {
                            console.warn('⚠️ Checkout complete but no active subscription found in Polar');
                            console.warn('⚠️ Waiting for webhook to create subscription - not granting access yet');
                            const errorPage = this.getErrorPage('Payment processing. Please wait a moment and refresh, or contact support if this persists.');
                            res.writeHead(202, { 'Content-Type': 'text/html' }); // 202 Accepted - processing
                            res.end(errorPage);
                            return;
                        }
                    }
                } catch (subCheckError) {
                    console.error('❌ Error checking subscription:', subCheckError);
                    // Don't fail completely - webhook might create it
                    console.warn('⚠️ Continuing anyway - subscription might be created via webhook');
                }

                console.log('✅ Checkout verified as paid, proceeding with subscription activation');

                // Get customer email from Polar API using checkout ID
                const customerEmail = await this.polarIntegration.getCustomerEmailFromCheckout(checkoutId);
                console.log('Customer email from Polar API:', customerEmail);

                if (!customerEmail) {
                    console.error('❌ No customer email found for checkout');
                    const errorPage = this.getErrorPage('Could not retrieve customer email. Please contact support.');
                    res.writeHead(400, { 'Content-Type': 'text/html' });
                    res.end(errorPage);
                    return;
                }

                // Process the checkout success (but don't store yet)
                const result = await this.polarIntegration.handleCheckoutSuccess(checkoutId, customerEmail);
            
            if (result.success && result.subscriptionData) {
                // Store subscription data using mainApp's method (uses correct Electron path)
                if (this.mainApp && this.mainApp.storeSubscriptionData) {
                    await this.mainApp.storeSubscriptionData(result.subscriptionData);
                    console.log('✅ Subscription data stored via mainApp');
                }
                
                // Also sync to Supabase immediately (don't wait for webhook)
                if (this.mainApp && this.mainApp.supabaseIntegration && customerEmail) {
                    try {
                        const supabaseData = {
                            email: customerEmail,
                            status: 'active',
                            polar_subscription_id: result.subscriptionData.subscriptionId || checkoutId,
                            polar_customer_id: result.subscriptionData.customerId,
                            current_period_start: new Date().toISOString(),
                            current_period_end: result.subscriptionData.nextBilling ? new Date(result.subscriptionData.nextBilling).toISOString() : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
                        };
                        
                        const supabaseResult = await this.mainApp.supabaseIntegration.createOrUpdateSubscription(supabaseData);
                        if (supabaseResult.success) {
                            console.log('✅ Subscription synced to Supabase immediately after checkout');
                        } else {
                            console.error('❌ Failed to sync to Supabase:', supabaseResult.error);
                        }
                    } catch (error) {
                        console.error('❌ Error syncing to Supabase:', error);
                    }
                }
                
                // Wait a moment for Supabase to be ready, then notify main app
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Notify main app about successful subscription
                if (this.mainApp && this.mainApp.mainWindow) {
                    console.log('📢 Sending subscription-activated event to overlay');
                    this.mainApp.mainWindow.webContents.send('subscription-activated', {
                        email: customerEmail,
                        message: 'Your Jarvis Premium subscription is now active!'
                    });
                }
                
                // Show success page
                const successPage = this.getSuccessPage(customerEmail);
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(successPage);
            } else {
                // Show error page
                const errorPage = this.getErrorPage(result.error);
                res.writeHead(400, { 'Content-Type': 'text/html' });
                res.end(errorPage);
            }
        } catch (error) {
            console.error('Error handling success:', error);
            const errorPage = this.getErrorPage(error.message);
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(errorPage);
        }
    }

    /**
     * Handle cancelled checkout
     */
    handleCancel(req, res, query) {
        console.log('Checkout cancelled');
        
        const cancelPage = this.getCancelPage();
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(cancelPage);
    }

    /**
     * Get success page HTML
     */
    getSuccessPage(customerEmail = null) {
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Successful - Jarvis</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a1a;
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
        }
        .container {
            text-align: center;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(15px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 18px;
            padding: 40px;
            max-width: 400px;
        }
        .success-icon {
            font-size: 48px;
            color: #28a745;
            margin-bottom: 20px;
        }
        h1 {
            color: #ffffff;
            margin-bottom: 10px;
        }
        p {
            color: rgba(255, 255, 255, 0.7);
            margin-bottom: 20px;
        }
        .close-btn {
            background: #007AFF;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="success-icon">✓</div>
        <h1>Payment Successful!</h1>
        <p>Your Jarvis Premium subscription is now active. You can close this window and return to Jarvis.</p>
        ${customerEmail ? `<p style="color: #4CAF50; font-size: 14px;">Subscription activated for: ${customerEmail}</p>` : ''}
        <button class="close-btn" onclick="window.close()">Close Window</button>
    </div>
</body>
</html>`;
    }

    /**
     * Get cancel page HTML
     */
    getCancelPage() {
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Cancelled - Jarvis</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a1a;
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
        }
        .container {
            text-align: center;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(15px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 18px;
            padding: 40px;
            max-width: 400px;
        }
        .cancel-icon {
            font-size: 48px;
            color: #ffc107;
            margin-bottom: 20px;
        }
        h1 {
            color: #ffffff;
            margin-bottom: 10px;
        }
        p {
            color: rgba(255, 255, 255, 0.7);
            margin-bottom: 20px;
        }
        .close-btn {
            background: #007AFF;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="cancel-icon">⚠</div>
        <h1>Payment Cancelled</h1>
        <p>Your payment was cancelled. You can try again anytime from the Jarvis settings.</p>
        <button class="close-btn" onclick="window.close()">Close Window</button>
    </div>
</body>
</html>`;
    }

    /**
     * Get error page HTML
     */
    getErrorPage(error) {
        return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Error - Jarvis</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #1a1a1a;
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
        }
        .container {
            text-align: center;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(15px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 18px;
            padding: 40px;
            max-width: 400px;
        }
        .error-icon {
            font-size: 48px;
            color: #dc3545;
            margin-bottom: 20px;
        }
        h1 {
            color: #ffffff;
            margin-bottom: 10px;
        }
        p {
            color: rgba(255, 255, 255, 0.7);
            margin-bottom: 20px;
        }
        .close-btn {
            background: #007AFF;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="error-icon">✗</div>
        <h1>Payment Error</h1>
        <p>There was an error processing your payment: ${error}</p>
        <button class="close-btn" onclick="window.close()">Close Window</button>
    </div>
</body>
</html>`;
    }

    /**
     * Stop the server
     */
    stop() {
        if (this.server) {
            this.server.close();
            console.log('Polar success handler stopped');
        }
    }
}

module.exports = PolarSuccessHandler;
