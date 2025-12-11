# Supabase Subscription Management Setup Guide

This guide will help you set up Supabase to manage subscriptions for Jarvis 5.0.

## Prerequisites

1. Create a Supabase account at [supabase.com](https://supabase.com)
2. Create a new project in Supabase
3. Set up Stripe for payment processing (recommended) or use another payment provider

## Step 1: Get Your Supabase Credentials

1. Go to your Supabase project dashboard
2. Navigate to **Settings** → **API**
3. Copy the following:
   - **Project URL** (your Supabase URL)
   - **anon/public key** (for client-side operations)
   - **service_role key** (for server-side/admin operations - keep this secret!)

## Step 2: Create the Database Schema

Run this SQL in your Supabase SQL Editor:

```sql
-- Create subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'past_due', 'trialing', 'incomplete')),
    stripe_subscription_id TEXT,
    stripe_customer_id TEXT,
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_period_end TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);

-- Create index on stripe_subscription_id
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub_id ON subscriptions(stripe_subscription_id);

-- Enable Row Level Security (RLS)
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Create policy to allow users to read their own subscription
CREATE POLICY "Users can read their own subscription"
    ON subscriptions
    FOR SELECT
    USING (auth.uid()::text = email OR true); -- Adjust based on your auth setup

-- Create policy for service role to manage all subscriptions
-- Note: Service role bypasses RLS, so this is mainly for documentation
CREATE POLICY "Service role can manage all subscriptions"
    ON subscriptions
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
```

## Step 3: Configure Your Environment

Update `config/production-config.js` with your Supabase credentials:

```javascript
supabase: {
    url: 'https://your-project.supabase.co',
    anonKey: 'your-anon-key-here',
    serviceRoleKey: 'your-service-role-key-here', // Keep this secret!
    checkoutUrl: 'https://checkout.stripe.com' // Or your payment provider URL
}
```

Or set environment variables:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_CHECKOUT_URL` (optional)

## Step 4: Set Up Stripe Integration (Recommended)

1. Create a Stripe account at [stripe.com](https://stripe.com)
2. Get your Stripe API keys
3. Set up Stripe webhooks to update Supabase when subscriptions change
4. Create a backend API endpoint to handle Stripe webhooks

### Example Stripe Webhook Handler (Node.js/Express)

```javascript
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

app.post('/webhook/stripe', express.raw({type: 'application/json'}), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    switch (event.type) {
        case 'checkout.session.completed':
            const session = event.data.object;
            await handleCheckoutCompleted(session);
            break;
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
            const subscription = event.data.object;
            await handleSubscriptionUpdated(subscription);
            break;
        case 'customer.subscription.deleted':
            const deletedSubscription = event.data.object;
            await handleSubscriptionDeleted(deletedSubscription);
            break;
    }

    res.json({received: true});
});

async function handleCheckoutCompleted(session) {
    const { data, error } = await supabase
        .from('subscriptions')
        .upsert({
            email: session.customer_details.email,
            stripe_subscription_id: session.subscription,
            stripe_customer_id: session.customer,
            status: 'active',
            current_period_start: new Date().toISOString(),
            current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        }, {
            onConflict: 'email'
        });
}

async function handleSubscriptionUpdated(subscription) {
    const { data, error } = await supabase
        .from('subscriptions')
        .update({
            status: subscription.status === 'active' || subscription.status === 'trialing' ? 'active' : subscription.status,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString()
        })
        .eq('stripe_subscription_id', subscription.id);
}

async function handleSubscriptionDeleted(subscription) {
    const { data, error } = await supabase
        .from('subscriptions')
        .update({ status: 'canceled' })
        .eq('stripe_subscription_id', subscription.id);
}

app.listen(3000, () => console.log('Webhook server running on port 3000'));
```

## Step 5: Test the Integration

1. Start your app: `npm start`
2. Try to check a subscription status
3. Verify that subscriptions are being stored in Supabase

## Database Schema Reference

### subscriptions table

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key, auto-generated |
| email | TEXT | User's email (unique) |
| status | TEXT | Subscription status: 'active', 'canceled', 'past_due', 'trialing', 'incomplete' |
| stripe_subscription_id | TEXT | Stripe subscription ID (if using Stripe) |
| stripe_customer_id | TEXT | Stripe customer ID (if using Stripe) |
| current_period_start | TIMESTAMPTZ | Start of current billing period |
| current_period_end | TIMESTAMPTZ | End of current billing period |
| created_at | TIMESTAMPTZ | When subscription was created |
| updated_at | TIMESTAMPTZ | Last update timestamp (auto-updated) |

## Security Notes

1. **Never expose your service_role key** in client-side code
2. Use Row Level Security (RLS) policies to protect user data
3. Validate webhook signatures from Stripe
4. Use environment variables for all sensitive credentials
5. Consider using Supabase Edge Functions for webhook handling

## Troubleshooting

**"Supabase configuration not found" error:**
- Make sure you've set SUPABASE_URL and SUPABASE_ANON_KEY in your config

**"No rows returned" when checking subscription:**
- Verify the email exists in the subscriptions table
- Check that the status is 'active' or 'trialing'

**Webhook not updating subscriptions:**
- Verify your webhook endpoint is accessible
- Check Stripe webhook logs for errors
- Ensure your webhook handler is calling Supabase correctly

## Migration from Polar

If you're migrating from Polar:
1. Export existing subscriptions from Polar
2. Import them into Supabase using the SQL editor or a migration script
3. Update your app configuration to use Supabase
4. Test thoroughly before removing Polar integration


