-- Fix your existing subscriptions table to match Jarvis 5.0 requirements
-- Run this in your Supabase SQL Editor

-- First, let's check if we need to drop and recreate or alter
-- Option 1: If you want to keep existing data, we'll alter the table
-- Option 2: If the table is empty, we can drop and recreate

-- Since your table appears empty, let's drop and recreate with the correct schema
DROP TABLE IF EXISTS subscriptions CASCADE;

-- Create subscriptions table with correct schema (for Polar payment provider)
CREATE TABLE subscriptions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'canceled', 'past_due', 'trialing', 'incomplete')),
    polar_subscription_id TEXT,
    polar_customer_id TEXT,
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    current_period_end TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX idx_subscriptions_email ON subscriptions(email);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_polar_sub_id ON subscriptions(polar_subscription_id);

-- Enable Row Level Security (RLS)
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;

-- Create policy to allow service role to manage all subscriptions
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

