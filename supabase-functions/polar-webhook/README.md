# Polar Webhook Handler - Supabase Edge Function

This Supabase Edge Function handles Polar webhooks directly, updating subscription dates in Supabase when subscriptions are renewed or updated.

## Setup

1. **Deploy the function:**
   ```bash
   supabase functions deploy polar-webhook
   ```

2. **Set environment variables in Supabase Dashboard:**
   - Go to Project Settings → Edge Functions → Environment Variables
   - Add:
     - `POLAR_ACCESS_TOKEN` - Your Polar API access token

3. **Configure Polar webhook:**
   - Go to Polar Dashboard → Settings → Webhooks
   - Add webhook URL: `https://[your-project-ref].supabase.co/functions/v1/polar-webhook`
   - Select events:
     - `subscription.updated`
     - `subscription.created`
     - `subscription.canceled`

## How It Works

1. Polar sends webhook when subscription is updated/renewed
2. Edge function receives webhook
3. Fetches full subscription details from Polar API (to get updated dates)
4. Updates Supabase `subscriptions` table with:
   - Updated `current_period_start`
   - Updated `current_period_end`
   - Updated `status`

## Benefits

- No app code changes needed
- Runs server-side (more reliable)
- Automatically updates dates when Polar sends webhooks
- Handles all subscription lifecycle events
