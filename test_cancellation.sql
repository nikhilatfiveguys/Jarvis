-- Test cancellation scenarios
-- Run this in Supabase SQL Editor

-- Option 1: Test with status='canceled' (current state)
-- The app should already treat this as no subscription
-- No changes needed - just restart your app

-- Option 2: Test expiration date check
-- Set status back to 'active' but with expired date
UPDATE subscriptions
SET 
    status = 'active',
    current_period_end = NOW() - INTERVAL '1 day',  -- Expired yesterday
    updated_at = NOW()
WHERE email = 'theonlygoated@gmail.com';

-- Verify the update
SELECT 
    email,
    status,
    current_period_start,
    current_period_end,
    CASE 
        WHEN current_period_end < NOW() THEN 'EXPIRED'
        ELSE 'ACTIVE'
    END as subscription_status,
    NOW() as current_time
FROM subscriptions
WHERE email = 'theonlygoated@gmail.com';

-- To reset back to canceled with original date:
-- UPDATE subscriptions
-- SET 
--     status = 'canceled',
--     current_period_end = '2025-12-07 21:54:41.279+00',
--     updated_at = NOW()
-- WHERE email = 'theonlygoated@gmail.com';
