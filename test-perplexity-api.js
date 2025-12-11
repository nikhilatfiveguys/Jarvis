// Test script to diagnose Perplexity API issues
// Run with: node test-perplexity-api.js

const PPLX_API_KEY = process.env.PPLX_API_KEY;

async function testPerplexityAPI() {
    console.log('🧪 Testing Perplexity API...\n');
    
    // Check if API key is set
    if (!PPLX_API_KEY) {
        console.log('❌ PPLX_API_KEY environment variable is not set');
        console.log('   Set it with: export PPLX_API_KEY="your-key-here"');
        return;
    }
    
    console.log('✅ API Key found:', PPLX_API_KEY.substring(0, 10) + '...');
    console.log('\n1️⃣ Testing direct API call with sonar-pro model...');
    
    try {
        const response = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PPLX_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'sonar-pro',
                messages: [
                    {
                        role: 'user',
                        content: 'Say hello in one word'
                    }
                ]
            })
        });
        
        console.log('   Status:', response.status, response.statusText);
        
        if (!response.ok) {
            const errorText = await response.text();
            console.log('❌ API call failed');
            console.log('   Error:', errorText);
            
            // Try to parse error
            try {
                const errorJson = JSON.parse(errorText);
                console.log('   Parsed error:', JSON.stringify(errorJson, null, 2));
            } catch {
                console.log('   Raw error text:', errorText);
            }
            
            // Check common issues
            if (response.status === 401) {
                console.log('\n💡 Issue: Invalid API key');
                console.log('   - Check your API key at: https://www.perplexity.ai/settings/api');
                console.log('   - Make sure the key starts with "pplx-"');
            } else if (response.status === 400) {
                console.log('\n💡 Issue: Bad request - possibly invalid model name');
                console.log('   - Try using: sonar-pro, sonar-online, or sonar-reasoner');
            } else if (response.status === 429) {
                console.log('\n💡 Issue: Rate limit exceeded');
                console.log('   - Wait a few minutes and try again');
            }
        } else {
            const data = await response.json();
            console.log('✅ API call successful!');
            console.log('   Response:', data.choices?.[0]?.message?.content || 'Success');
        }
    } catch (error) {
        console.log('❌ Network error:', error.message);
        console.log('   - Check your internet connection');
        console.log('   - Check if Perplexity API is down: https://status.perplexity.com/');
    }
    
    console.log('\n2️⃣ Testing alternative models...');
    const models = ['sonar-pro', 'sonar-online', 'sonar-reasoner', 'sonar'];
    
    for (const model of models) {
        try {
            const response = await fetch('https://api.perplexity.ai/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${PPLX_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: model,
                    messages: [
                        { role: 'user', content: 'Hi' }
                    ]
                })
            });
            
            if (response.ok) {
                console.log(`   ✅ ${model}: Working`);
            } else {
                console.log(`   ❌ ${model}: Failed (${response.status})`);
            }
        } catch (error) {
            console.log(`   ❌ ${model}: Error - ${error.message}`);
        }
    }
    
    console.log('\n✅ Test complete!');
}

testPerplexityAPI().catch(console.error);


