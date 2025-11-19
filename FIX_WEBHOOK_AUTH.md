# Fix Webhook Authentication Issue

## Problem
The Edge Function requires authentication, but Polar webhooks don't send Supabase auth headers. This causes a 401 error.

## Solution Options

### Option 1: Configure Polar to Send Authorization Header (Recommended)

Update your Polar webhook URL to include the Supabase anon key as a Bearer token:

1. **Get your Supabase Anon Key:**
   - From your config: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibW5iZ291aWFtbXhwa2J5YXhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI1MjEwODcsImV4cCI6MjA3ODA5NzA4N30.ppFaxEFUyBWjwkgdszbvP2HUdXXKjC0Bu-afCQr0YxE`

2. **Update Polar Webhook Configuration:**
   - Go to **Polar Dashboard** → **Webhooks**
   - Edit your webhook
   - Add a custom header:
     - **Header name:** `Authorization`
     - **Header value:** `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibW5iZ291aWFtbXhwa2J5YXhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI1MjEwODcsImV4cCI6MjA3ODA5NzA4N30.ppFaxEFUyBWjwkgdszbvP2HUdXXKjC0Bu-afCQr0YxE`
   - Save the webhook

### Option 2: Make Function Public via Supabase Config

If Polar doesn't support custom headers, we need to make the function public:

1. **Create a `_config.toml` file** in your function directory:
   ```toml
   [functions.polar-webhook]
   verify_jwt = false
   ```

2. **Deploy the function again:**
   ```bash
   supabase functions deploy polar-webhook
   ```

### Option 3: Use Function Invoke URL (Alternative)

Some Supabase projects allow invoking functions without auth via a special endpoint. Check your Supabase dashboard for function invoke URLs.

## Testing

After applying one of the solutions:

1. **Test manually:**
   ```bash
   curl -X POST https://nbmnbgouiammxpkbyaxj.supabase.co/functions/v1/polar-webhook \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer YOUR_ANON_KEY" \
     -d '{"type":"test","data":{"id":"test-123"}}'
   ```

2. **Check logs:**
   - Go to **Supabase Dashboard** → **Edge Functions** → **polar-webhook** → **Logs**
   - You should see: `=== WEBHOOK REQUEST RECEIVED ===`

3. **Test with Polar:**
   - Create a test subscription in Polar
   - Check if webhook is delivered (check Polar webhook logs)
   - Check Supabase Edge Function logs

## Recommended Solution

**Use Option 1** - Configure Polar to send the Authorization header. This is the most secure approach and works with Supabase's default security settings.

## If Polar Doesn't Support Custom Headers

If Polar doesn't allow custom headers in webhooks, use **Option 2** - make the function public. The Polar signature verification will still provide security.


