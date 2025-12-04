# Quick Fix for 401 Error

Since the test script works but the app doesn't, the Edge Function is working correctly. The issue is likely that the Edge Function needs to be redeployed or there's a caching issue.

## Quick Fix Steps:

### Option 1: Redeploy Edge Function (Recommended)

1. Go to: https://supabase.com/dashboard
2. Select project: `nbmnbgouiammxpkbyaxj`
3. Go to: **Edge Functions** → **jarvis-api-proxy**
4. Click **Redeploy** or **Deploy** button
5. Wait for deployment to complete
6. Try web search again in the app

### Option 2: Verify Secret is Set

1. Go to: **Settings** → **Edge Functions** → **Secrets**
2. Verify `PPLX_API_KEY` is set to: `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`
3. If it's not there, add it
4. If it's there but different, update it

### Option 3: Check Edge Function Logs

1. Go to: **Edge Functions** → **jarvis-api-proxy**
2. Click **Logs** tab
3. Try a web search in the app
4. Check the logs to see what error is happening

The logs will show:
- Whether the request is reaching the function
- Whether the Perplexity API key is found
- What error Perplexity API is returning

## Most Likely Issue:

Since the test script works, the Edge Function code is fine. The 401 is probably because:
1. **The function needs to be redeployed** - Sometimes Supabase caches the old version
2. **The secret wasn't saved properly** - Double-check it's actually set

Try redeploying the Edge Function first - that's the most common fix!

