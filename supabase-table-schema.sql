-- Supabase Subscriptions Table Schema for Jarvis 5.0
-- Copy and paste this entire script into your Supabase SQL Editor

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

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_subscriptions_email ON subscriptions(email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub_id ON subscriptions(stripe_subscription_id);

-- Enable Row Level Security (RLS)
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Create policy to allow service role to manage all subscriptions
-- (Service role bypasses RLS, but this is good practice)
CREATE POLICY "Service role can manage all subscriptions"
    ON subscriptions
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at when row is updated
CREATE TRIGGER update_subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


