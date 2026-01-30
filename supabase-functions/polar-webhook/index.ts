// Supabase Edge Function for Polar Webhooks
// Deploy with: supabase functions deploy polar-webhook
// Set webhook URL in Polar dashboard to: https://[your-project].supabase.co/functions/v1/polar-webhook

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, polar-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Initialize Supabase client with service role key
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const polarAccessToken = Deno.env.get('POLAR_ACCESS_TOKEN')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Get webhook body
    const body = await req.text()
    const signature = req.headers.get('polar-signature')
    
    // TODO: Verify webhook signature here if needed
    // For now, we'll trust requests to this endpoint (you should add signature verification)
    
    const event = JSON.parse(body)
    console.log('Received Polar webhook:', event.type, event.data?.id)

    // Handle subscription.updated event
    if (event.type === 'subscription.updated') {
      const subscriptionId = event.data?.id
      
      if (!subscriptionId) {
        return new Response(
          JSON.stringify({ success: false, error: 'Missing subscription ID' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      // Fetch full subscription details from Polar API
      console.log('Fetching subscription from Polar API:', subscriptionId)
      const polarResponse = await fetch(`https://api.polar.sh/v1/subscriptions/${subscriptionId}`, {
        headers: {
          'Authorization': `Bearer ${polarAccessToken}`,
          'Content-Type': 'application/json'
        }
      })

      if (!polarResponse.ok) {
        const errorText = await polarResponse.text()
        console.error('Polar API error:', errorText)
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to fetch subscription from Polar' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
      }

      const polarSubscription = await polarResponse.json()
      console.log('Fetched subscription from Polar:', {
        id: polarSubscription.id,
        status: polarSubscription.status,
        current_period_start: polarSubscription.current_period_start,
        current_period_end: polarSubscription.current_period_end
      })

      // Get customer email
      let email = polarSubscription.customer?.email || event.data?.customer?.email || event.data?.metadata?.email
      
      // If no email, fetch customer details
      if (!email && polarSubscription.customer?.id) {
        try {
          const customerResponse = await fetch(`https://api.polar.sh/v1/customers/${polarSubscription.customer.id}`, {
            headers: {
              'Authorization': `Bearer ${polarAccessToken}`,
              'Content-Type': 'application/json'
            }
          })
          
          if (customerResponse.ok) {
            const customer = await customerResponse.json()
            email = customer.email
          }
        } catch (customerError) {
          console.warn('Could not fetch customer email:', customerError)
        }
      }

      if (!email) {
        console.error('No email found for subscription:', subscriptionId)
        return new Response(
          JSON.stringify({ success: false, error: 'No email found for subscription' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      // Parse dates - Polar returns ISO 8601 strings
      let currentPeriodStart: string
      let currentPeriodEnd: string

      if (polarSubscription.current_period_start) {
        if (typeof polarSubscription.current_period_start === 'string') {
          currentPeriodStart = new Date(polarSubscription.current_period_start).toISOString()
        } else {
          // Unix timestamp
          currentPeriodStart = new Date(polarSubscription.current_period_start * 1000).toISOString()
        }
      } else {
        currentPeriodStart = new Date().toISOString()
      }

      if (polarSubscription.current_period_end) {
        if (typeof polarSubscription.current_period_end === 'string') {
          currentPeriodEnd = new Date(polarSubscription.current_period_end).toISOString()
        } else {
          // Unix timestamp
          currentPeriodEnd = new Date(polarSubscription.current_period_end * 1000).toISOString()
        }
      } else {
        // Default to 30 days from now if not provided
        currentPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      }

      // Normalize email (lowercase, trimmed)
      email = email.toLowerCase().trim()

      // Update or insert subscription in Supabase
      const subscriptionData = {
        email: email,
        status: polarSubscription.status === 'active' || polarSubscription.status === 'trialing' ? 'active' : polarSubscription.status,
        polar_subscription_id: polarSubscription.id,
        polar_customer_id: polarSubscription.customer?.id || event.data?.customer?.id || event.data?.customerId,
        current_period_start: currentPeriodStart,
        current_period_end: currentPeriodEnd,
        updated_at: new Date().toISOString()
      }

      console.log('Updating subscription in Supabase:', subscriptionData)

      // Use upsert to update or insert
      const { data: existingSub, error: findError } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('email', email)
        .maybeSingle()

      if (findError && findError.code !== 'PGRST116') {
        console.error('Error finding subscription:', findError)
        return new Response(
          JSON.stringify({ success: false, error: 'Database error' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
      }

      let result
      if (existingSub) {
        // Update existing subscription
        result = await supabase
          .from('subscriptions')
          .update(subscriptionData)
          .eq('email', email)
      } else {
        // Insert new subscription
        subscriptionData.created_at = new Date().toISOString()
        result = await supabase
          .from('subscriptions')
          .insert(subscriptionData)
      }

      if (result.error) {
        console.error('Error updating subscription:', result.error)
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to update subscription' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
      }

      console.log('✅ Subscription updated in Supabase successfully')
      return new Response(
        JSON.stringify({ success: true, message: 'Subscription updated' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Handle subscription.created event
    if (event.type === 'subscription.created') {
      // Similar logic to subscription.updated
      // For now, we'll just log it
      console.log('Subscription created event received:', event.data?.id)
      return new Response(
        JSON.stringify({ success: true, message: 'Event received' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Handle subscription.canceled event
    if (event.type === 'subscription.canceled') {
      const subscriptionId = event.data?.id
      let email = event.data?.customer?.email || event.data?.metadata?.email

      if (!email && event.data?.customer?.id) {
        try {
          const customerResponse = await fetch(`https://api.polar.sh/v1/customers/${event.data.customer.id}`, {
            headers: {
              'Authorization': `Bearer ${polarAccessToken}`,
              'Content-Type': 'application/json'
            }
          })
          
          if (customerResponse.ok) {
            const customer = await customerResponse.json()
            email = customer.email
          }
        } catch (customerError) {
          console.warn('Could not fetch customer email:', customerError)
        }
      }

      if (email) {
        email = email.toLowerCase().trim()
        
        const { error: cancelError } = await supabase
          .from('subscriptions')
          .update({
            status: 'canceled',
            updated_at: new Date().toISOString()
          })
          .eq('email', email)

        if (cancelError) {
          console.error('Error canceling subscription:', cancelError)
        } else {
          console.log('✅ Subscription canceled in Supabase')
        }
      }

      return new Response(
        JSON.stringify({ success: true, message: 'Subscription canceled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Unhandled event type
    console.log('Unhandled webhook event type:', event.type)
    return new Response(
      JSON.stringify({ success: true, message: 'Event received but not processed' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error processing webhook:', error)
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})
