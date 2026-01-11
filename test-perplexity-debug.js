#!/usr/bin/env node
// Test script to debug Perplexity API issues
// Run with: node test-perplexity-debug.js

const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function testPerplexityAPI() {
    console.log('🔍 Perplexity API Debug Test\n');
    console.log('='.repeat(50));
    
    // Check environment variables
    const pplxKey = process.env.PPLX_API_KEY;
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    
    console.log('\n📋 Configuration Check:');
    console.log(`  PPLX_API_KEY: ${pplxKey ? pplxKey.substring(0, 10) + '...' : '❌ NOT SET'}`);
    console.log(`  SUPABASE_URL: ${supabaseUrl || '❌ NOT SET'}`);
    console.log(`  SUPABASE_ANON_KEY: ${supabaseAnonKey ? supabaseAnonKey.substring(0, 10) + '...' : '❌ NOT SET'}`);
    
    // Test direct API call
    if (pplxKey) {
        console.log('\n🧪 Testing Direct Perplexity API Call...');
        try {
            const response = await fetch('https://api.perplexity.ai/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${pplxKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'sonar-pro',
                    messages: [
                        {
                            role: 'system',
                            content: 'Be precise and concise.'
                        },
                        {
                            role: 'user',
                            content: 'What is the capital of France?'
                        }
                    ]
                })
            });
            
            console.log(`  Status: ${response.status} ${response.statusText}`);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.log(`  ❌ Error Response: ${errorText.substring(0, 300)}`);
                
                try {
                    const errorData = JSON.parse(errorText);
                    console.log(`  Error Details:`, JSON.stringify(errorData, null, 2));
                } catch {
                    console.log(`  Raw Error: ${errorText}`);
                }
            } else {
                const data = await response.json();
                console.log(`  ✅ Success!`);
                console.log(`  Response structure:`, {
                    hasChoices: !!data.choices,
                    choicesLength: data.choices?.length,
                    hasContent: !!data.choices?.[0]?.message?.content
                });
                if (data.choices?.[0]?.message?.content) {
                    console.log(`  Content preview: ${data.choices[0].message.content.substring(0, 100)}...`);
                }
            }
        } catch (error) {
            console.log(`  ❌ Network Error: ${error.message}`);
        }
    } else {
        console.log('\n⚠️  Skipping direct API test (no PPLX_API_KEY)');
    }
    
    // Test proxy if available
    if (supabaseUrl && supabaseAnonKey) {
        console.log('\n🧪 Testing Supabase Edge Function Proxy...');
        const proxyUrl = `${supabaseUrl}/functions/v1/jarvis-api-proxy`;
        
        try {
            const response = await fetch(proxyUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${supabaseAnonKey}`,
                    'Content-Type': 'application/json',
                    'apikey': supabaseAnonKey
                },
                body: JSON.stringify({
                    provider: 'perplexity',
                    payload: {
                        model: 'sonar-pro',
                        messages: [
                            {
                                role: 'system',
                                content: 'Be precise and concise.'
                            },
                            {
                                role: 'user',
                                content: 'What is the capital of France?'
                            }
                        ]
                    }
                })
            });
            
            console.log(`  Status: ${response.status} ${response.statusText}`);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.log(`  ❌ Error Response: ${errorText.substring(0, 300)}`);
                
                try {
                    const errorData = JSON.parse(errorText);
                    console.log(`  Error Details:`, JSON.stringify(errorData, null, 2));
                } catch {
                    console.log(`  Raw Error: ${errorText}`);
                }
            } else {
                const data = await response.json();
                console.log(`  ✅ Success!`);
                console.log(`  Response structure:`, {
                    hasChoices: !!data.choices,
                    choicesLength: data.choices?.length,
                    hasContent: !!data.choices?.[0]?.message?.content
                });
                if (data.choices?.[0]?.message?.content) {
                    console.log(`  Content preview: ${data.choices[0].message.content.substring(0, 100)}...`);
                }
            }
        } catch (error) {
            console.log(`  ❌ Network Error: ${error.message}`);
        }
    } else {
        console.log('\n⚠️  Skipping proxy test (no Supabase config)');
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('\n💡 Tips:');
    console.log('  - If you see 401 errors, check your API keys');
    console.log('  - If you see 400 errors, the request format might be wrong');
    console.log('  - If proxy fails but direct works, check Supabase Secrets');
    console.log('  - Make sure PPLX_API_KEY starts with "pplx-"');
    
    rl.close();
}

testPerplexityAPI().catch(console.error);

