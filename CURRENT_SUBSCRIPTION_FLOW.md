# Current Subscription Flow (Without Webhooks)

## How Subscriptions Work Right Now

### 1. **App Startup - Local File Check**
When the app starts, it checks for a local file:
- **Location**: `~/Library/Application Support/Jarvis 5.0/subscription_status.json`
- **What it does**: Reads subscription data from this local file
- **Result**: If file exists and has valid data → User is premium
- **Limitation**: This is just cached data, not real-time

### 2. **Subscription Status Check** (`check-subscription-status`)
**Called by**: UI components (paywall, account window, etc.)

**Flow**:
```
User opens app
  ↓
App calls 'check-subscription-status' IPC handler
  ↓
Reads local subscription_status.json file
  ↓
If file exists → Returns premium status
If file doesn't exist → Returns free status
```

**Code location**: `main.js` line ~1271

### 3. **Manual Subscription Check** (`check-subscription-manual`)
**Called by**: When user manually enters their email

**Flow**:
```
User enters email
  ↓
App calls 'check-subscription-manual' IPC handler
  ↓
Queries Supabase by email
  ↓
If subscription found in Supabase → Stores locally + returns premium
If not found → Returns free
```

**Code location**: `main.js` line ~1007
**Uses**: `supabaseIntegration.checkSubscriptionByEmail()`

### 4. **Subscription Validation** (`validateSubscriptionWithPolar`)
**Called by**: Before premium actions, periodic checks

**Flow**:
```
App needs to verify subscription
  ↓
Reads local subscription_status.json
  ↓
Queries Supabase by email (from local file)
  ↓
If found in Supabase → Valid
If not found → Invalid (removes local file)
```

**Code location**: `main.js` line ~1352
**Uses**: `supabaseIntegration.checkSubscriptionByEmail()`

## Current Limitations (Without Webhooks)

### ❌ **Problem 1: No Automatic Sync**
- When someone subscribes via Polar, it's **NOT automatically added to Supabase**
- You have to manually:
  - Add subscription to Supabase, OR
  - User has to enter their email to trigger `check-subscription-manual`

### ❌ **Problem 2: Stale Data**
- Local `subscription_status.json` file can become outdated
- If subscription is canceled in Polar, local file might still say "active"
- Validation only happens periodically or before premium actions

### ❌ **Problem 3: Manual Process**
- New subscriptions require manual intervention
- Cancellations might not be detected immediately
- No real-time updates

## How It Currently Works Step-by-Step

### Scenario 1: User Subscribes via Polar
1. User clicks "Subscribe" → Opens Polar checkout
2. User completes payment → Polar creates subscription
3. **STOPPING POINT**: Subscription exists in Polar, but NOT in Supabase
4. User opens app → App checks local file → No subscription found → Shows free tier
5. **Manual fix needed**: 
   - Option A: User enters email → Triggers `check-subscription-manual` → Queries Supabase → Still not found
   - Option B: You manually add subscription to Supabase
   - Option C: User waits for periodic validation (if implemented)

### Scenario 2: User Already Has Subscription
1. Subscription exists in Supabase (manually added or from previous check)
2. User opens app → App checks local file → If found, shows premium
3. Before premium actions → App validates with Supabase → If valid, allows access

### Scenario 3: Subscription Cancellation
1. User cancels in Polar
2. **STOPPING POINT**: Supabase still shows "active" (no webhook to update it)
3. App still thinks user is premium (local file + Supabase both say active)
4. **Manual fix needed**: Update Supabase manually, or wait for validation check

## What Webhooks Will Fix

### ✅ **With Webhooks Enabled**:

1. **Automatic Sync**: 
   - User subscribes → Polar sends webhook → App receives it → Automatically adds to Supabase
   - No manual intervention needed

2. **Real-time Updates**:
   - Subscription canceled → Webhook received → Supabase updated immediately
   - Local file updated → User sees free tier right away

3. **Always Accurate**:
   - Supabase always reflects current Polar subscription status
   - No stale data issues

## Current Data Flow Diagram

```
┌─────────────┐
│   Polar     │  ← User subscribes here
└──────┬──────┘
       │
       │ (No automatic sync)
       │
       ▼
┌─────────────┐
│  Supabase   │  ← Must be manually updated
└──────┬──────┘
       │
       │ (Queried by app)
       │
       ▼
┌─────────────┐
│ Local File  │  ← Cached subscription data
│ (subscription│
│ _status.json)│
└──────┬──────┘
       │
       │ (Read by app)
       │
       ▼
┌─────────────┐
│    App UI   │  ← Shows premium/free status
└─────────────┘
```

## With Webhooks (Future State)

```
┌─────────────┐
│   Polar     │  ← User subscribes
└──────┬──────┘
       │
       │ Webhook sent automatically
       │
       ▼
┌─────────────┐
│ Webhook     │  ← Receives event
│ Handler     │  ← Syncs to Supabase
└──────┬──────┘
       │
       │ Auto-update
       │
       ▼
┌─────────────┐
│  Supabase   │  ← Always up-to-date
└──────┬──────┘
       │
       │ (Queried by app)
       │
       ▼
┌─────────────┐
│ Local File  │  ← Updated automatically
└──────┬──────┘
       │
       │ (Read by app)
       │
       ▼
┌─────────────┐
│    App UI   │  ← Shows correct status
└─────────────┘
```

## Summary

**Right now (without webhooks)**:
- ✅ App can check Supabase for subscriptions
- ✅ App can validate subscriptions
- ❌ No automatic sync from Polar to Supabase
- ❌ Manual process required for new subscriptions
- ❌ Cancellations might not be detected immediately

**With webhooks**:
- ✅ Automatic sync from Polar to Supabase
- ✅ Real-time updates
- ✅ No manual intervention needed
- ✅ Always accurate subscription status


