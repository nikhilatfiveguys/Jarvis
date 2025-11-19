// Supabase Edge Function: Jarvis API Proxy
// This function proxies API calls to OpenAI, Perplexity, and Claude
// API keys are stored securely in Supabase Secrets

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get API keys from Supabase Secrets
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    const perplexityKey = Deno.env.get('PPLX_API_KEY')
    const claudeKey = Deno.env.get('CLAUDE_API_KEY')

    if (!openaiKey && !perplexityKey && !claudeKey) {
      throw new Error('No API keys configured in Supabase Secrets')
    }

    const { provider, endpoint, payload } = await req.json()

    let apiUrl = ''
    let apiKey = ''
    let headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Route to the correct API provider
    switch (provider) {
      case 'openai':
        if (!openaiKey) {
          throw new Error('OpenAI API key not configured')
        }
        apiUrl = `https://api.openai.com/v1/${endpoint || 'responses'}`
        apiKey = openaiKey
        headers['Authorization'] = `Bearer ${apiKey}`
        break

      case 'perplexity':
        if (!perplexityKey) {
          throw new Error('Perplexity API key not configured')
        }
        apiUrl = 'https://api.perplexity.ai/chat/completions'
        apiKey = perplexityKey
        headers['Authorization'] = `Bearer ${apiKey}`
        break

      case 'claude':
        if (!claudeKey) {
          throw new Error('Claude API key not configured')
        }
        apiUrl = 'https://api.anthropic.com/v1/messages'
        apiKey = claudeKey
        headers['x-api-key'] = apiKey
        headers['anthropic-version'] = '2023-06-01'
        break

      default:
        throw new Error(`Unknown provider: ${provider}`)
    }

    // Make the API call
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`API Error (${provider}):`, response.status, errorText)
      return new Response(
        JSON.stringify({ 
          error: `API request failed: ${response.status}`,
          details: errorText 
        }),
        { 
          status: response.status,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    const data = await response.json()

    return new Response(
      JSON.stringify(data),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Edge Function Error:', error)
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Internal server error' 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

