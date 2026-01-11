#!/usr/bin/env node
// Quick test to verify Perplexity API is working through Supabase proxy
// Run with: node test-perplexity-now.js

const SUPABASE_URL = 'https://nbmnbgouiammxpkbyaxj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibW5iZ291aWFtbXhwa2J5YXhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI1MjEwODcsImV4cCI6MjA3ODA5NzA4N30.ppFaxEFUyBWjwkgdszbvP2HUdXXKjC0Bu-afCQr0YxE';
const PROXY_URL = `${SUPABASE_URL}/functions/v1/jarvis-api-proxy`;

async function testPerplexity() {
    console.log('🧪 Testing Perplexity API via Supabase Proxy...\n');
    
    try {
        const response = await fetch(PROXY_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY
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
                            content: 'What is the capital of France? Answer in one sentence.'
                        }
                    ]
                }
            })
        });
        
        console.log(`📥 Response Status: ${response.status} ${response.statusText}\n`);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.log('❌ Error Response:');
            try {
                const errorData = JSON.parse(errorText);
                console.log(JSON.stringify(errorData, null, 2));
            } catch {
                console.log(errorText);
            }
            return false;
        }
        
        const data = await response.json();
        
        if (data.error) {
            console.log('❌ Error in response:');
            console.log(JSON.stringify(data.error, null, 2));
            return false;
        }
        
        if (data.choices && data.choices[0] && data.choices[0].message) {
            console.log('✅ SUCCESS! Perplexity API is working!\n');
            console.log('📝 Response:');
            console.log(data.choices[0].message.content);
            console.log('\n🎉 Your Perplexity API key is correctly configured in Supabase Secrets!');
            return true;
        } else {
            console.log('❌ Unexpected response structure:');
            console.log(JSON.stringify(data, null, 2));
            return false;
        }
        
    } catch (error) {
        console.log(`❌ Network Error: ${error.message}`);
        return false;
    }
}

testPerplexity().then(success => {
    if (success) {
        console.log('\n✅ Test passed! Web search should work in your app now.');
    } else {
        console.log('\n❌ Test failed. Check the error messages above.');
        console.log('💡 Make sure:');
        console.log('   1. PPLX_API_KEY is set in Supabase Secrets');
        console.log('   2. The Edge Function is deployed');
        console.log('   3. Your Perplexity API key is valid');
    }
    process.exit(success ? 0 : 1);
});

