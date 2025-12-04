# How the Jarvis API System Works

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         JARVIS APP                              │
│  ┌───────────────────┐           ┌──────────────────┐          │
│  │  Answer Screen    │           │   Web Search     │          │
│  │     Button        │           │  (Perplexity)    │          │
│  └─────────┬─────────┘           └────────┬─────────┘          │
│            │                               │                     │
│            │  Both use proxy!              │                     │
│            └───────────────┬───────────────┘                     │
│                            │                                     │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             ▼
        ┌────────────────────────────────────────────┐
        │      SUPABASE EDGE FUNCTION                │
        │      jarvis-api-proxy                      │
        │                                            │
        │  Gets API keys from Supabase Secrets:     │
        │  • OPENAI_API_KEY   (for Answer Screen)   │
        │  • PPLX_API_KEY     (for Web Search)      │
        │  • CLAUDE_API_KEY   (for Claude)          │
        └────────────┬───────────────────────────────┘
                     │
         ┌───────────┴────────────┐
         │                        │
         ▼                        ▼
┌──────────────────┐    ┌──────────────────┐
│   OpenAI API     │    │ Perplexity API   │
│   (Answer        │    │ (Web Search)     │
│    Screen)       │    │                  │
└──────────────────┘    └──────────────────┘
```

## Before the Fix (Broken) ❌

### Answer Screen Button
```
Jarvis App
    │
    │ Direct API call (no proxy!)
    ▼
OpenAI API
    │
    ❌ 401 Error (no API key in app)
```

**Problem:** App tried to call OpenAI directly without API key.

### Web Search
```
Jarvis App
    │
    │ Uses proxy correctly ✅
    ▼
Supabase Edge Function
    │
    │ Looks for PPLX_API_KEY
    ❌ Not found in Secrets
    │
    ▼ Returns 401 error
```

**Problem:** Edge Function has no Perplexity API key in Supabase Secrets.

## After the Fix (Working) ✅

### Answer Screen Button
```
Jarvis App
    │
    │ Now uses proxy! ✅ (code updated)
    ▼
Supabase Edge Function
    │
    │ Gets OPENAI_API_KEY from Secrets ✅
    ▼
OpenAI API
    │
    ✅ Returns answer
```

### Web Search
```
Jarvis App
    │
    │ Uses proxy ✅ (already correct)
    ▼
Supabase Edge Function
    │
    │ Gets PPLX_API_KEY from Secrets ✅ (you need to add it)
    ▼
Perplexity API
    │
    ✅ Returns search results
```

## What Needed to be Fixed

### 1. Code Changes (Already Done by Me) ✅
- **File:** `script.js`
- **Change:** Updated `answerThis()` function to use proxy
- **Before:** Direct call to OpenAI
- **After:** Routes through Supabase Edge Function

### 2. Configuration Changes (You Need to Do) ⚠️
- **Location:** Supabase Dashboard → Settings → Edge Functions → Secrets
- **Add:**
  - `OPENAI_API_KEY` = Your OpenAI key
  - `PPLX_API_KEY` = Your Perplexity key
- **Then:** Redeploy the Edge Function

## Why This Architecture?

### ✅ Benefits
1. **Security:** API keys never stored in app code
2. **Centralized:** All API keys in one secure location
3. **Easy updates:** Change keys without updating app
4. **Cost tracking:** Monitor API usage in one place

### 🔒 Security Model
```
❌ BAD (before):
API Key → Hardcoded in app → Visible in bundle → Anyone can extract

✅ GOOD (now):
API Key → Supabase Secrets → Edge Function → App never sees it
```

## Request Flow Example

### When you click "Answer Screen":

```
Step 1: User clicks "Answer Screen" button
         ↓
Step 2: App captures screenshot
         ↓
Step 3: App sends to Edge Function:
        POST https://...supabase.co/functions/v1/jarvis-api-proxy
        Headers: Authorization: Bearer [Supabase Anon Key]
        Body: {
          provider: "openai",
          endpoint: "responses",
          payload: { /* screenshot + prompt */ }
        }
         ↓
Step 4: Edge Function receives request
         ↓
Step 5: Edge Function gets OPENAI_API_KEY from Secrets
         ↓
