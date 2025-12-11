# Polar Webhook Setup Guide for Supabase Sync

This guide will help you set up Polar webhooks to automatically sync subscriptions to Supabase.

## How It Works

1. **User subscribes** → Polar processes payment
2. **Polar sends webhook** → Your app receives the event
3. **App syncs to Supabase** → Subscription data is stored in Supabase
4. **App checks subscription** → Queries Supabase (fast and reliable)

## Setting Up the Webhook in Polar

### Step 1: Get Your Webhook URL

Your app runs a webhook server on **port 3002** by default. You have two options:

#### Option A: Local Development (using ngrok or similar)

1. Install ngrok: `npm install -g ngrok` or download from [ngrok.com](https://ngrok.com)
2. Start your app: `npm start`
3. In a new terminal, expose port 3002:
   ```bash
   ngrok http 3002
   ```
4. Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)
5. Your webhook URL will be: `https://abc123.ngrok.io/webhook`

#### Option B: Production (deploy to a server)

Deploy your app to a server with a public URL, then your webhook URL will be:
```
https://your-domain.com/webhook
```

### Step 2: Configure Webhook in Polar Dashboard

1. Go to your Polar dashboard: https://polar.sh/dashboard
2. Navigate to **Settings** → **Webhooks**
3. Click **"Add Webhook"** or **"Create Webhook"**
4. Enter your webhook URL:
   - For local: `https://your-ngrok-url.ngrok.io/webhook`
   - For production: `https://your-domain.com/webhook`
5. Select the events you want to listen to:
   - ✅ `checkout.completed` - When a checkout is completed
   - ✅ `subscription.created` - When a subscription is created
   - ✅ `subscription.updated` - When a subscription is updated
   - ✅ `subscription.canceled` - When a subscription is canceled
6. Click **"Save"** or **"Create"**

### Step 3: Get Webhook Secret (Optional but Recommended)

1. In Polar dashboard, after creating the webhook, you'll see a **Webhook Secret**
2. Copy this secret
3. Add it to your `config/production-config.js`:

```javascript
polar: {
    accessToken: 'polar_oat_...',
    successUrl: '...',
    productId: '...',
    webhookSecret: 'your_webhook_secret_here'  // Add this
}
```

Or set as environment variable:
```bash
POLAR_WEBHOOK_SECRET=your_webhook_secret_here
```

## Testing the Webhook

### 1. Start Your App

```bash
npm start
```

You should see:
```
Polar webhook handler running on port 3002
```

### 2. Test with Polar

1. Create a test subscription in Polar dashboard
2. Or use Polar's webhook testing tool (if available)
3. Check your app logs - you should see:
   ```
   Received webhook event: subscription.created
   ✅ Subscription created synced to Supabase
   ```

### 3. Verify in Supabase

1. Go to your Supabase dashboard
2. Navigate to **Table Editor** → **subscriptions**
3. You should see the new subscription record

## Webhook Events Handled

The webhook handler automatically syncs these events to Supabase:

| Event | Action |
|-------|--------|
| `checkout.completed` | Creates subscription in Supabase |
| `subscription.created` | Creates/updates subscription in Supabase |
| `subscription.updated` | Updates subscription status in Supabase |
| `subscription.canceled` | Marks subscription as canceled in Supabase |

## Troubleshooting

### Webhook Not Receiving Events

1. **Check if webhook server is running:**
   - Look for "Polar webhook handler running on port 3002" in logs
   - If not, the webhook handler might not be starting

2. **Check webhook URL:**
   - Make sure the URL in Polar dashboard matches your actual webhook URL
   - For local development, make sure ngrok is running

3. **Check firewall/network:**
   - Make sure port 3002 is accessible
   - For local dev, ngrok should handle this

### Webhook Receiving but Not Syncing to Supabase

1. **Check Supabase credentials:**
   - Verify your Supabase URL and keys in `config/production-config.js`
   - Test Supabase connection manually

2. **Check logs:**
   - Look for error messages like "❌ Error syncing to Supabase"
   - Check Supabase logs in dashboard

3. **Check table permissions:**
   - Make sure RLS policies allow inserts/updates
   - Service role key should bypass RLS

### Signature Verification Failing

1. **Check webhook secret:**
   - Make sure `POLAR_WEBHOOK_SECRET` is set correctly
   - The secret in Polar dashboard must match your config

2. **Check signature header:**
   - Polar should send `polar-signature` header
   - If missing, check Polar webhook settings

## Manual Testing

You can manually test the webhook sync by creating a subscription directly in Supabase:

```sql
INSERT INTO subscriptions (email, status, polar_subscription_id, current_period_end)
VALUES (
    'test@example.com',
    'active',
    'test_sub_123',
    NOW() + INTERVAL '30 days'
);
```

Then check if the app recognizes it:
- Restart the app
- Check subscription status for `test@example.com`
- Should show as premium

## Production Deployment

For production, you'll need:

1. **Deploy your app** to a server (Heroku, AWS, DigitalOcean, etc.)
2. **Set up a public URL** for your webhook endpoint
3. **Update Polar webhook URL** to your production URL
4. **Set environment variables** for all secrets
5. **Enable HTTPS** (required by Polar webhooks)

## Security Notes

- ✅ Webhook signatures are verified automatically
- ✅ Service role key is kept secret (never expose in client code)
- ✅ RLS policies protect your Supabase data
- ⚠️ Always use HTTPS for webhook URLs in production
- ⚠️ Never commit secrets to version control

## Next Steps

After setting up the webhook:

1. ✅ Test with a real subscription
2. ✅ Verify data appears in Supabase
3. ✅ Test subscription cancellation
4. ✅ Monitor webhook logs for any issues

Your subscription system is now fully automated! 🎉


