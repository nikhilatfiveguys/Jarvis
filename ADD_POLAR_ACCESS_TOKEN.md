# Add POLAR_ACCESS_TOKEN Secret to Supabase Edge Function

## The Problem
Your Edge Function needs `POLAR_ACCESS_TOKEN` to fetch customer emails from Polar's API when they're not included in the webhook payload. Currently, this secret is **missing** from your Supabase Edge Function secrets.

## How to Add It

### Option 1: Using Supabase Dashboard

1. Go to your **Supabase Dashboard**
2. Navigate to **Edge Functions** → **polar-webhook**
3. Click on **Settings** tab
4. Scroll to **Secrets** section
5. Click **"Add new secret"** or the **"+"** button
6. Enter:
   - **Name:** `POLAR_ACCESS_TOKEN`
   - **Value:** `polar_oat_JhNo3mK5bbMPTZr4535nh3bCQX4aY6PxCvQS92cK3pO`
7. Click **Save**

### Option 2: Using Supabase CLI

```bash
supabase secrets set POLAR_ACCESS_TOKEN=polar_oat_JhNo3mK5bbMPTZr4535nh3bCQX4aY6PxCvQS92cK3pO
```

## Verify It's Added

After adding, you should see `POLAR_ACCESS_TOKEN` in your secrets list (it will show a SHA256 digest, not the actual value).

## Check Edge Function Logs

After adding the secret, check your Edge Function logs to see if it's working:

1. Go to **Edge Functions** → **polar-webhook**
2. Click on **Logs** tab
3. Look for:
   - `✅ Fetched customer email from Polar API:` (success)
   - `POLAR_ACCESS_TOKEN not set` (if secret is missing)
   - `Full webhook payload:` (to see the actual webhook structure)

## Test

1. Create a test subscription in Polar
2. Check the Edge Function logs
3. Verify the email appears in your Supabase `subscriptions` table


