# Polar Webhook Events Configuration

## Required Events to Check ✅

Based on your Edge Function, you should check these events:

### Essential Events (Must Have):
- ✅ **subscription.created** - When a new subscription is created
- ✅ **subscription.active** - When subscription becomes active
- ✅ **subscription.updated** - When subscription is updated (billing, status, etc.)
- ✅ **subscription.canceled** - When subscription is canceled
- ✅ **subscription.uncanceled** - When a canceled subscription is reactivated
- ✅ **subscription.revoked** - When subscription is revoked/terminated

### Recommended Events:
- ✅ **checkout.created** - When checkout is created
- ✅ **checkout.updated** - When checkout is updated
- ✅ **order.paid** - When order/payment is completed

### Optional Events (Not Required):
- ⚠️ **customer.created** - Optional (if you want to track customers)
- ⚠️ **customer.updated** - Optional (if you want to track customers)
- ⚠️ **order.created** - Optional (if you want to track orders)
- ⚠️ **order.refunded** - Optional (if you want to handle refunds)

## Minimum Required Events

At minimum, check these:
1. ✅ `subscription.created`
2. ✅ `subscription.active`
3. ✅ `subscription.updated`
4. ✅ `subscription.canceled`
5. ✅ `subscription.uncanceled`
6. ✅ `checkout.created` (or `order.paid`)

## Webhook URL

Make sure the URL is complete:
```
https://nbmnbgouiammxpkbyaxj.supabase.co/functions/v1/polar-webhook
```

(It looks truncated in the image - make sure `/polar-webhook` is at the end)

## Format

**Raw** format is correct ✅ - That's what the Edge Function expects.

## What Happens When Each Event is Received

| Event | Action |
|-------|--------|
| `subscription.created` | Creates subscription in Supabase |
| `subscription.active` | Creates/updates subscription as active |
| `subscription.updated` | Updates subscription in Supabase |
| `subscription.canceled` | Marks subscription as canceled |
| `subscription.uncanceled` | Marks subscription as active again |
| `subscription.revoked` | Marks subscription as canceled |
| `checkout.created` | Creates subscription (when payment completes) |
| `order.paid` | Creates subscription (when order is paid) |

## Testing

After saving the webhook:
1. Create a test subscription in Polar
2. Check Supabase Edge Function logs
3. Check Supabase `subscriptions` table
4. Verify subscription was created/updated


