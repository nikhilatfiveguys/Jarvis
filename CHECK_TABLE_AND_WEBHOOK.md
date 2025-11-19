# Fix: Check the Right Table and Verify Webhook

## Issue 1: Wrong Table Name

You're looking at `Subscription` (singular) but the function writes to `subscriptions` (plural).

**Fix:**
1. In Supabase Dashboard → Table Editor
2. Click on `subscriptions` (plural) in the left sidebar
3. Check that table for subscription data

## Issue 2: Polar Still Showing 401 Errors

The webhook logs show old 401 errors (from 3:08-3:14 PM). We need to check:

### Step 1: Verify Function is Public

Test if the function accepts requests without auth:

```bash
curl -X POST https://nbmnbgouiammxpkbyaxj.supabase.co/functions/v1/polar-webhook \
  -H "Content-Type: application/json" \
  -d '{"type":"test","data":{"id":"test"}}'
```

If you get `{"success":true}` (not 401), the function is public.

### Step 2: Check Polar Webhook URL

1. Go to **Polar Dashboard** → **Webhooks**
2. Click on your webhook
3. Verify the URL is exactly:
   ```
   https://nbmnbgouiammxpkbyaxj.supabase.co/functions/v1/polar-webhook
   ```
4. Make sure there's no trailing slash

### Step 3: Trigger a New Webhook

1. Create a **new test subscription** in Polar (or trigger a webhook event)
2. Immediately check:
   - **Polar webhook logs** - What status code? (should be 200, not 401)
   - **Supabase Edge Function logs** - Do you see `=== WEBHOOK REQUEST RECEIVED ===`?
   - **Supabase `subscriptions` table** (plural) - Is there a new row?

### Step 4: If Still Getting 401

If new webhooks still show 401, the function might not be truly public. Try:

1. **Redeploy the function:**
   ```bash
   cd "/Users/aaronsoni/Desktop/Jarvis 5.0"
   supabase functions deploy polar-webhook --project-ref nbmnbgouiammxpkbyaxj
   ```

2. **Or check Supabase Dashboard:**
   - Go to Edge Functions → `polar-webhook` → Settings
   - Look for "Verify JWT" or "Require Authentication"
   - Make sure it's disabled/off

## What to Check Now

1. ✅ Check `subscriptions` table (plural) - not `Subscription`
2. ✅ Trigger a NEW webhook in Polar (create a test subscription)
3. ✅ Check if new webhooks show 200 or still 401
4. ✅ Check Supabase logs for the new webhook request


