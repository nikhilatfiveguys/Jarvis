# Add Polar Webhook Secret to Supabase

## Your Webhook Secret

```
polar_whs_4wkEsR5v62U3Ldlv6QYu77RTvsKLHJawUVu272zXoy3
```

## How to Add It

### Option 1: Using Supabase Dashboard

1. Go to your Supabase project dashboard
2. Click **Edge Functions** in the left sidebar
3. Click on **Settings** (or the gear icon)
4. Go to **Secrets** tab
5. Click **"Add new secret"** or **"+"** button
6. Enter:
   - **Name**: `POLAR_WEBHOOK_SECRET`
   - **Value**: `polar_whs_4wkEsR5v62U3Ldlv6QYu77RTvsKLHJawUVu272zXoy3`
7. Click **"Save"** or **"Add"**

### Option 2: Using Supabase CLI

```bash
supabase secrets set POLAR_WEBHOOK_SECRET=polar_whs_4wkEsR5v62U3Ldlv6QYu77RTvsKLHJawUVu272zXoy3
```

## Why This Is Important

✅ **Security**: Verifies webhooks are actually from Polar (not fake requests)
✅ **Protection**: Prevents unauthorized access to your subscription system
✅ **Best Practice**: Always verify webhook signatures in production

## After Adding the Secret

1. **Redeploy your Edge Function** (if it's already deployed)
   - The function will automatically pick up the new secret
   
2. **Test the webhook**:
   - Create a test subscription in Polar
   - Check Edge Function logs to see "✅ Webhook signature verified"
   - Verify subscription appears in Supabase

## Current Secrets You Have

Based on what I saw, you already have:
- ✅ `SUPABASE_URL`
- ✅ `SUPABASE_ANON_KEY`
- ✅ `SUPABASE_SERVICE_ROLE_KEY`
- ✅ `SUPABASE_DB_URL`

**You need to add:**
- ⚠️ `POLAR_WEBHOOK_SECRET` = `polar_whs_4wkEsR5v62U3Ldlv6QYu77RTvsKLHJawUVu272zXoy3`

## What Happens Without the Secret

- ⚠️ Webhooks will still work, but signature verification will be disabled
- ⚠️ Less secure - anyone could send fake webhooks
- ✅ For testing, you can temporarily disable signature verification

## What Happens With the Secret

- ✅ All webhooks are verified before processing
- ✅ Invalid signatures are rejected (401 error)
- ✅ Only legitimate Polar webhooks are processed
- ✅ More secure and production-ready


