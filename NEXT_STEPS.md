# Next Steps - Testing Your Webhook Setup

## ✅ What You've Completed

1. ✅ Created Supabase `subscriptions` table
2. ✅ Created Edge Function for Polar webhooks
3. ✅ Added Supabase secrets (URL, service role key, webhook secret)
4. ✅ Configured webhook in Polar dashboard
5. ✅ App is configured to use Supabase

## 🧪 Testing Steps

### Step 1: Verify Edge Function is Deployed

1. Go to Supabase Dashboard → **Edge Functions**
2. Find `polar-webhook` function
3. Make sure it shows as **"Active"** or **"Deployed"**
4. Click on it to see details

### Step 2: Test the Webhook Manually

You can test with a curl command or use Polar's webhook testing feature:

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
      "current_period_start": 1733692800,
      "current_period_end": 1736284800
    }
  }'
```

### Step 3: Check Edge Function Logs

1. Go to Supabase Dashboard → **Edge Functions** → **polar-webhook**
2. Click **"Logs"** tab
3. You should see webhook events and any errors

### Step 4: Test with Real Subscription

1. Go to Polar dashboard
2. Create a test subscription (or use a real one)
3. Check Supabase Edge Function logs - you should see:
   ```
   Received Polar webhook event: subscription.created
   ✅ Webhook signature verified
   ✅ Subscription created synced to Supabase
   ```
4. Go to Supabase → **Table Editor** → **subscriptions**
5. You should see the subscription record

### Step 5: Test Your App

1. **Start your app:**
   ```bash
   npm start
   ```

2. **Check if subscription is detected:**
   - The app should query Supabase
   - If subscription exists in Supabase, user should see premium status

3. **Test subscription check:**
   - Enter an email that has a subscription in Supabase
   - App should show premium features

## 🔍 Troubleshooting

### Webhook Not Working?

1. **Check Edge Function logs:**
   - Look for errors in Supabase Edge Functions → Logs
   - Check if webhook is being received

2. **Check Polar webhook status:**
   - Go to Polar dashboard → Webhooks
   - Check if webhook is sending events
   - Look for delivery status/errors

3. **Verify secrets are set:**
   - Make sure `POLAR_WEBHOOK_SECRET` is added
   - Make sure `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set

### Subscription Not Appearing in Supabase?

1. **Check Edge Function logs** for errors
2. **Verify table structure** - make sure columns match
3. **Check RLS policies** - service role should bypass RLS
4. **Test manually** - try inserting a record directly in Supabase

### App Not Detecting Subscription?

1. **Check app logs** for errors
2. **Verify Supabase credentials** in `config/production-config.js`
3. **Test Supabase connection** - make sure app can query the table
4. **Check email match** - make sure email in Supabase matches user's email

## 📊 Verify Everything is Working

### Checklist:

- [ ] Edge Function is deployed and active
- [ ] Webhook secret is added to Supabase
- [ ] Webhook URL is configured in Polar
- [ ] Test webhook event received in Edge Function logs
- [ ] Test subscription appears in Supabase `subscriptions` table
- [ ] App can query Supabase and detect subscriptions
- [ ] Premium features work for subscribed users

## 🎯 Expected Flow

```
User subscribes in Polar
         ↓
Polar sends webhook to Edge Function
         ↓
Edge Function receives webhook
         ↓
Edge Function verifies signature
         ↓
Edge Function syncs to Supabase
         ↓
Subscription appears in Supabase table
         ↓
User opens app
         ↓
App queries Supabase
         ↓
App finds subscription
         ↓
User gets premium access
```

## 🚀 You're Ready!

Once you've tested and verified:
- ✅ Webhooks are working
- ✅ Subscriptions sync to Supabase
- ✅ App detects subscriptions

Your subscription system is fully automated! 🎉

## Next: Test It!

1. Create a test subscription in Polar
2. Check Supabase to see if it appears
3. Test your app to see if it detects it
4. Celebrate! 🎊


