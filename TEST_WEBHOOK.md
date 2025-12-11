# Test and Troubleshoot Webhook

## Issue: No Logs Showing Up

If no logs are appearing, the webhook might not be reaching your Edge Function. Let's troubleshoot:

## Step 1: Verify Function is Deployed

1. Go to **Supabase Dashboard** → **Edge Functions**
2. Check that `polar-webhook` appears in the list
3. Click on `polar-webhook` to see its details
4. Copy the function URL (should be: `https://nbmnbgouiammxpkbyaxj.supabase.co/functions/v1/polar-webhook`)

## Step 2: Test the Function Manually

Test if the function is accessible by making a test request:

```bash
curl -X POST https://nbmnbgouiammxpkbyaxj.supabase.co/functions/v1/polar-webhook \
  -H "Content-Type: application/json" \
  -d '{"type":"test","data":{"id":"test-123"}}'
```

This should return a response (even if it's an error). Check the logs after this request.

## Step 3: Verify Polar Webhook Configuration

1. Go to **Polar Dashboard** → **Settings** → **Webhooks**
2. Check:
   - **Webhook URL** should be: `https://nbmnbgouiammxpkbyaxj.supabase.co/functions/v1/polar-webhook`
   - **Webhook Secret** should match your `POLAR_WEBHOOK_SECRET` in Supabase
   - **Events** should include: `checkout.completed`, `subscription.created`, `subscription.updated`, `subscription.canceled`

## Step 4: Check Webhook Delivery in Polar

1. Go to **Polar Dashboard** → **Settings** → **Webhooks**
2. Click on your webhook
3. Check the **"Deliveries"** or **"Logs"** section
4. Look for:
   - Recent webhook attempts
   - HTTP status codes (200 = success, 4xx/5xx = error)
   - Response messages

## Step 5: Verify Function Logs Location

1. Go to **Supabase Dashboard** → **Edge Functions** → **polar-webhook**
2. Click on **"Logs"** tab (or **"Invocations"**)
3. Make sure you're looking at the right time range (last hour, last 24 hours, etc.)
4. If you see "No logs" or "No invocations", the function hasn't been called

## Step 6: Test with a Real Subscription

1. Create a **test subscription** in Polar (or trigger a webhook event)
2. Immediately check:
   - **Polar webhook logs** - Did Polar send the webhook?
   - **Supabase Edge Function logs** - Did it receive the webhook?
3. If Polar shows it sent but Supabase shows nothing, there might be a network/URL issue

## Step 7: Check for CORS or Authentication Issues

The function might be rejecting requests. Check:
1. Does the function require authentication?
2. Is CORS properly configured?
3. Check the function's response - it should return 200 even for invalid requests (with error details)

## Common Issues

### Issue: Webhook URL is Wrong
- Make sure the URL is exactly: `https://nbmnbgouiammxpkbyaxj.supabase.co/functions/v1/polar-webhook`
- No trailing slash
- Using `https://` not `http://`

### Issue: Webhook Secret Mismatch
- The secret in Polar must match `POLAR_WEBHOOK_SECRET` in Supabase
- Check for typos or extra spaces

### Issue: Function Not Publicly Accessible
- Edge Functions should be publicly accessible by default
- Check if there are any RLS policies blocking access

### Issue: Polar Webhook Not Configured
- Make sure the webhook is actually enabled in Polar
- Check that the events you're testing are selected

## Next Steps

After checking the above:
1. Test the function manually with curl (Step 2)
2. Check Polar webhook delivery logs (Step 4)
3. Create a test subscription and watch both Polar and Supabase logs simultaneously

If still no logs appear, share:
- What you see in Polar webhook delivery logs
- The exact webhook URL configured in Polar
- Any error messages from the curl test


