# Configuration Guide for Jarvis 5.0

## What You Need to Configure

You need credentials from **both Supabase and Polar**:

### 1. Supabase Credentials (for storing subscriptions)

**Get these from Supabase:**
1. Go to your Supabase project dashboard
2. Click **Settings** → **API**
3. Copy:
   - **Project URL** (e.g., `https://xxxxx.supabase.co`)
   - **anon/public key** (starts with `eyJ...`)
   - **service_role key** (starts with `eyJ...` - **KEEP THIS SECRET!**)

### 2. Polar Credentials (for payment processing)

**Get these from Polar:**
1. Go to https://polar.sh/dashboard
2. Click **Settings** → **API Keys**
3. Copy:
   - **Access Token** (starts with `polar_oat_`)
4. Go to **Products** in Polar dashboard
5. Copy your **Product ID** (starts with `prod_`)

## Update Your Configuration

Edit `config/production-config.js`:

```javascript
const PRODUCTION_CONFIG = {
    supabase: {
        url: 'https://your-project-id.supabase.co',           // Your Supabase Project URL
        anonKey: 'your-anon-key-here',                        // Your Supabase anon/public key
        serviceRoleKey: 'your-service-role-key-here',         // Your Supabase service_role key (SECRET!)
        checkoutUrl: 'https://polar.sh'                       // Polar checkout URL
    },
    polar: {
        accessToken: 'polar_oat_your_actual_token_here',      // Your Polar Access Token
        successUrl: 'http://localhost:3001/success?checkout_id={CHECKOUT_ID}',  // Where to redirect after payment
        productId: 'prod_your_actual_product_id_here'        // Your Polar Product ID
    },
    // ... rest of your config
};
```

## How It Works

1. **User clicks "Subscribe"** → Polar handles the checkout/payment
2. **Payment succeeds** → Polar subscription is created
3. **Webhook/API call** → Subscription data is stored in Supabase
4. **App checks subscription** → Queries Supabase (not Polar directly)
5. **User gets premium access** → Based on Supabase data

## Environment Variables (Alternative)

Instead of hardcoding, you can use environment variables:

```bash
# Supabase
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Polar
POLAR_ACCESS_TOKEN=polar_oat_your_token
POLAR_PRODUCT_ID=prod_your_product_id
POLAR_SUCCESS_URL=http://localhost:3001/success?checkout_id={CHECKOUT_ID}
```

Then the config will automatically use these environment variables.

## Testing

After configuring:

1. **Test Supabase connection:**
   - The app should be able to query the `subscriptions` table
   - Check Supabase logs to see if queries are working

2. **Test Polar checkout:**
   - Click "Subscribe" in the app
   - Should open Polar checkout page
   - After payment, subscription should appear in Supabase

3. **Test subscription check:**
   - Enter an email with an active subscription
   - App should show premium status

## Troubleshooting

**"Supabase configuration not found" error:**
- Make sure you've added Supabase credentials to `config/production-config.js`
- Check that `url` and `anonKey` are not empty

**"Polar configuration not found" error:**
- Make sure you've added Polar `accessToken` to the config
- Verify your Polar access token is valid

**Subscriptions not appearing in Supabase:**
- Check if Polar webhooks are set up correctly
- Verify the webhook handler is calling `supabaseIntegration.createOrUpdateSubscription()`
- Check Supabase logs for errors


