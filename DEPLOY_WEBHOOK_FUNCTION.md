# Deploy Polar Webhook Edge Function

## Option 1: Deploy via Supabase Dashboard (Easiest)

### Step 1: Install Supabase CLI (if not already installed)

```bash
# macOS
brew install supabase/tap/supabase

# Or using npm
npm install -g supabase
```

### Step 2: Login to Supabase

```bash
supabase login
```

This will open your browser to authenticate.

### Step 3: Link to Your Project

```bash
supabase link --project-ref nbmnbgouiammxpkbyaxj
```

Replace `nbmnbgouiammxpkbyaxj` with your actual project reference (found in your Supabase URL).

### Step 4: Deploy the Function

```bash
cd "/Users/aaronsoni/Desktop/Jarvis 5.0"
supabase functions deploy polar-webhook
```

## Option 2: Deploy via Supabase Dashboard UI

1. Go to **Supabase Dashboard** → **Edge Functions**
2. Click **"Deploy a new function"**
3. Choose **"Create from scratch"** or **"Upload from file"**
4. If uploading:
   - Function name: `polar-webhook`
   - Upload the `supabase/functions/polar-webhook/index.ts` file
5. Click **Deploy**

## Option 3: Manual Upload (Alternative)

If the above don't work, you can:

1. Go to **Supabase Dashboard** → **Edge Functions**
2. Click **"Deploy a new function"**
3. In the code editor, copy and paste the entire contents of `supabase/functions/polar-webhook/index.ts`
4. Name it `polar-webhook`
5. Click **Deploy**

## Verify Deployment

After deployment:

1. Go to **Edge Functions** → You should see `polar-webhook` in the list
2. Click on `polar-webhook` to see its details
3. Copy the function URL (it will be something like: `https://nbmnbgouiammxpkbyaxj.supabase.co/functions/v1/polar-webhook`)

## Update Polar Webhook URL

Once deployed, update your Polar webhook URL to point to this function:

1. Go to **Polar Dashboard** → **Webhooks**
2. Update the webhook URL to: `https://nbmnbgouiammxpkbyaxj.supabase.co/functions/v1/polar-webhook`
3. Make sure the webhook secret matches `POLAR_WEBHOOK_SECRET` in your Supabase secrets

## Test the Function

After deployment, test it by:

1. Creating a test subscription in Polar
2. Check **Edge Functions** → `polar-webhook` → **Logs** to see if it received the webhook
3. Check your Supabase `subscriptions` table to see if the email was saved


