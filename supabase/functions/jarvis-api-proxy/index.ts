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
    // Log incoming request for debugging
    const authHeader = req.headers.get('Authorization')
    const apiKeyHeader = req.headers.get('apikey')
    console.log(`📥 Request received:`, {
      method: req.method,
      hasAuthHeader: !!authHeader,
      hasApiKeyHeader: !!apiKeyHeader,
      authHeaderPrefix: authHeader ? authHeader.substring(0, 50) + '...' : 'none',
      apiKeyHeaderPrefix: apiKeyHeader ? apiKeyHeader.substring(0, 50) + '...' : 'none',
      url: req.url
    })

    // Verify authentication - accept either Authorization or apikey header
    // Supabase Edge Functions can be called with either header
    if (!authHeader && !apiKeyHeader) {
      console.error('❌ Missing both Authorization and apikey headers')
      return new Response(
        JSON.stringify({ 
          error: 'Missing Authorization header',
          details: 'Both Authorization and apikey headers are missing'
        }),
        { 
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }
    
    // Log that authentication passed
    console.log('✅ Authentication headers present')

    // Get API keys from Supabase Secrets
    const openaiKey = Deno.env.get('OPENAI_API_KEY')
    const perplexityKey = Deno.env.get('PPLX_API_KEY')
    const claudeKey = Deno.env.get('CLAUDE_API_KEY')
    
    console.log(`🔑 API Keys check:`, {
      hasOpenAI: !!openaiKey,
      hasPerplexity: !!perplexityKey,
      hasClaude: !!claudeKey,
      perplexityKeyPrefix: perplexityKey ? perplexityKey.substring(0, 10) + '...' : 'MISSING'
    })

    if (!openaiKey && !perplexityKey && !claudeKey) {
      throw new Error('No API keys configured in Supabase Secrets')
    }

    const body = await req.json()
    const { provider, endpoint, payload } = body
    
    // Log for debugging (remove sensitive data in production)
    console.log(`📥 Received request for provider: ${provider}`)

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
          console.error('❌ Perplexity API key not found in Supabase Secrets')
          throw new Error('Perplexity API key not configured in Supabase Secrets')
        }
        console.log('✅ Using Perplexity API key from Supabase Secrets')
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
      console.error(`❌ API Error (${provider}):`, {
        status: response.status,
        statusText: response.statusText,
        error: errorText.substring(0, 500),
        apiKeyPresent: !!apiKey,
        apiKeyPrefix: apiKey ? apiKey.substring(0, 10) + '...' : 'MISSING'
      })
      return new Response(
        JSON.stringify({ 
          error: `API request failed: ${response.status}`,
          details: errorText,
          provider: provider
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

