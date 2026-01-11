-- SQL to remove your subscription from Supabase
-- Run this in Supabase SQL Editor

-- Option 1: Delete all subscriptions (for testing)
DELETE FROM subscriptions;

-- Option 2: Delete subscription for a specific email (replace with your email)
-- DELETE FROM subscriptions WHERE email = 'your-email@example.com';

-- Option 3: Just mark as canceled (keeps the record)
-- UPDATE subscriptions SET status = 'canceled' WHERE email = 'your-email@example.com';


