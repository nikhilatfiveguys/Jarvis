// Supabase Edge Function for Password Reset
// Deploy with: supabase functions deploy password-reset

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const url = new URL(req.url)
    const action = url.pathname.split('/').pop() // send, verify, or reset
    const body = await req.json()

    // Initialize Supabase client with service role key for admin operations
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const resendApiKey = Deno.env.get('RESEND_API_KEY')!
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    if (action === 'send') {
      // Send reset code
      const { email } = body
      
      if (!email) {
        return new Response(
          JSON.stringify({ success: false, error: 'Email is required' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      // Check if user exists
      const { data: user, error: userError } = await supabase
        .from('subscriptions')
        .select('id, email')
        .eq('email', email)
        .single()

      if (userError || !user) {
        return new Response(
          JSON.stringify({ success: false, error: 'No account found with this email' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
        )
      }

      // Generate 6-digit code
      const resetCode = Math.floor(100000 + Math.random() * 900000).toString()
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

      // Store code in database
      const { error: updateError } = await supabase
        .from('subscriptions')
        .update({ 
          reset_token: resetCode, 
          reset_token_expires: expiresAt,
          updated_at: new Date().toISOString()
        })
        .eq('email', email)

      if (updateError) {
        console.error('Update error:', updateError)
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to generate reset code' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
      }

      // Send email via Resend
      const emailResponse = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: 'noreply@yesjarvis.com',
          to: email,
          subject: 'Jarvis - Password Reset Code',
          html: `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
              <div style="text-align: center; margin-bottom: 30px;">
                <h1 style="color: #6366f1; margin: 0; font-size: 28px;">Jarvis</h1>
              </div>
              <div style="background: #1a1a1a; border-radius: 16px; padding: 32px; color: #ffffff;">
                <h2 style="margin: 0 0 16px 0; font-size: 20px; color: #ffffff;">Password Reset</h2>
                <p style="color: #a0a0a0; font-size: 14px; line-height: 1.6; margin: 0 0 24px 0;">
                  You requested to reset your password. Use the code below to set a new password:
                </p>
                <div style="background: #2a2a2a; border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
                  <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #6366f1;">${resetCode}</span>
                </div>
                <p style="color: #666666; font-size: 12px; margin: 0;">
                  This code expires in 15 minutes. If you didn't request this, you can ignore this email.
                </p>
              </div>
              <p style="text-align: center; color: #666666; font-size: 12px; margin-top: 24px;">
                © ${new Date().getFullYear()} Jarvis AI Assistant
              </p>
            </div>
          `
        })
      })

      if (!emailResponse.ok) {
        const errorData = await emailResponse.text()
        console.error('Resend error:', errorData)
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to send email' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )

    } else if (action === 'verify') {
      // Verify reset code
      const { email, code } = body

      if (!email || !code) {
        return new Response(
          JSON.stringify({ success: false, error: 'Email and code are required' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      const { data, error } = await supabase
        .from('subscriptions')
        .select('reset_token, reset_token_expires')
        .eq('email', email)
        .single()

      if (error || !data) {
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to verify code' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
      }

      if (!data.reset_token) {
        return new Response(
          JSON.stringify({ success: false, error: 'No reset code found. Please request a new one.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      const expiresAt = new Date(data.reset_token_expires)
      if (expiresAt < new Date()) {
        return new Response(
          JSON.stringify({ success: false, error: 'Code has expired. Please request a new one.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      if (data.reset_token !== code) {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid code. Please try again.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )

    } else if (action === 'reset') {
      // Reset password
      const { email, code, password } = body

      if (!email || !code || !password) {
        return new Response(
          JSON.stringify({ success: false, error: 'Email, code, and password are required' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      if (password.length < 6) {
        return new Response(
          JSON.stringify({ success: false, error: 'Password must be at least 6 characters' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      // Verify code first
      const { data, error: verifyError } = await supabase
        .from('subscriptions')
        .select('reset_token, reset_token_expires')
        .eq('email', email)
        .single()

      if (verifyError || !data || !data.reset_token || data.reset_token !== code) {
        return new Response(
          JSON.stringify({ success: false, error: 'Invalid or expired code' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      const expiresAt = new Date(data.reset_token_expires)
      if (expiresAt < new Date()) {
        return new Response(
          JSON.stringify({ success: false, error: 'Code has expired' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        )
      }

      // Hash password using Web Crypto API (SHA-256)
      const encoder = new TextEncoder()
      const data_buffer = encoder.encode(password)
      const hash_buffer = await crypto.subtle.digest('SHA-256', data_buffer)
      const hash_array = Array.from(new Uint8Array(hash_buffer))
      const passwordHash = hash_array.map(b => b.toString(16).padStart(2, '0')).join('')

      // Update password and clear reset token
      const { error: updateError } = await supabase
        .from('subscriptions')
        .update({
          password_hash: passwordHash,
          reset_token: null,
          reset_token_expires: null,
          updated_at: new Date().toISOString()
        })
        .eq('email', email)

      if (updateError) {
        return new Response(
          JSON.stringify({ success: false, error: 'Failed to reset password' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        )
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )

    } else {
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid action' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      )
    }

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ success: false, error: 'Internal server error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    )
  }
})



