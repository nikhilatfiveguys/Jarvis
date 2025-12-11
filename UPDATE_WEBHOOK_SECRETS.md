# Update Supabase Edge Function Secrets

To fix the email extraction issue, you need to add the Polar Access Token to your Supabase Edge Function secrets. This allows the webhook to fetch customer email from Polar API if it's not included in the webhook payload.

## Steps to Add POLAR_ACCESS_TOKEN

### Using the Supabase Dashboard:

1. **Go to your Supabase Project Dashboard.**
2. In the left sidebar, navigate to **"Edge Functions"**.
3. Select your `polar-webhook` function.
4. Click on the **"Settings"** tab.
5. Scroll down to the **"Secrets"** section.
6. Click **"Add new secret"** or the **"+"** icon.
7. Enter the following:
   - **Name:** `POLAR_ACCESS_TOKEN`
   - **Value:** `polar_oat_JhNo3mK5bbMPTZr4535nh3bCQX4aY6PxCvQS92cK3pO` (from your config)
8. Click **"Save"** or **"Add"**.

### Using the Supabase CLI:

If you have the Supabase CLI installed and configured for your project, you can set the secret via the command line:

```bash
supabase secrets set POLAR_ACCESS_TOKEN=polar_oat_JhNo3mK5bbMPTZr4535nh3bCQX4aY6PxCvQS92cK3pO
```

## What This Does

With the `POLAR_ACCESS_TOKEN` secret set, the Edge Function will:

1. **First try to extract email from the webhook payload** - checking multiple possible locations
2. **If email is not found**, it will use the customer ID from the webhook to fetch the customer details from Polar's API
3. **Extract the email** from the API response and store it in Supabase

## Enhanced Email Extraction

The updated Edge Function now:
- Checks **10+ different locations** in the webhook payload for email
- **Logs the full webhook payload** for debugging (check Edge Function logs)
- **Falls back to Polar API** if email isn't in the webhook
- **Provides detailed error messages** if email cannot be found

## Testing

After adding the secret:

1. **Redeploy the Edge Function** (if needed)
2. **Trigger a test subscription** in Polar
3. **Check the Edge Function logs** in Supabase Dashboard to see:
   - The full webhook payload structure
   - Where the email was found (or if it was fetched from API)
   - Any errors during processing
4. **Verify in Supabase** that the email is now stored in the `subscriptions` table

## Troubleshooting

If emails are still not appearing:

1. **Check Edge Function logs** - Look for the "Full webhook payload" log entry to see the actual structure
2. **Verify the secret is set** - Check that `POLAR_ACCESS_TOKEN` appears in the secrets list
3. **Check Polar API access** - Verify your access token has permissions to read customer data
4. **Review error messages** - The logs will show exactly where the email extraction failed


