# Polar Payments Setup Guide for Jarvis 5.0

## Prerequisites
1. Create a Polar account at [polar.sh](https://polar.sh)
2. Set up your organization and products in the Polar dashboard

## Configuration Steps

### 1. Get Your Polar Credentials
1. Go to your Polar dashboard
2. Navigate to Settings > API Keys
3. Create a new API key
4. Copy your Organization ID and API Key

### 2. Update Configuration
Edit `polar-config.js` and replace the placeholder values:

```javascript
const POLAR_CONFIG = {
    // ✅ Your actual Polar credentials (already configured!)
    organizationId: 'd6f0145b-067a-4c7b-8e48-7f3c78e8a489',
    apiKey: 'polar_oat_zp36dHm9MzIXn8Aw9k17zGlrVcuzr8ogRCIrJ2QpDa1',
    
    // Product configuration
    product: {
        name: 'Jarvis 5.0 Pro',
        description: 'AI-powered overlay assistant with advanced features',
        price: 5.00, // Monthly price
        currency: 'USD',
        trialDays: 7
    }
};
```

### 3. Create Products in Polar Dashboard
1. Go to Products in your Polar dashboard
2. Create a new product:
   - Name: "Jarvis 5.0 Pro"
   - Price: $5.00/month
   - Description: "AI-powered overlay assistant with advanced features"
   - Billing: Monthly subscription
   - Features: Screenshot analysis, voice commands, app control, cloud sync
3. Copy the Product ID (starts with `prod_`)
4. Enable customer management and subscription tracking

### 4. Update Product ID
Edit `paywall.js` and replace the placeholder product ID:

```javascript
// Replace this line in paywall.js
const productId = 'prod_01JQZQZQZQZQZQZQZQZQZQZQZ'; // Replace with your actual product ID
```

### 5. Set Up Webhooks (Optional)
1. Go to Webhooks in your Polar dashboard
2. Add webhook URL: `https://your-app.com/webhook/polar`
3. Select events: `checkout.session.completed`, `customer.subscription.created`

### 6. Test the Integration
1. Start the app: `npm start`
2. Sign in with Google to link your Gmail account
3. Click "Get" button in the paywall
4. Verify that the Polar checkout page opens with your email pre-filled
5. Complete a test purchase
6. Verify that your subscription is linked to your Gmail account

### 7. Account Linking Features
- **Gmail Integration**: Users sign in with Google, and their purchase is linked to their Gmail account
- **Cross-Device Access**: Users can access Jarvis Pro on any device by signing in with the same Gmail account
- **Automatic License Detection**: The app automatically detects if the user has an active subscription
- **Subscription Management**: Users can manage their subscription through their Polar account

## Troubleshooting

### Common Issues
1. **"No products found"**: Make sure you've created products in your Polar dashboard
2. **API errors**: Verify your organization ID and API key are correct
3. **Checkout not opening**: Check that the `open-external-url` IPC handler is working

### Debug Steps
1. Check the console for error messages
2. Verify your Polar credentials are correct
3. Ensure you have products created in your Polar dashboard
4. Test the API connection by calling `getProducts()`

## Security Notes
- Never commit your actual API keys to version control
- Use environment variables for production deployments
- Regularly rotate your API keys
- Monitor your Polar dashboard for suspicious activity

## Support
- Polar Documentation: https://docs.polar.sh
- Polar Support: support@polar.sh
- Jarvis 5.0 Issues: Create an issue in the repository
