-- Supabase Cost-Based Usage Tracking Schema for Jarvis 5.0
-- Copy and paste this entire script into your Supabase SQL Editor
-- This tracks API costs in dollars, not tokens

-- Add cost limit columns to subscriptions table
ALTER TABLE subscriptions 
ADD COLUMN IF NOT EXISTS cost_limit_cents INTEGER DEFAULT 500,  -- Default $5.00 limit (in cents)
ADD COLUMN IF NOT EXISTS cost_used_this_month_cents INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS usage_reset_date TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN DEFAULT FALSE,  -- Manual block by admin
ADD COLUMN IF NOT EXISTS block_reason TEXT DEFAULT NULL;

-- Drop old token columns if they exist (optional - comment out if you want to keep them)
-- ALTER TABLE subscriptions DROP COLUMN IF EXISTS token_limit;
-- ALTER TABLE subscriptions DROP COLUMN IF EXISTS tokens_used_this_month;

-- Drop old view, functions, and table if they exist (CASCADE to handle dependencies)
DROP VIEW IF EXISTS user_usage_summary CASCADE;
DROP FUNCTION IF EXISTS get_monthly_token_usage(TEXT) CASCADE;
DROP FUNCTION IF EXISTS check_user_limits(TEXT) CASCADE;
DROP TABLE IF EXISTS token_usage CASCADE;

