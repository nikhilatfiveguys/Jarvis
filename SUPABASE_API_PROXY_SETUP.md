# Supabase API Proxy Setup Guide

This guide shows you how to set up a secure backend proxy using Supabase Edge Functions. This keeps your API keys safe and allows you to push your Electron app code to GitHub without exposing secrets.

## 🎯 What This Does

Instead of storing API keys in your Electron app (which gets pushed to GitHub), you'll:
1. Store API keys securely in Supabase Secrets
2. Create an Edge Function that proxies API calls
3. Update your Electron app to call the Edge Function instead of APIs directly

## ✅ Benefits

- 🔒 **API keys never in GitHub** - Safe to push your code publicly
- 🔐 **Keys stored securely** - Encrypted in Supabase Secrets
- 🚀 **Easy to deploy** - One command to deploy the Edge Function
- 💰 **Free tier available** - 500K invocations/month free
- 🔄 **Easy to update** - Change keys without rebuilding the app

## 📋 Prerequisites

- Supabase account (you already have one)
- Supabase CLI installed: `npm install -g supabase`

## 🚀 Step 1: Deploy the Edge Function

1. **Login to Supabase CLI:**
   ```bash
   supabase login
   ```

2. **Link your project:**
   ```bash
   supabase link --project-ref nbmnbgouiammxpkbyaxj
   ```

3. **Deploy the Edge Function:**
   ```bash
   supabase functions deploy jarvis-api-proxy
   ```

## 🔐 Step 2: Store API Keys in Supabase Secrets

After deploying, set your API keys as secrets:

```bash
# Set OpenAI API key
supabase secrets set OPENAI_API_KEY=sk-your-actual-key-here

# Set Perplexity API key
supabase secrets set PPLX_API_KEY=pplx-your-actual-key-here

# Set Claude API key (optional)
supabase secrets set CLAUDE_API_KEY=sk-ant-your-actual-key-here
```

**Important:** These secrets are encrypted and only accessible to your Edge Functions. They're never exposed in your code or GitHub.

## 🧪 Step 3: Test the Edge Function

Test that it works:

```bash
curl -X POST https://nbmnbgouiammxpkbyaxj.supabase.co/functions/v1/jarvis-api-proxy \
  -H "Authorization: Bearer YOUR_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai",
    "endpoint": "responses",
    "payload": {
      "model": "gpt-5-mini",
      "instructions": "Say hello",
      "input": [{"role": "user", "content": "Hello"}]
    }
  }'
```

## 📱 Step 4: Update Your Electron App

The Edge Function is already created at:
```
supabase/functions/jarvis-api-proxy/index.ts
```

After deploying, your app will automatically use the Edge Function URL from your config. The URL is:
```
https://nbmnbgouiammxpkbyaxj.supabase.co/functions/v1/jarvis-api-proxy
```

## 🔄 How It Works

```
┌──────────────┐         ┌──────────────────────┐         ┌─────────────┐
│ Electron App  │────────▶│ Supabase Edge Function│────────▶│   OpenAI    │
│ (GitHub ✅)   │  No     │ (Your API Keys 🔐)   │  Has    │   API       │
│ No Keys      │  Keys   │ Stored in Secrets    │  Keys   │             │
└──────────────┘         └──────────────────────┘         └─────────────┘
```

1. Your Electron app calls the Edge Function (no API keys needed)
2. Edge Function reads API keys from Supabase Secrets
3. Edge Function makes the API call with your keys
4. Response is returned to your app

## 🔒 Security Notes

- ✅ API keys are stored encrypted in Supabase Secrets
- ✅ Edge Function requires authentication (uses your Supabase anon key)
- ✅ Keys never appear in your code or GitHub
- ✅ You can rotate keys anytime without rebuilding the app

## 📝 Updating API Keys

To update an API key:

```bash
supabase secrets set OPENAI_API_KEY=sk-new-key-here
```

The change takes effect immediately - no redeployment needed!

## 🐛 Troubleshooting

**Function not found?**
- Make sure you deployed: `supabase functions deploy jarvis-api-proxy`

**401 Unauthorized?**
- Check that you're sending the Supabase anon key in the Authorization header

**API errors?**
- Verify your API keys are set: `supabase secrets list`
- Check Edge Function logs: `supabase functions logs jarvis-api-proxy`

## 🎉 Next Steps

1. Deploy the Edge Function
2. Set your API keys as secrets
3. Test the function
4. Push your Electron app code to GitHub (no keys needed!)

Your API keys are now secure and your code is safe to share publicly! 🚀

