# Remove Subscription for Testing

## Steps to Remove Your Subscription

### Step 1: Remove Local Subscription File

I've already deleted the local file. To verify:
```bash
ls "/Users/aaronsoni/Library/Application Support/Jarvis 5.0/subscription_status.json"
```
(Should say "No such file")

### Step 2: Remove from Supabase

**Option A: Using Supabase Dashboard (Easiest)**

1. Go to Supabase Dashboard → **Table Editor** → **subscriptions**
2. Find your subscription record
3. Click on the row
4. Click **"Delete"** or the trash icon
5. Confirm deletion

**Option B: Using SQL Editor**

1. Go to Supabase Dashboard → **SQL Editor**
2. Run this SQL:

```sql
-- Delete all subscriptions (for testing)
DELETE FROM subscriptions;

-- OR delete specific email (replace with your email):
-- DELETE FROM subscriptions WHERE email = 'your-email@example.com';
```

### Step 3: Remove Test Mode (if exists)

Test mode has been removed. If you still see test mode active, restart your app.

### Step 4: Verify Removal

1. **Check local file:**
   ```bash
   ls "/Users/aaronsoni/Library/Application Support/Jarvis 5.0/subscription_status.json"
   ```
   (Should not exist)

2. **Check Supabase:**
   - Go to Table Editor → subscriptions
   - Should be empty or your subscription removed

3. **Restart your app:**
   ```bash
   npm start
   ```
   - Should show free tier
   - Message counter should show 0/5

## Now You Can Test!

1. ✅ Subscription removed from local file
2. ✅ Subscription removed from Supabase
3. ✅ Test mode removed
4. ✅ App should show free tier

**Next:** Subscribe again via Polar and watch the webhook sync it to Supabase automatically!


