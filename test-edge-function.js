// Quick test script to verify Edge Function is working
// Uses built-in fetch (available in Node 18+ and Electron)

const SUPABASE_URL = 'https://nbmnbgouiammxpkbyaxj.supabase.co';
const EDGE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/jarvis-api-proxy`;
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibW5iZ291aWFtbXhwa2J5YXhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI1MjEwODcsImV4cCI6MjA3ODA5NzA4N30.ppFaxEFUyBWjwkgdszbvP2HUdXXKjC0Bu-afCQr0YxE';

async function testEdgeFunction() {
    console.log('🧪 Testing Supabase Edge Function...\n');
    
    // Test Perplexity (simplest test)
    console.log('1️⃣ Testing Perplexity API via Edge Function...');
    try {
        const response = await fetch(EDGE_FUNCTION_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                provider: 'perplexity',
                payload: {
                    model: 'sonar-pro',
                    messages: [
                        { role: 'user', content: 'Say hello in one word' }
                    ]
                }
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ Perplexity test PASSED!');
            console.log('   Response:', data.choices?.[0]?.message?.content || 'Success');
        } else {
            const error = await response.text();
            console.log('❌ Perplexity test FAILED');
            console.log('   Status:', response.status);
            console.log('   Error:', error);
        }
    } catch (error) {
        console.log('❌ Perplexity test ERROR:', error.message);
    }
    
    console.log('\n2️⃣ Testing OpenAI API via Edge Function...');
    try {
        const response = await fetch(EDGE_FUNCTION_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                provider: 'openai',
                endpoint: 'responses',
                payload: {
                    model: 'gpt-5-mini',
                    instructions: 'Say hello',
                    input: [{ role: 'user', content: 'Hello' }]
                }
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            console.log('✅ OpenAI test PASSED!');
            console.log('   Response received (check data for output)');
        } else {
            const error = await response.text();
            console.log('❌ OpenAI test FAILED');
            console.log('   Status:', response.status);
            console.log('   Error:', error.substring(0, 200));
        }
    } catch (error) {
        console.log('❌ OpenAI test ERROR:', error.message);
    }
    
    console.log('\n✅ Test complete!');
    console.log('\n📝 What to look for:');
    console.log('   - ✅ = Edge Function is working');
    console.log('   - ❌ = Check Supabase Secrets are set correctly');
}

testEdgeFunction().catch(console.error);