-- Create usage tracking table with cost
CREATE TABLE IF NOT EXISTS usage_tracking (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT NOT NULL,
    tokens_input INTEGER NOT NULL DEFAULT 0,
    tokens_output INTEGER NOT NULL DEFAULT 0,
    tokens_total INTEGER NOT NULL DEFAULT 0,
    cost_cents INTEGER NOT NULL DEFAULT 0,  -- Cost in cents (e.g., 150 = $1.50)
    model TEXT,
    provider TEXT DEFAULT 'openai',  -- openai, openrouter, perplexity, claude
    request_type TEXT,  -- chat, web_search, voice, etc.
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_usage_tracking_email ON usage_tracking(email);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_created_at ON usage_tracking(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_tracking_email_date ON usage_tracking(email, created_at);

-- Enable Row Level Security (RLS)
ALTER TABLE usage_tracking ENABLE ROW LEVEL SECURITY;

-- Drop existing policy if it exists, then create
DROP POLICY IF EXISTS "Service role can manage all usage_tracking" ON usage_tracking;
CREATE POLICY "Service role can manage all usage_tracking"
    ON usage_tracking
    FOR ALL
    USING (true)
    WITH CHECK (true);

-- Create function to get monthly cost for a user
CREATE OR REPLACE FUNCTION get_monthly_usage(user_email TEXT)
RETURNS TABLE (
    total_cost_cents BIGINT,
    total_cost_dollars NUMERIC(10,2),
    total_requests BIGINT,
    total_tokens BIGINT,
    by_provider JSONB
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(SUM(ut.cost_cents), 0)::BIGINT as total_cost_cents,
        (COALESCE(SUM(ut.cost_cents), 0) / 100.0)::NUMERIC(10,2) as total_cost_dollars,
        COUNT(*)::BIGINT as total_requests,
        COALESCE(SUM(ut.tokens_total), 0)::BIGINT as total_tokens,
        COALESCE(
            jsonb_object_agg(
                ut.provider, 
                jsonb_build_object(
                    'cost_cents', COALESCE(SUM(ut.cost_cents), 0),
                    'requests', COUNT(*)
                )
            ),
            '{}'::jsonb
        ) as by_provider
    FROM usage_tracking ut
    WHERE ut.email = user_email
    AND ut.created_at >= date_trunc('month', NOW());
END;
$$ LANGUAGE plpgsql;

-- Create function to check if user is within cost limits
CREATE OR REPLACE FUNCTION check_user_cost_limits(user_email TEXT)
RETURNS TABLE (
    is_allowed BOOLEAN,
    reason TEXT,
    cost_used_cents BIGINT,
    cost_limit_cents INTEGER,
    cost_used_dollars NUMERIC(10,2),
    cost_limit_dollars NUMERIC(10,2),
    is_blocked BOOLEAN
) AS $$
DECLARE
    sub_record RECORD;
    monthly_cost BIGINT;
BEGIN
    -- Get subscription record
    SELECT s.cost_limit_cents, s.is_blocked, s.block_reason, s.status
    INTO sub_record
    FROM subscriptions s
    WHERE s.email = user_email;
    
    -- If no subscription found, block (require subscription)
    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 'No subscription found'::TEXT, 0::BIGINT, 0::INTEGER, 0.00::NUMERIC(10,2), 0.00::NUMERIC(10,2), FALSE;
        RETURN;
    END IF;
    
    -- Check if blocked
    IF sub_record.is_blocked THEN
        RETURN QUERY SELECT FALSE, COALESCE(sub_record.block_reason, 'Account blocked by admin')::TEXT, 0::BIGINT, sub_record.cost_limit_cents, 0.00::NUMERIC(10,2), (COALESCE(sub_record.cost_limit_cents, 0) / 100.0)::NUMERIC(10,2), TRUE;
        RETURN;
    END IF;
    
    -- Check if subscription is active
    IF sub_record.status NOT IN ('active', 'trialing') THEN
        RETURN QUERY SELECT FALSE, 'Subscription not active'::TEXT, 0::BIGINT, sub_record.cost_limit_cents, 0.00::NUMERIC(10,2), (COALESCE(sub_record.cost_limit_cents, 0) / 100.0)::NUMERIC(10,2), FALSE;
        RETURN;
    END IF;
    
    -- If no limit set (NULL), allow unlimited
    IF sub_record.cost_limit_cents IS NULL THEN
        RETURN QUERY SELECT TRUE, 'Unlimited'::TEXT, 0::BIGINT, NULL::INTEGER, 0.00::NUMERIC(10,2), NULL::NUMERIC(10,2), FALSE;
        RETURN;
    END IF;
    
    -- Get monthly cost
    SELECT COALESCE(SUM(cost_cents), 0) INTO monthly_cost
    FROM usage_tracking
    WHERE email = user_email
    AND created_at >= date_trunc('month', NOW());
    
    -- Check if within limits
    IF monthly_cost >= sub_record.cost_limit_cents THEN
        RETURN QUERY SELECT FALSE, 'Monthly spending limit reached'::TEXT, monthly_cost, sub_record.cost_limit_cents, (monthly_cost / 100.0)::NUMERIC(10,2), (sub_record.cost_limit_cents / 100.0)::NUMERIC(10,2), FALSE;
        RETURN;
    END IF;
    
    RETURN QUERY SELECT TRUE, 'OK'::TEXT, monthly_cost, sub_record.cost_limit_cents, (monthly_cost / 100.0)::NUMERIC(10,2), (sub_record.cost_limit_cents / 100.0)::NUMERIC(10,2), FALSE;
END;
$$ LANGUAGE plpgsql;

-- Create view for admin to see all user usage with costs
CREATE OR REPLACE VIEW user_usage_summary AS
SELECT 
    s.email,
    s.status,
    s.cost_limit_cents,
    (s.cost_limit_cents / 100.0)::NUMERIC(10,2) as cost_limit_dollars,
    s.is_blocked,
    s.block_reason,
    COALESCE(u.total_cost_cents, 0) as cost_this_month_cents,
    (COALESCE(u.total_cost_cents, 0) / 100.0)::NUMERIC(10,2) as cost_this_month_dollars,
    COALESCE(u.request_count, 0) as requests_this_month,
    COALESCE(u.total_tokens, 0) as tokens_this_month,
    s.current_period_end,
    s.created_at as subscription_created
FROM subscriptions s
LEFT JOIN (
    SELECT 
        email,
        SUM(cost_cents) as total_cost_cents,
        SUM(tokens_total) as total_tokens,
        COUNT(*) as request_count
    FROM usage_tracking
    WHERE created_at >= date_trunc('month', NOW())
    GROUP BY email
) u ON s.email = u.email
ORDER BY u.total_cost_cents DESC NULLS LAST;

-- Grant access to the view
GRANT SELECT ON user_usage_summary TO authenticated;
GRANT SELECT ON user_usage_summary TO service_role;

-- Function to set a user's spending limit (for admin use)
CREATE OR REPLACE FUNCTION set_user_cost_limit(user_email TEXT, limit_dollars NUMERIC)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE subscriptions 
    SET cost_limit_cents = (limit_dollars * 100)::INTEGER
    WHERE email = user_email;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to block/unblock a user (for admin use)
CREATE OR REPLACE FUNCTION set_user_blocked(user_email TEXT, blocked BOOLEAN, reason TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE subscriptions 
    SET is_blocked = blocked,
        block_reason = reason
    WHERE email = user_email;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

