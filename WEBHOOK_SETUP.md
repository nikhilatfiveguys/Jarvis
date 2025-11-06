# 🔗 Webhook Setup Guide for Jarvis 5.0

## 📋 What You Need

To configure webhooks, you need the following information from Polar:

### 1. **Webhook Secret** (Required)
- Location: Polar Dashboard → Settings → Webhooks
- This is a secret key used to verify webhook requests are from Polar
- Format: Usually a long random string

### 2. **Public Webhook URL** (Required)
- **Problem**: Your webhook handler runs on `localhost:3002`, but Polar needs a public URL
- **Solution Options**:
  - **Option A (Development)**: Use ngrok to create a public tunnel
  - **Option B (Production)**: Deploy to a server with a public domain

## 🚀 Setup Instructions

### Step 1: Get Your Webhook Secret from Polar

1. Go to [Polar Dashboard](https://polar.sh/dashboard)
2. Navigate to **Settings** → **Webhooks**
3. If you don't have a webhook yet, create one (see Step 3)
4. Copy the **Webhook Secret** (it will be shown when you create/edit a webhook)

### Step 2: Set Up Public URL

#### **Option A: Development (Using ngrok)**

1. **Install ngrok**:
   ```bash
   # macOS
   brew install ngrok
   
   # Or download from https://ngrok.com/download
   ```

2. **Start your Jarvis app** (webhook handler runs on port 3002)

3. **Create public tunnel**:
   ```bash
   ngrok http 3002
   ```

4. **Copy the HTTPS URL** (e.g., `https://abc123.ngrok.io`)

5. **Your webhook URL will be**: `https://abc123.ngrok.io/webhook`

#### **Option B: Production (Deploy to Server)**

1. Deploy your app to a server (Heroku, Railway, Render, etc.)
2. Ensure port 3002 is accessible
3. Your webhook URL will be: `https://yourdomain.com/webhook`

### Step 3: Configure Webhook in Polar Dashboard

1. Go to [Polar Dashboard](https://polar.sh/dashboard)
2. Navigate to **Settings** → **Webhooks**
3. Click **"Create Webhook"** or edit existing webhook
4. Set:
   - **URL**: Your public webhook URL (from Step 2)
     - Development: `https://abc123.ngrok.io/webhook`
     - Production: `https://yourdomain.com/webhook`
   - **Events to listen to**:
     - ✅ `checkout.completed`
     - ✅ `subscription.created`
     - ✅ `subscription.updated`
     - ✅ `subscription.canceled`
     - ✅ `payment.succeeded`
     - ✅ `payment.failed`
5. **Save** the webhook
6. **Copy the Webhook Secret** (shown after saving)

### Step 4: Configure Webhook Secret in Jarvis

#### **Method 1: Environment Variable (Recommended)**

Create or update your `.env` file:

```bash
POLAR_WEBHOOK_SECRET=your_webhook_secret_here
POLAR_WEBHOOK_URL=https://your-public-url.com/webhook
```

#### **Method 2: Production Config**

Edit `config/production-config.js`:

```javascript
polar: {
    // ... other config ...
    webhookSecret: 'your_webhook_secret_here',
    webhookUrl: 'https://your-public-url.com/webhook'
}
```

### Step 5: Restart Your App

After configuring the webhook secret, restart your Jarvis app:

```bash
npm start
```

You should see:
```
Polar webhook handler running on port 3002
```

## ✅ Testing the Webhook

### Test Webhook Delivery

1. In Polar Dashboard → Webhooks, click on your webhook
2. Click **"Send Test Event"**
3. Check your app logs - you should see:
   ```
   Received webhook event: checkout.completed
   Webhook processed successfully
   ```

### Test with Real Subscription

1. Create a test subscription through your app
2. Check logs for webhook events
3. Verify subscription status updates automatically

## 🔍 Troubleshooting

### Webhook Not Receiving Events

1. **Check webhook URL is accessible**:
   ```bash
   curl https://your-webhook-url.com/webhook
   ```
   Should return 404 (not 404 is fine, means server is reachable)

2. **Check webhook secret matches**:
   - Verify `POLAR_WEBHOOK_SECRET` matches Polar dashboard
   - Check logs for "Invalid webhook signature" errors

3. **Check Polar Dashboard**:
   - Go to Webhooks → Your webhook → Events
   - See if events are being sent and if they're failing

4. **Check app logs**:
   - Look for "Polar webhook handler running on port 3002"
   - Look for "Received webhook event" messages

### Webhook Secret Not Found Error

- Make sure `POLAR_WEBHOOK_SECRET` is set in `.env` or `production-config.js`
- Restart the app after adding the secret

### ngrok URL Changes

- ngrok free tier gives you a new URL each time
- Update the webhook URL in Polar dashboard when ngrok restarts
- Or use ngrok's static domain (paid feature)

## 📝 Current Webhook Events Handled

Your webhook handler processes these events:

- `checkout.completed` - When payment is successful
- `subscription.created` - When subscription is created
- `subscription.updated` - When subscription is updated
- `subscription.canceled` - When subscription is canceled
- `payment.succeeded` - When payment succeeds
- `payment.failed` - When payment fails

## 🎯 Summary

**What you need to provide:**

1. ✅ **Webhook Secret** from Polar Dashboard
2. ✅ **Public Webhook URL** (ngrok for dev, real domain for production)

**What I've fixed:**

1. ✅ Added webhook secret to config system
2. ✅ Fixed webhook signature verification
3. ✅ Webhook handler is already running on port 3002
4. ✅ All webhook events are properly handled

**Next steps:**

1. Get webhook secret from Polar
2. Set up public URL (ngrok or deploy)
3. Configure webhook in Polar dashboard
4. Add webhook secret to your config
5. Test!


