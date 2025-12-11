# Deploy Polar Webhook Function via Dashboard

Since the CLI requires interactive login, here's how to deploy via the Supabase Dashboard:

## Method 1: Quick Deploy (Recommended)

1. **Go to Supabase Dashboard** → **Edge Functions**
2. Click **"Deploy a new function"** button (green button in top right)
3. Select **"Create from scratch"**
4. **Function name:** `polar-webhook`
5. **Copy the entire contents** of `supabase/functions/polar-webhook/index.ts` and paste it into the code editor
6. Click **"Deploy"**

## Method 2: Use Terminal (After Manual Login)

Run these commands in your terminal (they require browser authentication):

```bash
# 1. Login (opens browser)
supabase login

# 2. Link to project
supabase link --project-ref nbmnbgouiammxpkbyaxj

# 3. Deploy
cd "/Users/aaronsoni/Desktop/Jarvis 5.0"
supabase functions deploy polar-webhook
```

## After Deployment

1. **Verify the function appears** in Edge Functions list
2. **Copy the function URL** (it will be: `https://nbmnbgouiammxpkbyaxj.supabase.co/functions/v1/polar-webhook`)
3. **Update Polar webhook URL** to point to this function:
   - Go to Polar Dashboard → Webhooks
   - Update URL to: `https://nbmnbgouiammxpkbyaxj.supabase.co/functions/v1/polar-webhook`
   - Make sure the secret matches your `POLAR_WEBHOOK_SECRET`

## Test

1. Create a test subscription in Polar
2. Check **Edge Functions** → `polar-webhook` → **Logs**
3. Check your Supabase `subscriptions` table


