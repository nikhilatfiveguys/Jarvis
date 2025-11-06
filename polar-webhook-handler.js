const http = require('http');
const crypto = require('crypto');

class PolarWebhookHandler {
    constructor(secureConfig, polarIntegration = null, mainApp = null) {
        this.secureConfig = secureConfig;
        this.polarIntegration = polarIntegration;
        this.mainApp = mainApp;
        this.server = null;
        this.port = 3002; // Different port from success handler
    }

    /**
     * Start the webhook handler server
     */
    start() {
        this.server = http.createServer((req, res) => {
            // Handle both /webhook and /webhook/polar paths for compatibility
            if (req.method === 'POST' && (req.url === '/webhook' || req.url === '/webhook/polar')) {
                this.handleWebhook(req, res);
            } else {
                res.writeHead(404);
                res.end('Not Found');
            }
        });

        this.server.listen(this.port, () => {
            console.log(`Polar webhook handler running on port ${this.port}`);
        });
    }

    /**
     * Handle incoming webhook
     */
    async handleWebhook(req, res) {
        let body = '';
        
        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            try {
                // Verify webhook signature
                const signature = req.headers['polar-signature'];
                if (!signature) {
                    console.error('Missing Polar signature');
                    res.writeHead(400);
                    res.end('Missing signature');
                    return;
                }

                // Verify signature
                if (!this.polarIntegration.verifyWebhookSignature(body, signature)) {
                    console.error('Invalid webhook signature');
                    res.writeHead(401);
                    res.end('Invalid signature');
                    return;
                }

                // Parse webhook event
                const event = JSON.parse(body);
                console.log('Received webhook event:', event.type);

                // Process the event
                const result = await this.polarIntegration.processWebhookEvent(event);
                
                if (result.success) {
                    console.log('Webhook processed successfully');
                    res.writeHead(200);
                    res.end('OK');
                } else {
                    console.error('Error processing webhook:', result.error);
                    res.writeHead(500);
                    res.end('Error processing webhook');
                }
            } catch (error) {
                console.error('Error handling webhook:', error);
                res.writeHead(500);
                res.end('Internal server error');
            }
        });
    }

    /**
     * Stop the server
     */
    stop() {
        if (this.server) {
            this.server.close();
            console.log('Polar webhook handler stopped');
        }
    }
}

module.exports = PolarWebhookHandler;
