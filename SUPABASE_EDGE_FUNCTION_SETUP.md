# Supabase Edge Function Setup for Polar Webhooks

This guide will help you create and deploy a Supabase Edge Function to handle Polar webhooks automatically.

## Why Use Edge Functions?

✅ **Always available** - Runs on Supabase's servers, not your app
✅ **No need to keep app running** - Webhooks work even when app is closed
✅ **Scalable** - Handles webhooks automatically
✅ **Secure** - Uses Supabase service role key

## Step 1: Create the Edge Function

### Option A: Using Supabase Dashboard (Easiest)

1. Go to your Supabase project dashboard
2. Click on **"Edge Functions"** in the left sidebar
3. Click **"Create a new function"**
4. Name it: `polar-webhook`
5. Copy the code from `supabase/functions/polar-webhook/index.ts`
6. Paste it into the editor
7. Click **"Deploy"**

### Option B: Using Supabase CLI

1. Install Supabase CLI:
   ```bash
   brew install supabase/tap/supabase
   ```

2. Login to Supabase:
   ```bash
   supabase login
   ```

3. Link your project:
   ```bash
   supabase link --project-ref your-project-ref
   ```

4. Deploy the function:
   ```bash
   supabase functions deploy polar-webhook
   ```

## Step 2: Set Environment Variables

You need to set these secrets in Supabase:

1. Go to **Edge Functions** → **Settings** → **Secrets**
2. Add these secrets:

   - **SUPABASE_URL**: `https://nbmnbgouiammxpkbyaxj.supabase.co`
   - **SUPABASE_SERVICE_ROLE_KEY**: Your service role key (the one you gave me earlier)
   - **POLAR_WEBHOOK_SECRET**: (Optional) Your Polar webhook secret if you have one

### Using Supabase CLI:
```bash
supabase secrets set SUPABASE_URL=https://nbmnbgouiammxpkbyaxj.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
supabase secrets set POLAR_WEBHOOK_SECRET=your-webhook-secret
```

## Step 3: Get Your Edge Function URL

After deploying, you'll get a URL like:
```
https://nbmnbgouiammxpkbyaxj.supabase.co/functions/v1/polar-webhook
```

This is your webhook URL!

## Step 4: Configure in Polar Dashboard

1. Go to https://polar.sh/dashboard
2. Navigate to **Settings** → **Webhooks**
3. Click **"Add Webhook"**
4. Enter URL: `https://nbmnbgouiammxpkbyaxj.supabase.co/functions/v1/polar-webhook`
5. Select events:
   - ✅ `checkout.completed`
   - ✅ `subscription.created`
   - ✅ `subscription.updated`
   - ✅ `subscription.canceled`
6. Click **"Save"**

## Step 5: Test the Webhook

### Test with curl:
```bash
curl -X POST https://nbmnbgouiammxpkbyaxj.supabase.co/functions/v1/polar-webhook \
  -H "Content-Type: application/json" \
  -H "polar-signature: test" \
  -d '{
    "type": "subscription.created",
    "data": {
      "id": "test_sub_123",
      "status": "active",
      "customer": {
        "id": "test_customer",
        "email": "test@example.com"
      },
      "current_period_start": 1234567890,
      "current_period_end": 1234567890
    }
  }'
```

### Check Supabase:
1. Go to **Table Editor** → **subscriptions**
2. You should see the test subscription

## How It Works

```
User subscribes in Polar
         ↓
Polar sends webhook
         ↓
Supabase Edge Function receives it
         ↓
Function processes event
         ↓
Function updates Supabase subscriptions table
         ↓
Your app queries Supabase → Gets updated subscription
```

## Monitoring

### View Function Logs:
1. Go to **Edge Functions** → **polar-webhook**
2. Click **"Logs"** tab
3. See all webhook events and any errors

### Check Function Invocations:
- Go to **Edge Functions** → **polar-webhook**
- See invocation count, success rate, etc.

## Troubleshooting

### "Function not found" error:
- Make sure you deployed the function
- Check the function name matches exactly

### "Invalid signature" error:
- Check if you set `POLAR_WEBHOOK_SECRET` correctly
- Or disable signature verification temporarily for testing

### "No email found" error:
- Check Polar webhook payload structure
- May need to adjust how we extract email from the event

### Subscription not appearing in Supabase:
- Check Edge Function logs for errors
- Verify the function has permission to write to subscriptions table
- Check RLS policies allow service role to write

## Security Notes

✅ **Service Role Key**: Only used server-side in Edge Function (secure)
✅ **Webhook Secret**: Optional but recommended for signature verification
✅ **CORS Headers**: Configured to allow Polar to send webhooks
✅ **RLS**: Service role bypasses RLS, so it can write to subscriptions

## Next Steps

After setting up:
1. ✅ Test with a real subscription in Polar
2. ✅ Verify subscription appears in Supabase
3. ✅ Test cancellation
4. ✅ Monitor logs for any issues

Your webhook system is now fully automated! 🎉


