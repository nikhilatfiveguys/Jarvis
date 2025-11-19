# Polar Webhook Events to Enable

## ✅ REQUIRED Events (Enable These)

Only enable these events in your Polar webhook configuration:

1. **`checkout.completed`** - When checkout is actually completed (payment successful)
2. **`order.paid`** - When order payment is confirmed
3. **`subscription.created`** - When Polar creates a subscription (after payment)
4. **`subscription.updated`** - When subscription status changes
5. **`subscription.canceled`** - When subscription is canceled
6. **`subscription.uncanceled`** - When canceled subscription is reactivated

## ❌ DO NOT Enable These Events

These events fire BEFORE payment is completed and will create false subscriptions:

- `checkout.created` - Fires when checkout page opens (NO PAYMENT YET)
- `checkout.updated` - Fires when checkout form is updated (NO PAYMENT YET)
- `order.created` - Fires when order is created (NO PAYMENT YET)
- `order.updated` - Fires when order is updated (NO PAYMENT YET)
- `customer.created` - Fires when customer account is created (NO PAYMENT YET)
- `customer.updated` - Fires when customer info is updated (NO PAYMENT YET)
- All other events - Not needed for subscription management

## How to Update Your Webhook

1. Go to Polar Dashboard → Settings → Webhooks
2. Edit your webhook
3. **Uncheck all events**
4. **Only check these 6 events:**
   - ✅ `checkout.completed`
   - ✅ `order.paid`
   - ✅ `subscription.created`
   - ✅ `subscription.updated`
   - ✅ `subscription.canceled`
   - ✅ `subscription.uncanceled`
5. Save the webhook

This will prevent false subscriptions from being created when users just open the checkout page without paying.







