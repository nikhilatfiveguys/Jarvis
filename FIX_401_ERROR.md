# Fix 401 Unauthorized Error

A 401 error means the API keys are missing, invalid, or expired. Here's how to fix it:

## If Using Supabase Edge Function Proxy (Recommended)

The app is using the Supabase Edge Function to proxy API calls. You need to set API keys in Supabase Secrets.

### Steps to Fix:

1. **Go to your Supabase Dashboard**
   - Visit: https://supabase.com/dashboard
   - Select your project

2. **Navigate to Edge Functions → Secrets**
   - Go to: Settings → Edge Functions → Secrets
   - Or use the CLI (see below)

3. **Set the API Keys**
   
   Using Supabase CLI:
   ```bash
   # Set OpenAI API key
   supabase secrets set OPENAI_API_KEY=sk-your-openai-key-here
   
   # Set Perplexity API key
   supabase secrets set PPLX_API_KEY=pplx-your-perplexity-key-here
   
   # Set Claude API key (optional)
   supabase secrets set CLAUDE_API_KEY=sk-ant-your-claude-key-here
   ```

   Or using the Dashboard:
   - Go to Settings → Edge Functions → Secrets
   - Add each secret:
     - Key: `OPENAI_API_KEY`, Value: `sk-...`
     - Key: `PPLX_API_KEY`, Value: `pplx-...`
     - Key: `CLAUDE_API_KEY`, Value: `sk-ant-...` (optional)

4. **Redeploy the Edge Function** (if needed)
   ```bash
   supabase functions deploy jarvis-api-proxy
   ```

5. **Verify the Keys are Set**
   ```bash
   supabase secrets list
   ```

## If Using Direct API Calls (Fallback)

If the Supabase proxy is not configured, the app falls back to direct API calls using environment variables.

### Steps to Fix:

1. **Set Environment Variables**
   
   On macOS/Linux:
   ```bash
   export OPENAI_API_KEY="sk-your-key-here"
   export PPLX_API_KEY="pplx-your-key-here"
   export CLAUDE_API_KEY="sk-ant-your-key-here"
   ```

   On Windows:
   ```powershell
   $env:OPENAI_API_KEY="sk-your-key-here"
   $env:PPLX_API_KEY="pplx-your-key-here"
   $env:CLAUDE_API_KEY="sk-ant-your-key-here"
   ```

2. **Or Create a `.env` file** in the project root:
   ```
   OPENAI_API_KEY=sk-your-key-here
   PPLX_API_KEY=pplx-your-key-here
   CLAUDE_API_KEY=sk-ant-your-key-here
   ```

## Check Which Method is Being Used

Open the app's Developer Console (View → Toggle Developer Tools) and look for:
- `🔒 Using Supabase Edge Function proxy` = Using proxy (check Supabase Secrets)
- `⚠️ Using direct API call` = Using direct calls (check environment variables)

## Verify API Keys are Valid

1. **OpenAI**: Check at https://platform.openai.com/api-keys
2. **Perplexity**: Check at https://www.perplexity.ai/settings/api
3. **Claude**: Check at https://console.anthropic.com/

Make sure:
- Keys are not expired
- Keys have the correct format (OpenAI starts with `sk-`, Perplexity starts with `pplx-`)
- Keys have sufficient credits/quota

## Still Getting 401?

1. Check the console logs for detailed error messages
2. Verify the Supabase anon key is correct in `config/production-config.js`
3. Make sure the Edge Function is deployed and running
4. Check Supabase Edge Function logs for errors


