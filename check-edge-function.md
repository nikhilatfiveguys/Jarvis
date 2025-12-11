# Fixing 401 Error with Supabase Edge Function

The 401 error means the Edge Function is rejecting the request. Here's how to fix it:

## Option 1: Make Edge Function Public (Recommended)

1. Go to: https://supabase.com/dashboard
2. Select your project: `nbmnbgouiammxpkbyaxj`
3. Go to: **Edge Functions** → **jarvis-api-proxy**
4. Click **Settings** or **Configuration**
5. Find **Authentication** or **Access Control**
6. Set it to **Public** or **Allow anonymous access**
7. Save changes

## Option 2: Verify Edge Function is Deployed

1. Go to: https://supabase.com/dashboard
2. Select your project: `nbmnbgouiammxpkbyaxj`
3. Go to: **Edge Functions**
4. Make sure `jarvis-api-proxy` is listed and shows as **Active** or **Deployed**

If it's not deployed, deploy it:

```bash
cd ~/Desktop/Jarvis-5.0
supabase functions deploy jarvis-api-proxy
```

## Option 3: Verify Secrets are Set

1. Go to: https://supabase.com/dashboard
2. Select your project: `nbmnbgouiammxpkbyaxj`
3. Go to: **Settings** → **Edge Functions** → **Secrets**
4. Verify `PPLX_API_KEY` is set to: `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`

## Option 4: Test Edge Function Directly

Run this test:

```bash
cd ~/Desktop/Jarvis-5.0
node test-perplexity-now.js
```

This will show you the exact error message from the Edge Function.

## Common Issues:

1. **Edge Function not deployed** - Deploy it first
2. **Edge Function requires auth** - Make it public
3. **Secret not set** - Set PPLX_API_KEY in Supabase Secrets
4. **Wrong Supabase URL/Key** - Check production-config.js

