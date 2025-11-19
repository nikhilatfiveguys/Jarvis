# Webhook Setup Explanation

## How Webhooks Work

### ❌ **NOT This** (Common Misconception):
```
Polar → Webhook → Supabase (direct connection)
```

### ✅ **Actually This**:
```
Polar → Webhook → Your App → Supabase
```

## The Flow

1. **Polar sends webhook** → To your app's webhook endpoint
2. **Your app receives webhook** → Processes the event
3. **Your app syncs to Supabase** → Updates the database

## Where to Configure the Webhook

### In Polar Dashboard:
- Go to **Settings** → **Webhooks**
- Add webhook URL: `https://your-app-url.com/webhook`
- This URL points to **YOUR APP**, not Supabase

### Your App's Webhook Endpoint:
- Your app runs a webhook server on **port 3002**
- Endpoint: `/webhook`
- When Polar sends events, your app receives them here
- Your app then syncs the data to Supabase

## Visual Flow

```
┌─────────────┐
│   Polar     │  User subscribes/cancels
└──────┬──────┘
       │
       │ Sends webhook event
       │ (POST request)
       │
       ▼
┌─────────────────┐
│  Your App       │  Receives webhook
│  (port 3002)    │  on /webhook endpoint
│  /webhook       │
└──────┬──────────┘
       │
       │ Processes event
       │ (polar-integration.js)
       │
       │ Calls supabaseIntegration
       │
       ▼
┌─────────────┐
│  Supabase   │  Subscription data
│  Database   │  stored/updated here
└─────────────┘
```

## What You Need to Do

### Step 1: Make Your App Accessible
Your app needs to be accessible from the internet so Polar can send webhooks:

**Option A: Local Development (ngrok)**
```bash
# Terminal 1: Start your app
npm start

# Terminal 2: Expose port 3002
ngrok http 3002
# Copy the HTTPS URL (e.g., https://abc123.ngrok.io)
```

**Option B: Production (Deploy to Server)**
- Deploy your app to a server (Heroku, AWS, DigitalOcean, etc.)
- Your webhook URL will be: `https://your-domain.com/webhook`

### Step 2: Configure in Polar Dashboard
1. Go to https://polar.sh/dashboard
2. Navigate to **Settings** → **Webhooks**
3. Click **"Add Webhook"**
4. Enter URL:
   - Local: `https://your-ngrok-url.ngrok.io/webhook`
   - Production: `https://your-domain.com/webhook`
5. Select events:
   - `checkout.completed`
   - `subscription.created`
   - `subscription.updated`
   - `subscription.canceled`
6. Save

### Step 3: Your App Handles It
Your app already has the code to:
- Receive webhooks (polar-webhook-handler.js)
- Process events (polar-integration.js)
- Sync to Supabase (supabase-integration.js)

**You don't need to configure anything in Supabase** - your app handles it!

## Important Points

✅ **Webhook URL points to YOUR APP** (not Supabase)
✅ **Your app receives the webhook** (on port 3002)
✅ **Your app syncs to Supabase** (automatically)
✅ **Supabase doesn't need webhook configuration** (your app handles it)

## Testing

1. Start your app: `npm start`
2. Check logs: Should see "Polar webhook handler running on port 3002"
3. Configure webhook in Polar dashboard
4. Create a test subscription in Polar
5. Check your app logs: Should see webhook received and synced to Supabase
6. Check Supabase: Subscription should appear in the `subscriptions` table

## Summary

- **Polar** → Sends webhook to your app
- **Your App** → Receives webhook and syncs to Supabase
- **Supabase** → Just stores the data (no webhook config needed)

You configure the webhook URL in **Polar dashboard**, pointing to **your app**, not Supabase!


