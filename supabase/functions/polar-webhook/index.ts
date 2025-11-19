// Supabase Edge Function to handle Polar webhooks
// This function receives webhook events from Polar and syncs subscriptions to Supabase

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, polar-signature',
};

interface PolarWebhookEvent {
  type: string;
  data: {
    id: string;
    customer?: {
      id: string;
      email?: string;
      email_address?: string;
    };
    customer_id?: string;
    customerId?: string;
    customer_email?: string;
    email?: string;
    subscriptionId?: string;
    subscription_id?: string;
    status?: string;
    current_period_start?: number;
    current_period_end?: number;
    metadata?: {
      email?: string;
      user_email?: string;
    };
    checkout?: {
      customer_email?: string;
      customer?: {
        email?: string;
      };
    };
    subscription?: {
      customer?: {
        email?: string;
      };
    };
  };
}

Deno.serve(async (req: Request) => {
  // Log ALL incoming requests immediately
  console.log('=== WEBHOOK REQUEST RECEIVED ===');
  console.log('Method:', req.method);
  console.log('URL:', req.url);
  console.log('Headers:', JSON.stringify(Object.fromEntries(req.headers.entries()), null, 2));
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    console.log('Handling CORS preflight request');
    return new Response('ok', { headers: corsHeaders });
  }

  // Note: Supabase Edge Functions require auth by default
  // For Polar webhooks, we verify the signature instead
  // The function should be configured to allow public access via Supabase Dashboard
  // OR Polar needs to send requests with anon key in Authorization header

  try {
    // Get request body as text first (for signature verification)
    const bodyText = await req.text();
    console.log('Request body length:', bodyText.length);
    console.log('Request body (first 500 chars):', bodyText.substring(0, 500));
    
    // Verify webhook signature (required for security)
    const signature = req.headers.get('polar-signature');
    const webhookSecret = Deno.env.get('POLAR_WEBHOOK_SECRET');
    
    if (!webhookSecret) {
      console.warn('⚠️ POLAR_WEBHOOK_SECRET not set - webhook signature verification disabled');
    }
    
    if (webhookSecret && signature) {
      const isValid = await verifyPolarSignature(bodyText, signature, webhookSecret);
      
      if (!isValid) {
        console.error('❌ Invalid webhook signature - rejecting webhook');
        return new Response(
          JSON.stringify({ error: 'Invalid signature' }),
          { 
            status: 401, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      } else {
        console.log('✅ Webhook signature verified');
      }
    } else if (webhookSecret && !signature) {
      console.warn('⚠️ Webhook secret configured but no signature header received');
    }

    // Parse webhook event
    const event: PolarWebhookEvent = JSON.parse(bodyText);
    console.log('✅ Successfully parsed webhook event');
    console.log('Event type:', event.type);
    console.log('Full webhook payload:', JSON.stringify(event, null, 2));

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Process the webhook event
    let result;
    switch (event.type) {
      case 'checkout.created':
      case 'checkout.updated':
        // CRITICAL: Don't create subscriptions on checkout.created or checkout.updated
        // These events fire when checkout page is opened/updated, NOT when payment completes
        // Only checkout.completed should create subscriptions (and only after payment verification)
        console.log(`ℹ️ Ignoring ${event.type} event - waiting for checkout.completed with payment verification`);
        result = { success: true, skipped: true, message: `Ignored ${event.type} - payment not completed yet` };
        break;
      case 'checkout.completed':
        // Only process checkout.completed, and verify payment before creating subscription
        result = await handleCheckoutCompleted(event.data, supabase);
        break;
      case 'subscription.created':
      case 'subscription.active':
        // subscription.created means Polar created it, so it's valid - but verify it's actually active
        result = await handleSubscriptionCreated(event.data, supabase);
        break;
      case 'subscription.updated':
        result = await handleSubscriptionUpdated(event.data, supabase);
        break;
      case 'subscription.canceled':
      case 'subscription.cancelled':
        result = await handleSubscriptionCanceled(event.data, supabase);
        break;
      case 'subscription.uncanceled':
        // If subscription is uncanceled, treat it as active
        result = await handleSubscriptionUpdated({ ...event.data, status: 'active' }, supabase);
        break;
      case 'subscription.revoked':
        result = await handleSubscriptionCanceled(event.data, supabase);
        break;
      case 'order.created':
      case 'order.updated':
        // CRITICAL: Don't create subscriptions on order.created or order.updated
        // Only order.paid means payment was actually completed
        console.log(`ℹ️ Ignoring ${event.type} event - waiting for order.paid with payment verification`);
        result = { success: true, skipped: true, message: `Ignored ${event.type} - payment not completed yet` };
        break;
      case 'order.paid':
        // When order is paid, verify payment and create subscription
        result = await handleCheckoutCompleted(event.data, supabase);
        break;
      default:
        console.log('Unhandled webhook event type:', event.type);
        result = { success: true, message: 'Event type not handled' };
    }

    return new Response(
      JSON.stringify(result),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('Error processing webhook:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

/**
 * Verify Polar webhook signature
 */
async function verifyPolarSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    // Polar uses HMAC SHA256
    // Signature format is typically: sha256=<hex_signature>
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const payloadData = encoder.encode(payload);
    
    // Import key for HMAC
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    
    // Generate signature
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, payloadData);
    const signatureArray = Array.from(new Uint8Array(signatureBuffer));
    const expectedSignature = signatureArray
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    // Compare signatures (Polar format: sha256=<hex>)
    const normalizedSignature = signature.replace('sha256=', '');
    return normalizedSignature === expectedSignature;
  } catch (error) {
    console.error('Error verifying signature:', error);
    // If verification fails, you might want to allow it for testing
    // In production, return false
    return false;
  }
}

/**
 * Extract email from Polar webhook event data
 * Tries multiple possible locations where email might be stored
 */
function extractEmail(data: PolarWebhookEvent['data']): string | null {
  // Try various possible locations for email
  const email = 
    data.customer?.email ||
    data.customer?.email_address ||
    data.customer_email ||
    data.email ||
    data.metadata?.email ||
    data.metadata?.user_email ||
    data.checkout?.customer_email ||
    data.checkout?.customer?.email ||
    data.subscription?.customer?.email ||
    null;
  
  console.log('Extracted email:', email || 'NOT FOUND');
  console.log('Email extraction locations checked:', {
    'data.customer?.email': data.customer?.email,
    'data.customer?.email_address': data.customer?.email_address,
    'data.customer_email': data.customer_email,
    'data.email': data.email,
    'data.metadata?.email': data.metadata?.email,
    'data.metadata?.user_email': data.metadata?.user_email,
    'data.checkout?.customer_email': data.checkout?.customer_email,
    'data.checkout?.customer?.email': data.checkout?.customer?.email,
    'data.subscription?.customer?.email': data.subscription?.customer?.email,
  });
  
  return email;
}

/**
 * Fetch customer email from Polar API using customer ID
 */
async function fetchCustomerEmailFromPolar(customerId: string): Promise<string | null> {
  try {
    const polarAccessToken = Deno.env.get('POLAR_ACCESS_TOKEN');
    if (!polarAccessToken) {
      console.warn('POLAR_ACCESS_TOKEN not set - cannot fetch customer email from API');
      return null;
    }
    
    const polarApiUrl = Deno.env.get('POLAR_API_URL') || 'https://api.polar.sh/v1';
    const response = await fetch(`${polarApiUrl}/customers/${customerId}`, {
      headers: {
        'Authorization': `Bearer ${polarAccessToken}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      console.error('Failed to fetch customer from Polar API:', response.status, response.statusText);
      return null;
    }
    
    const customer = await response.json();
    const email = customer.email || customer.email_address || null;
    console.log('✅ Fetched customer email from Polar API:', email);
    return email;
  } catch (error) {
    console.error('Error fetching customer email from Polar API:', error);
    return null;
  }
}

/**
 * Fetch customer email from Polar API using checkout ID
 * Sometimes checkout events don't include customer directly, so we fetch the checkout first
 */
async function fetchEmailFromCheckout(checkoutId: string): Promise<string | null> {
  try {
    const polarAccessToken = Deno.env.get('POLAR_ACCESS_TOKEN');
    if (!polarAccessToken) {
      console.warn('POLAR_ACCESS_TOKEN not set - cannot fetch checkout from API');
      return null;
    }
    
    const polarApiUrl = Deno.env.get('POLAR_API_URL') || 'https://api.polar.sh/v1';
    
    // First, fetch the checkout to get customer ID
    const checkoutResponse = await fetch(`${polarApiUrl}/checkouts/${checkoutId}`, {
      headers: {
        'Authorization': `Bearer ${polarAccessToken}`,
        'Content-Type': 'application/json',
      },
    });
    
    if (!checkoutResponse.ok) {
      console.error('Failed to fetch checkout from Polar API:', checkoutResponse.status, checkoutResponse.statusText);
      return null;
    }
    
    const checkout = await checkoutResponse.json();
    console.log('Checkout data from API:', JSON.stringify(checkout, null, 2));
    
    // Try to get email from checkout directly
    if (checkout.customer_email) {
      return checkout.customer_email;
    }
    
    // Otherwise, get customer ID and fetch customer
    const customerId = checkout.customer_id || checkout.customer?.id;
    if (customerId) {
      return await fetchCustomerEmailFromPolar(customerId);
    }
    
    return null;
  } catch (error) {
    console.error('Error fetching email from checkout:', error);
    return null;
  }
}

/**
 * Verify checkout was actually paid via Polar API
 */
async function verifyCheckoutPayment(checkoutId: string): Promise<{ isPaid: boolean; checkout?: any; error?: string }> {
  const polarAccessToken = Deno.env.get('POLAR_ACCESS_TOKEN');
  const polarApiUrl = 'https://api.polar.sh/v1';

  if (!polarAccessToken) {
    console.warn('POLAR_ACCESS_TOKEN not set - cannot verify checkout payment');
    return { isPaid: false, error: 'POLAR_ACCESS_TOKEN not configured' };
  }

  try {
    console.log('Verifying checkout payment status via Polar API:', checkoutId);
    
    const response = await fetch(`${polarApiUrl}/checkouts/${checkoutId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${polarAccessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error('Failed to fetch checkout from Polar API:', response.status, response.statusText);
      return { isPaid: false, error: `Polar API error: ${response.status}` };
    }

    const checkout = await response.json();
    console.log('Checkout status from Polar API:', checkout.status);
    console.log('Full checkout data:', JSON.stringify(checkout, null, 2));

    // CRITICAL: Only consider checkout paid if status is 'complete', 'completed', or 'succeeded'
    // Polar checkout statuses: 'open', 'complete', 'completed', 'succeeded', 'expired', 'canceled'
    const status = checkout.status?.toLowerCase() || '';
    const isPaid = status === 'complete' || status === 'completed' || status === 'succeeded';

    if (!isPaid) {
      console.warn('⚠️ Checkout not paid - status:', checkout.status);
      return { 
        isPaid: false, 
        checkout: checkout,
        error: `Checkout status is "${checkout.status}", not completed/succeeded` 
      };
    }

    console.log('✅ Checkout verified as paid');
    return { isPaid: true, checkout: checkout };
  } catch (error) {
    console.error('❌ Error verifying checkout payment:', error);
    return { isPaid: false, error: error.message || 'Unknown error' };
  }
}

/**
 * Handle checkout completed event
 * CRITICAL: This only creates subscription if payment was actually completed
 */
async function handleCheckoutCompleted(
  data: PolarWebhookEvent['data'],
  supabase: any
) {
  console.log('Processing checkout.completed:', data.id);
  console.log('Checkout data structure:', JSON.stringify(data, null, 2));

  // CRITICAL: Verify checkout was actually paid before creating subscription
  const checkoutId = data.id;
  const verification = await verifyCheckoutPayment(checkoutId);
  
  if (!verification.isPaid) {
    console.error('❌ Checkout not paid - refusing to create subscription:', verification.error);
    console.error('Checkout status:', verification.checkout?.status);
    return { 
      success: false, 
      error: `Payment not completed: ${verification.error || 'Checkout status invalid'}`,
      skipped: true 
    };
  }

  console.log('✅ Checkout verified as paid, proceeding with subscription creation');

  // Try to extract email from webhook data
  let email = extractEmail(data);
  
  // If email not found, try multiple strategies:
  if (!email) {
    // Strategy 1: Fetch from Polar API using customer ID
    const customerId = data.customer?.id || data.customer_id || data.customerId;
    if (customerId) {
      console.log('Email not in webhook, fetching from Polar API using customer ID:', customerId);
      email = await fetchCustomerEmailFromPolar(customerId);
    }
    
    // Strategy 2: For checkout events, fetch checkout details first
    if (!email && data.id) {
      console.log('Email still not found, trying to fetch from checkout ID:', data.id);
      email = await fetchEmailFromCheckout(data.id);
    }
  }
  
  if (!email) {
    console.error('❌ No email found in webhook data and could not fetch from API');
    console.error('Available data keys:', Object.keys(data));
    return { success: false, error: 'No email found in webhook data' };
  }
  
  console.log('✅ Final extracted email:', email);

  // Get customer ID for reference
  const customerId = data.customer?.id || data.customer_id || data.customerId;
  const subscriptionId = data.subscriptionId || data.subscription_id || data.id;
  
  console.log('Subscription details:', {
    email,
    customerId,
    subscriptionId,
    status: 'active'
  });

  const subscriptionData = {
    email: email,
    status: 'active',
    polar_subscription_id: subscriptionId,
    polar_customer_id: customerId,
    current_period_start: new Date().toISOString(),
    current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };

  console.log('Attempting to upsert subscription data:', JSON.stringify(subscriptionData, null, 2));

  const { data: result, error } = await supabase
    .from('subscriptions')
    .upsert(subscriptionData, {
      onConflict: 'email',
      ignoreDuplicates: false,
    })
    .select()
    .single();

  if (error) {
    console.error('❌ Error syncing checkout to Supabase:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
    console.error('Subscription data that failed:', JSON.stringify(subscriptionData, null, 2));
    return { success: false, error: error.message, details: error };
  }

  console.log('✅ Checkout synced to Supabase:', result.id);
  console.log('✅ Synced subscription data:', JSON.stringify(result, null, 2));
  return { success: true, subscription: result };
}

/**
 * Handle subscription created event
 */
async function handleSubscriptionCreated(
  data: PolarWebhookEvent['data'],
  supabase: any
) {
  console.log('Processing subscription.created:', data.id);
  console.log('Subscription data structure:', JSON.stringify(data, null, 2));

  // Try to extract email from webhook data
  let email = extractEmail(data);
  
  // If email not found, try to fetch from Polar API using customer ID
  if (!email) {
    const customerId = data.customer?.id || data.customer_id || data.customerId;
    if (customerId) {
      console.log('Email not in webhook, fetching from Polar API using customer ID:', customerId);
      email = await fetchCustomerEmailFromPolar(customerId);
    }
  }
  
  if (!email) {
    console.error('❌ No email found in webhook data and could not fetch from API');
    console.error('Available data keys:', Object.keys(data));
    return { success: false, error: 'No email found in webhook data' };
  }

  // Helper function to parse dates (handles both Unix timestamps and ISO strings)
  const parseDate = (dateValue: any): string => {
    if (!dateValue) return new Date().toISOString();
    // If it's already an ISO string, use it directly
    if (typeof dateValue === 'string' && dateValue.includes('T')) {
      return new Date(dateValue).toISOString();
    }
    // If it's a number (Unix timestamp), convert it
    if (typeof dateValue === 'number') {
      return new Date(dateValue * 1000).toISOString();
    }
    return new Date().toISOString();
  };

  const subscriptionData = {
    email: email,
    status: data.status === 'active' || data.status === 'trialing' ? 'active' : data.status || 'active',
    polar_subscription_id: data.id,
    polar_customer_id: data.customer?.id || data.customerId,
    current_period_start: parseDate(data.current_period_start),
    current_period_end: parseDate(data.current_period_end) || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };

  console.log('Attempting to upsert subscription data:', JSON.stringify(subscriptionData, null, 2));

  const { data: result, error } = await supabase
    .from('subscriptions')
    .upsert(subscriptionData, {
      onConflict: 'email',
      ignoreDuplicates: false,
    })
    .select()
    .single();

  if (error) {
    console.error('❌ Error syncing subscription created to Supabase:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
    console.error('Subscription data that failed:', JSON.stringify(subscriptionData, null, 2));
    return { success: false, error: error.message, details: error };
  }

  console.log('✅ Subscription created synced to Supabase:', result.id);
  console.log('✅ Synced subscription data:', JSON.stringify(result, null, 2));
  return { success: true, subscription: result };
}

/**
 * Handle subscription updated event
 */
async function handleSubscriptionUpdated(
  data: PolarWebhookEvent['data'],
  supabase: any
) {
  console.log('Processing subscription.updated:', data.id);
  console.log('Subscription update data structure:', JSON.stringify(data, null, 2));

  // Try to extract email from webhook data
  let email = extractEmail(data);
  
  // If email not found, try to fetch from Polar API using customer ID
  if (!email) {
    const customerId = data.customer?.id || data.customer_id || data.customerId;
    if (customerId) {
      console.log('Email not in webhook, fetching from Polar API using customer ID:', customerId);
      email = await fetchCustomerEmailFromPolar(customerId);
    }
  }
  
  if (!email) {
    console.error('❌ No email found in webhook data and could not fetch from API');
    console.error('Available data keys:', Object.keys(data));
    return { success: false, error: 'No email found in webhook data' };
  }

  // Helper function to parse dates (handles both Unix timestamps and ISO strings)
  const parseDate = (dateValue: any): string => {
    if (!dateValue) return new Date().toISOString();
    // If it's already an ISO string, use it directly
    if (typeof dateValue === 'string' && dateValue.includes('T')) {
      return new Date(dateValue).toISOString();
    }
    // If it's a number (Unix timestamp), convert it
    if (typeof dateValue === 'number') {
      return new Date(dateValue * 1000).toISOString();
    }
    return new Date().toISOString();
  };

  const subscriptionData = {
    email: email,
    status: data.status === 'active' || data.status === 'trialing' ? 'active' : data.status || 'active',
    polar_subscription_id: data.id,
    polar_customer_id: data.customer?.id || data.customerId,
    current_period_start: parseDate(data.current_period_start),
    current_period_end: parseDate(data.current_period_end) || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };

  console.log('Attempting to upsert subscription data:', JSON.stringify(subscriptionData, null, 2));

  const { data: result, error } = await supabase
    .from('subscriptions')
    .upsert(subscriptionData, {
      onConflict: 'email',
      ignoreDuplicates: false,
    })
    .select()
    .single();

  if (error) {
    console.error('❌ Error syncing subscription updated to Supabase:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
    console.error('Subscription data that failed:', JSON.stringify(subscriptionData, null, 2));
    return { success: false, error: error.message, details: error };
  }

  console.log('✅ Subscription updated synced to Supabase:', result.id);
  console.log('✅ Synced subscription data:', JSON.stringify(result, null, 2));
  return { success: true, subscription: result };
}

/**
 * Handle subscription canceled event
 */
async function handleSubscriptionCanceled(
  data: PolarWebhookEvent['data'],
  supabase: any
) {
  console.log('Processing subscription.canceled:', data.id);
  console.log('Subscription cancel data structure:', JSON.stringify(data, null, 2));

  // Try to extract email from webhook data
  let email = extractEmail(data);
  
  // If email not found, try to fetch from Polar API using customer ID
  if (!email) {
    const customerId = data.customer?.id || data.customer_id || data.customerId;
    if (customerId) {
      console.log('Email not in webhook, fetching from Polar API using customer ID:', customerId);
      email = await fetchCustomerEmailFromPolar(customerId);
    }
  }
  
  if (!email) {
    console.error('❌ No email found in webhook data and could not fetch from API');
    console.error('Available data keys:', Object.keys(data));
    return { success: false, error: 'No email found in webhook data' };
  }

  console.log('Attempting to cancel subscription for email:', email);

  const { data: result, error } = await supabase
    .from('subscriptions')
    .update({
      status: 'canceled',
      updated_at: new Date().toISOString(),
    })
    .eq('email', email)
    .select()
    .single();

  if (error) {
    console.error('❌ Error syncing subscription canceled to Supabase:', error);
    console.error('Error details:', JSON.stringify(error, null, 2));
    console.error('Email that failed:', email);
    return { success: false, error: error.message, details: error };
  }

  if (!result) {
    console.warn('⚠️ No subscription found to cancel for email:', email);
    return { success: false, error: 'No subscription found with that email' };
  }

  console.log('✅ Subscription canceled synced to Supabase:', result.id);
  console.log('✅ Canceled subscription data:', JSON.stringify(result, null, 2));
  return { success: true, subscription: result };
}

