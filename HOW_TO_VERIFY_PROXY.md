# How to Verify Edge Function Proxy is Working

## 🔍 Quick Test Methods

### Method 1: Check Console Logs (Easiest)

When you run `npm start`, look for these messages in the console:

**✅ Working (Using Proxy):**
```
🔗 API Proxy URL: https://nbmnbgouiammxpkbyaxj.supabase.co/functions/v1/jarvis-api-proxy
🔒 Using Supabase Edge Function proxy for OpenAI
🔒 Using Supabase Edge Function proxy for Perplexity
🔒 Using Supabase Edge Function proxy for Claude
```

**❌ Not Working (Using Direct API):**
```
🔗 API Proxy URL: NOT CONFIGURED (will use direct API calls)
⚠️ Using direct OpenAI API call (API key required)
⚠️ Using direct Perplexity API call (API key required)
```

### Method 2: Test the Edge Function Directly

Run this test script:

```bash
node test-edge-function.js
```

**Expected Output (Success):**
```
🧪 Testing Supabase Edge Function...

1️⃣ Testing Perplexity API via Edge Function...
✅ Perplexity test PASSED!
   Response: Hello

2️⃣ Testing OpenAI API via Edge Function...
✅ OpenAI test PASSED!
   Response received (check data for output)

✅ Test complete!
```

**If it fails:**
- Check that secrets are set: `supabase secrets list`
- Verify Edge Function is deployed: Check Supabase Dashboard

### Method 3: Test in the App

1. **Start the app:**
   ```bash
   npm start
   ```

2. **Open DevTools:**
   - Press `Cmd+Option+I` (macOS) or `Ctrl+Shift+I` (Windows)
   - Or add `--dev` flag: `npm run dev`

3. **Check Console:**
   - Look for "🔒 Using Supabase Edge Function proxy" messages
   - These appear when you make API calls

4. **Test Features:**
   - Ask a question → Should see "🔒 Using Supabase Edge Function proxy for OpenAI"
   - Use web search → Should see "🔒 Using Supabase Edge Function proxy for Perplexity"
   - Ask complex question → Should see "🔒 Using Supabase Edge Function proxy for Claude"

### Method 4: Check Network Tab

1. Open DevTools (`Cmd+Option+I`)
2. Go to **Network** tab
3. Make an API call in the app
4. Look for requests to:
   - ✅ `https://nbmnbgouiammxpkbyaxj.supabase.co/functions/v1/jarvis-api-proxy` (Proxy working!)
   - ❌ `https://api.openai.com/v1/...` (Direct call - proxy not working)

## 🐛 Troubleshooting

### If you see "⚠️ Using direct API call":

**Check 1: Verify Proxy URL is configured**
- Open `config/production-config.js`
- Check that `apiProxyUrl` is set correctly

**Check 2: Verify Secrets are set**
```bash
supabase secrets list
```
Should show:
- `OPENAI_API_KEY` ✅
- `PPLX_API_KEY` ✅
- `CLAUDE_API_KEY` ✅

**Check 3: Verify Edge Function is deployed**
- Go to: https://supabase.com/dashboard/project/nbmnbgouiammxpkbyaxj/functions
- Should see `jarvis-api-proxy` function listed

### If Edge Function returns errors:

**Check Edge Function logs:**
```bash
supabase functions logs jarvis-api-proxy
```

**Common issues:**
- Missing secrets → Set them: `supabase secrets set KEY=value`
- Wrong function URL → Check `apiProxyUrl` in config
- Auth issues → Verify `supabaseAnonKey` is correct

## ✅ Success Indicators

You'll know it's working when:
1. ✅ Console shows "🔒 Using Supabase Edge Function proxy"
2. ✅ Network tab shows requests to Supabase Edge Function
3. ✅ API calls succeed (you get responses)
4. ✅ No API keys appear in your code (safe for GitHub)

## 🎯 Quick Verification Checklist

- [ ] Edge Function deployed: `supabase functions deploy jarvis-api-proxy`
- [ ] Secrets set: `supabase secrets list` shows all 3 keys
- [ ] App shows "🔒 Using Supabase Edge Function proxy" in console
- [ ] Network requests go to Supabase (not direct APIs)
- [ ] API calls work (you get responses)

If all checked ✅, you're good to go! 🚀

