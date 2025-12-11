# Fix Perplexity 401 Error - Web Search Not Working

## Problem
When asking for "latest AI news" or any web search query, you get a **401 Unauthorized error**.

## Root Cause
The Perplexity API call is going through the Supabase Edge Function proxy correctly, BUT the `PPLX_API_KEY` is likely **missing or invalid** in Supabase Secrets.

## The Code Is Already Correct ✅
Good news! The app code is **already configured correctly**:
- ✅ Uses Supabase Edge Function proxy
- ✅ Has hardcoded URL and anon key (same as working test script)
- ✅ Has proper error handling
- ✅ Tries IPC first, then direct fetch as fallback

**The issue is on the Supabase side, not in the app code.**

## Quick Fix Steps

### Step 1: Verify Perplexity API Key in Supabase Secrets

1. Go to: https://supabase.com/dashboard/project/nbmnbgouiammxpkbyaxj
2. Click: **Settings** (bottom left) → **Edge Functions**
3. Click: **Secrets** tab
4. Look for: `PPLX_API_KEY`

**Expected value:**
```
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
```

**If missing:**
- Click **Add new secret**
- Name: `PPLX_API_KEY`
- Value: `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`
- Click **Save**

**If present but different:**
- Click the pencil icon to edit
- Update the value
- Click **Save**

### Step 2: Also Add OpenAI Key (For Answer Screen)

While you're there, also verify `OPENAI_API_KEY` is set (for the Answer Screen button to work):
- Name: `OPENAI_API_KEY`
- Value: Your OpenAI API key (starts with `sk-`)

### Step 3: Redeploy Edge Function (CRITICAL!)

After adding/updating secrets, you MUST redeploy:

1. Go to: **Edge Functions** → **jarvis-api-proxy**
2. Click: **Deploy** or **Redeploy** button
3. Wait for deployment to complete (usually 10-30 seconds)

**Why?** Edge Functions don't automatically pick up new secrets until redeployed.

### Step 4: Test Web Search

1. **Restart the Jarvis app** (to ensure fresh state)
2. Open the app with `Option+Space`
3. Type: "What's the latest AI news?"
4. Press Enter
5. Should work now! 🎉

## Verification Commands

### Test Edge Function Directly (Should Work)
```bash
curl -X POST 'https://nbmnbgouiammxpkbyaxj.supabase.co/functions/v1/jarvis-api-proxy' \
  -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibW5iZ291aWFtbXhwa2J5YXhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI1MjEwODcsImV4cCI6MjA3ODA5NzA4N30.ppFaxEFUyBWjwkgdszbvP2HUdXXKjC0Bu-afCQr0YxE' \
  -H 'Content-Type: application/json' \
  -d '{
    "provider": "perplexity",
    "payload": {
      "model": "sonar-pro",
      "messages": [
        {"role": "system", "content": "Be concise"},
        {"role": "user", "content": "What is AI?"}
      ]
    }
  }'
```

**Expected:** JSON response with answer (NOT 401 error)

## Troubleshooting

### Still Getting 401 After Adding Secret?

**Did you redeploy?** Secrets require redeployment to take effect!

1. Go to **Edge Functions** → **jarvis-api-proxy**
2. Click **Deploy** button
3. Wait for it to finish
4. Try again

### How to Check Edge Function Logs

1. Go to: **Edge Functions** → **jarvis-api-proxy**
2. Click: **Logs** tab
3. Try a web search in the app
4. Look for:
   - `📥 Received request for provider: perplexity` ← Good, request received
   - `🔑 API Keys check:` ← Shows which keys are available
   - `hasPerplexity: false` ← BAD! Key is missing
   - `hasPerplexity: true` ← Good! Key is found
   - `❌ Perplexity API key not found in Supabase Secrets` ← Key missing error

### Error: "Perplexity API key not configured in Supabase Secrets"

This means the Edge Function **definitely** doesn't have the key. Follow Step 1 above.

### Error: "Edge Function authentication failed"

This means the Supabase anon key is wrong or the function isn't public. The app uses the correct hardcoded key, so this is unlikely.

### Error: Invalid Perplexity API Key

Your `PPLX_API_KEY` value is wrong or expired:
1. Go to: https://www.perplexity.ai/settings/api
2. Generate a new API key
3. Update it in Supabase Secrets (Step 1 above)
4. Redeploy (Step 3 above)

## What The App Does (Technical Details)

### Request Flow
1. User asks: "What's the latest AI news?"
2. GPT-5 Mini decides to call `searchweb` tool
3. App calls `executeSearchWeb()` function
4. **Tries IPC first** (main process) → `call-perplexity-api`
5. Main process makes HTTPS request to Edge Function
6. Edge Function gets `PPLX_API_KEY` from Supabase Secrets
7. Edge Function calls Perplexity API
8. Response flows back to app

### Hardcoded Values (Same as Working Test Script)
```javascript
const SUPABASE_URL = 'https://nbmnbgouiammxpkbyaxj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
const PROXY_URL = `${SUPABASE_URL}/functions/v1/jarvis-api-proxy`;
```

These are correct and match the working test script.

### Where the Code Lives
- **Frontend:** `script.js` line 1553-1811 (`executeSearchWeb()` function)
- **Main process:** `main.js` line 1267-1375 (IPC handler)
- **Edge Function:** `supabase/functions/jarvis-api-proxy/index.ts`

## Why Not a Code Issue?

The app is already doing everything right:
1. ✅ Checks for Perplexity access before calling
2. ✅ Uses hardcoded Supabase URL and anon key
3. ✅ Sends correct payload format
4. ✅ Has detailed error logging
5. ✅ Falls back gracefully if IPC fails

The test script (`test-perplexity-debug.js`) works because it tests the Edge Function directly. The **same Edge Function** is what the app uses.

## Summary

✅ **App code:** Already correct, no changes needed  
❌ **Supabase Secrets:** Missing or invalid `PPLX_API_KEY`  
⚠️ **Required action:** Add secret + redeploy Edge Function

## After the Fix

Once you add the secret and redeploy, you'll see:
- ✅ Web searches work for current events
- ✅ Can ask "What's the latest AI news?"
- ✅ Can search for real-time information
- ✅ Console shows: `✅ Using Perplexity API key from Supabase Secrets`

## Related Files

- `test-perplexity-debug.js` - Test script that works (proves Edge Function works when key is set)
- `FIX_401_QUICK.md` - Quick fix guide (similar issue)
- `SUPABASE_API_PROXY_SETUP.md` - How to set up the proxy initially
- `check-edge-function.md` - Additional troubleshooting


