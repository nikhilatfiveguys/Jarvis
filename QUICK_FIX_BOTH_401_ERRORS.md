# Quick Fix: Both 401 Errors (Answer Screen + Web Search)

## TL;DR - Do This Now! ⚡

You have **TWO 401 errors**:
1. ❌ **Answer Screen button** → 401 error
2. ❌ **Web search** (asking for latest news) → 401 error

**Root cause:** Missing API keys in Supabase Secrets

---

## 🔧 Complete Fix (5 Minutes)

### Step 1: Add API Keys to Supabase Secrets

1. **Go to:** https://supabase.com/dashboard/project/nbmnbgouiammxpkbyaxj/settings/functions
   
2. **Click:** "Secrets" tab

3. **Add these two secrets:**

   **Secret #1: OpenAI (for Answer Screen)**
   - Name: `OPENAI_API_KEY`
   - Value: Your OpenAI API key (starts with `sk-`)
   - Click "Add new secret" / "Save"

   **Secret #2: Perplexity (for Web Search)**
   - Name: `PPLX_API_KEY`
   - Value: `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`
   - Click "Add new secret" / "Save"

### Step 2: Redeploy Edge Function (CRITICAL!)

1. **Go to:** https://supabase.com/dashboard/project/nbmnbgouiammxpkbyaxj/functions
   
2. **Find:** `jarvis-api-proxy` function

3. **Click:** "Deploy" or "Redeploy" button

4. **Wait:** ~10-30 seconds for deployment to complete

**Why?** Edge Functions don't pick up new secrets until redeployed!

### Step 3: Restart the Jarvis App

1. Quit the Jarvis app completely
2. Reopen the app
3. Test both features:
   - Press "Answer Screen" button → Should work! ✅
   - Ask "What's the latest AI news?" → Should work! ✅

---

## ✅ What Was Fixed

### Code Changes (Already Done)
I've already updated the app code to use the Supabase Edge Function proxy:

**File: `script.js`**
- ✅ Answer Screen button now uses proxy (was calling OpenAI directly)
- ✅ Better error messages for 401 errors
- ✅ Web search already had correct proxy logic

### Configuration Needed (Your Action)
The **API keys need to be added to Supabase Secrets** (see Step 1 above).

---

## 🧪 Testing

### Test Answer Screen
1. Open Jarvis app
2. Press "Answer Screen" button
3. Should analyze your screen ✅

### Test Web Search
1. Open Jarvis app
2. Type: "What's the latest AI news?"
3. Should search the web and return results ✅

---

## 🔍 Troubleshooting

### Still Getting 401 Errors?

**Check Supabase Secrets:**
1. Go to: https://supabase.com/dashboard/project/nbmnbgouiammxpkbyaxj/settings/functions
2. Click "Secrets" tab
3. Verify both `OPENAI_API_KEY` and `PPLX_API_KEY` are listed
4. If missing, add them (Step 1 above)

**Check Deployment:**
1. Go to: https://supabase.com/dashboard/project/nbmnbgouiammxpkbyaxj/functions
2. Find `jarvis-api-proxy`
3. Check "Status" shows "Active" or "Deployed"
4. If not, click "Deploy" button

**Check Edge Function Logs:**
1. Go to: https://supabase.com/dashboard/project/nbmnbgouiammxpkbyaxj/functions
2. Click `jarvis-api-proxy`
3. Click "Logs" tab
4. Try using the feature in the app
5. Look for error messages in logs

### Common Log Messages

✅ **Good:**
```
📥 Received request for provider: openai
🔑 API Keys check: hasOpenAI: true, hasPerplexity: true
✅ Using Perplexity API key from Supabase Secrets
```

❌ **Bad:**
```
❌ OpenAI API key not configured
❌ Perplexity API key not found in Supabase Secrets
🔑 API Keys check: hasOpenAI: false, hasPerplexity: false
```

If you see "false" or "not configured", the secrets aren't set correctly.

---

## 📝 Summary

| Feature | Issue | Fix | Status |
|---------|-------|-----|--------|
| Answer Screen | 401 error | ✅ Code updated to use proxy | Done |
| Answer Screen | Missing API key | ⚠️ Add `OPENAI_API_KEY` to Supabase | **Action needed** |
| Web Search | 401 error | ✅ Code already uses proxy | Done |
| Web Search | Missing API key | ⚠️ Add `PPLX_API_KEY` to Supabase | **Action needed** |

**What you need to do:**
1. Add both API keys to Supabase Secrets
2. Redeploy the Edge Function
3. Restart the app

---

## 🔗 Quick Links

- **Supabase Dashboard:** https://supabase.com/dashboard/project/nbmnbgouiammxpkbyaxj
- **Edge Functions:** https://supabase.com/dashboard/project/nbmnbgouiammxpkbyaxj/functions
- **Secrets:** https://supabase.com/dashboard/project/nbmnbgouiammxpkbyaxj/settings/functions
- **Perplexity API Keys:** https://www.perplexity.ai/settings/api

---

## 📚 Detailed Guides

If you need more details, see:
- `FIX_PERPLEXITY_401.md` - Perplexity web search 401 error (detailed)
- `ANSWER_SCREEN_401_FIX.md` - Answer Screen 401 error (detailed)
- `TEST_ANSWER_SCREEN.md` - Testing guide for Answer Screen
- `SUPABASE_API_PROXY_SETUP.md` - Complete proxy setup guide

---

## 💡 Why This Approach?

**Security:** API keys are stored securely in Supabase Secrets, not in your app code.

**How it works:**
1. App sends request to Supabase Edge Function
2. Edge Function retrieves API keys from Supabase Secrets
3. Edge Function calls OpenAI/Perplexity APIs
4. Response sent back to app

This way, your API keys are never exposed in the app bundle! 🔒


