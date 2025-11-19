# Debug Webhook Email Extraction

## The Problem
Even though `POLAR_ACCESS_TOKEN` is set, emails are still not appearing in Supabase.

## Step-by-Step Debugging

### 1. Check Edge Function Logs

Go to **Supabase Dashboard** → **Edge Functions** → **polar-webhook** → **Logs**

Look for these log messages when a webhook is received:

#### ✅ Success Indicators:
- `✅ Webhook signature verified`
- `Received Polar webhook event: checkout.completed` (or `subscription.created`)
- `Full webhook payload:` - This shows the actual structure
- `Extracted email: [email address]` or `Extracted email: NOT FOUND`
- `✅ Fetched customer email from Polar API: [email]`
- `✅ Final extracted email: [email]`
- `✅ Checkout synced to Supabase: [id]`

#### ❌ Error Indicators:
- `POLAR_ACCESS_TOKEN not set` - Secret not accessible
- `❌ No email found in webhook data and could not fetch from API`
- `Error syncing checkout to Supabase:` - Database error
- `Available data keys:` - Shows what fields are in the webhook

### 2. Check What's Actually in the Webhook

Look for the log line: `Full webhook payload:`

Copy that JSON and check:
- Does it have a `customer` object with `email`?
- Does it have `customer_email` field?
- Does it have `customer_id` that we can use to fetch from API?
- Does it have `metadata.email`?

### 3. Test the Polar API Directly

If the email isn't in the webhook, verify the Polar API access works:

```bash
curl -H "Authorization: Bearer polar_oat_JhNo3mK5bbMPTZr4535nh3bCQX4aY6PxCvQS92cK3pO" \
  https://api.polar.sh/v1/customers/{CUSTOMER_ID}
```

Replace `{CUSTOMER_ID}` with a customer ID from your webhook logs.

### 4. Check Supabase Database

1. Go to **Supabase Dashboard** → **Table Editor** → **subscriptions**
2. Check if ANY rows exist
3. If rows exist but email is NULL or empty, the extraction failed
4. If no rows exist, the upsert might be failing

### 5. Common Issues

#### Issue: Email extraction returns null
**Solution:** Check the webhook payload structure. Polar might use different field names.

#### Issue: API fetch fails
**Solution:** 
- Verify `POLAR_ACCESS_TOKEN` is correct
- Check if the token has permission to read customers
- Verify the API endpoint is correct

#### Issue: Database upsert fails
**Solution:**
- Check if the `email` field allows NULL (it shouldn't)
- Verify RLS policies allow the service role to insert
- Check for unique constraint violations

### 6. Manual Test

Create a test subscription in Polar and immediately check:
1. Edge Function logs - What did the webhook contain?
2. Supabase subscriptions table - Was a row created?
3. What was the error (if any)?

## What to Share

If it's still not working, please share:
1. The "Full webhook payload" log entry
2. Any error messages from the logs
3. Whether any rows exist in the subscriptions table
4. The "Extracted email" log entry value

This will help identify exactly where the email extraction is failing.


