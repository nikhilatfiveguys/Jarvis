# Webhook URL Setup Guide

## Your Webhook Endpoint

Your app's webhook endpoint is:
- **Path**: `/webhook`
- **Port**: `3002`
- **Full URL format**: `http://your-host:3002/webhook` (or `https://` for production)

## Option 1: Local Development (Using ngrok)

### Step 1: Install ngrok
```bash
# Option A: Using Homebrew (Mac)
brew install ngrok

# Option B: Download from https://ngrok.com/download
# Then add to your PATH
```

### Step 2: Start Your App
```bash
npm start
```

You should see:
```
Polar webhook handler running on port 3002
```

### Step 3: Expose Port 3002 with ngrok
In a **new terminal window**, run:
```bash
ngrok http 3002
```

You'll see output like:
```
Forwarding  https://abc123xyz.ngrok.io -> http://localhost:3002
```

### Step 4: Copy the HTTPS URL
Copy the **HTTPS URL** (the one starting with `https://`)

**Your webhook URL will be:**
```
https://abc123xyz.ngrok.io/webhook
```

⚠️ **Important**: 
- Use the **HTTPS** URL (not HTTP)
- Add `/webhook` at the end
- The URL changes every time you restart ngrok (unless you have a paid plan)

### Step 5: Add to Polar Dashboard
1. Go to https://polar.sh/dashboard
2. Settings → Webhooks
3. Add Webhook
4. URL: `https://your-ngrok-url.ngrok.io/webhook`
5. Select events and save

## Option 2: Production (Deployed Server)

If you've deployed your app to a server:

### Your Webhook URL:
```
https://your-domain.com/webhook
```

**Examples:**
- If deployed to Heroku: `https://your-app.herokuapp.com/webhook`
- If you have a custom domain: `https://jarvis.yourdomain.com/webhook`
- If using a VPS: `https://your-server-ip.com/webhook` (with SSL)

### Requirements:
- ✅ Your app must be accessible from the internet
- ✅ Must use HTTPS (Polar requires HTTPS)
- ✅ Port 3002 must be accessible (or use a reverse proxy)

## Quick Test

### Test if your webhook endpoint is working:

**Using curl:**
```bash
curl -X POST http://localhost:3002/webhook \
  -H "Content-Type: application/json" \
  -d '{"type":"test","data":{}}'
```

If your app is running, you should see a response (even if it's an error about missing signature - that's fine, it means the endpoint is working).

## Current Setup

Based on your code:
- ✅ Webhook handler is already configured
- ✅ Runs on port 3002
- ✅ Endpoint: `/webhook`
- ✅ Automatically starts when you run `npm start`

## What You Need to Do Right Now

### For Local Testing:

1. **Start your app:**
   ```bash
   npm start
   ```

2. **In another terminal, start ngrok:**
   ```bash
   ngrok http 3002
   ```

3. **Copy the HTTPS URL** (e.g., `https://abc123.ngrok.io`)

4. **Add `/webhook` to it:**
   ```
   https://abc123.ngrok.io/webhook
   ```

5. **Add this URL to Polar dashboard:**
   - Go to https://polar.sh/dashboard
   - Settings → Webhooks
   - Add Webhook
   - URL: `https://abc123.ngrok.io/webhook`
   - Events: Select `checkout.completed`, `subscription.created`, `subscription.updated`, `subscription.canceled`
   - Save

## Troubleshooting

### "Connection refused" error in Polar:
- Make sure your app is running (`npm start`)
- Make sure ngrok is running (`ngrok http 3002`)
- Check that you're using the HTTPS URL (not HTTP)

### "404 Not Found" error:
- Make sure you added `/webhook` at the end of the URL
- Check that your app is listening on port 3002

### Webhook not receiving events:
- Check Polar dashboard → Webhooks → Check webhook status/logs
- Check your app logs for "Received webhook event"
- Make sure ngrok is still running (free ngrok URLs expire after 2 hours)

## Summary

**For local development:**
```
https://your-ngrok-url.ngrok.io/webhook
```

**For production:**
```
https://your-domain.com/webhook
```

The key is: **Your app URL + `/webhook`**