Step 6: Edge Function calls OpenAI:
        POST https://api.openai.com/v1/responses
        Headers: Authorization: Bearer [OpenAI Key]
        Body: { /* screenshot + prompt */ }
         ↓
Step 7: OpenAI processes and returns answer
         ↓
Step 8: Edge Function returns answer to app
         ↓
Step 9: App shows answer to user
```

### When you ask "What's the latest AI news?":

```
Step 1: User types message and sends
         ↓
Step 2: GPT-5 Mini decides to use searchweb tool
         ↓
Step 3: App calls executeSearchWeb()
         ↓
Step 4: App sends to Edge Function:
        POST https://...supabase.co/functions/v1/jarvis-api-proxy
        Headers: Authorization: Bearer [Supabase Anon Key]
        Body: {
          provider: "perplexity",
          payload: {
            model: "sonar-pro",
            messages: [/* search query */]
          }
        }
         ↓
Step 5: Edge Function receives request
         ↓
Step 6: Edge Function gets PPLX_API_KEY from Secrets
         ↓
Step 7: Edge Function calls Perplexity:
        POST https://api.perplexity.ai/chat/completions
        Headers: Authorization: Bearer [Perplexity Key]
        Body: { /* search query */ }
         ↓
Step 8: Perplexity searches web and returns results
         ↓
Step 9: Edge Function returns results to app
         ↓
Step 10: GPT-5 Mini uses results to answer user
         ↓
Step 11: App shows answer to user
```

## Error Handling

### 401 Errors (Unauthorized)

**Possible causes:**
1. ❌ API key missing in Supabase Secrets
2. ❌ API key invalid/expired
3. ❌ Edge Function not redeployed after adding key
4. ❌ Supabase anon key wrong (unlikely - it's hardcoded correctly)

**How to diagnose:**
1. Check Edge Function logs in Supabase Dashboard
2. Look for: `🔑 API Keys check: hasOpenAI: false, hasPerplexity: false`
3. If false → Add the missing key to Secrets
4. Redeploy Edge Function

### Other Errors

**500 Error:** Edge Function crashed (check logs)
**403 Error:** API key doesn't have permission
**429 Error:** Rate limit exceeded (wait and retry)
**Network Error:** Can't reach Edge Function (check internet)

## Configuration Files

### Where Things Are Configured

**1. Supabase URL & Anon Key:**
- `config/production-config.js`
- Hardcoded in `script.js` (line ~1587-1588)
- Hardcoded in `main.js` (line ~1270-1271)

**2. API Keys (Secrets):**
- Supabase Dashboard → Settings → Edge Functions → Secrets
- NOT in code (security!)

**3. Edge Function Code:**
- `supabase/functions/jarvis-api-proxy/index.ts`
- Handles routing to OpenAI/Perplexity/Claude

## Deployment Checklist

When deploying to production:

- [ ] Add `OPENAI_API_KEY` to Supabase Secrets
- [ ] Add `PPLX_API_KEY` to Supabase Secrets
- [ ] Add `CLAUDE_API_KEY` to Supabase Secrets (optional)
- [ ] Deploy Edge Function: `supabase functions deploy jarvis-api-proxy`
- [ ] Verify function is "Active" in dashboard
- [ ] Test Answer Screen button
- [ ] Test Web Search ("What's the latest AI news?")
- [ ] Check logs for any errors

## Monitoring

### Where to Check Logs

**Supabase Edge Function Logs:**
1. Go to: https://supabase.com/dashboard/project/nbmnbgouiammxpkbyaxj/functions
2. Click: `jarvis-api-proxy`
3. Click: "Logs" tab
4. Real-time logs appear here

**App Console Logs:**
1. Open Jarvis app
2. Press: Option+Cmd+I (Mac) or F12 (Windows)
3. Go to: "Console" tab
4. Look for:
   - `🔒 Using Supabase Edge Function proxy`
   - `✅ API keys loaded from main process`
   - Error messages with `❌`

## Summary

- ✅ **App code:** Now uses proxy for everything
- ⚠️ **Secrets:** You need to add API keys to Supabase
- ✅ **Edge Function:** Already deployed and working
- ⚠️ **Redeploy:** Required after adding secrets

**Next step:** Follow `QUICK_FIX_BOTH_401_ERRORS.md` to add the API keys!


