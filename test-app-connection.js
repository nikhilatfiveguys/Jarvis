// Test if app can connect to Edge Function
// Run with: node test-app-connection.js

const https = require('https');

const SUPABASE_URL = 'https://nbmnbgouiammxpkbyaxj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibW5iZ291aWFtbXhwa2J5YXhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI1MjEwODcsImV4cCI6MjA3ODA5NzA4N30.ppFaxEFUyBWjwkgdszbvP2HUdXXKjC0Bu-afCQr0YxE';
const PROXY_URL = `${SUPABASE_URL}/functions/v1/jarvis-api-proxy`;

console.log('🧪 Testing Edge Function Connection...\n');

// Test 1: Perplexity
console.log('Test 1: Perplexity API');
const perplexityPayload = JSON.stringify({
    provider: 'perplexity',
    payload: {
        model: 'sonar-pro',
        messages: [
            { role: 'system', content: 'Be concise' },
            { role: 'user', content: 'What is 2+2?' }
        ]
    }
});

const parsedUrl = new URL(PROXY_URL);
const options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.pathname,
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'apikey': SUPABASE_ANON_KEY,
        'Content-Length': Buffer.byteLength(perplexityPayload)
    }
};

const req = https.request(options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        console.log(`\n📊 Response Status: ${res.statusCode} ${res.statusMessage}`);
        
        if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('✅ SUCCESS! Perplexity API is working\n');
            try {
                const parsed = JSON.parse(data);
                if (parsed.choices && parsed.choices[0]) {
                    console.log('📝 Answer:', parsed.choices[0].message.content);
                }
            } catch (e) {
                console.log('Response:', data.substring(0, 200));
            }
        } else {
            console.log('❌ FAILED! Got error:', res.statusCode);
            console.log('Error details:', data);
        }
        
        // Test 2: OpenAI
        console.log('\n' + '='.repeat(60));
        console.log('\nTest 2: OpenAI API (for Answer Screen)');
        
        const openaiPayload = JSON.stringify({
            provider: 'openai',
            endpoint: 'responses',
            payload: {
                model: 'gpt-5-mini',
                instructions: 'Be concise',
                input: [{
                    role: 'user',
                    content: [{ type: 'input_text', text: 'Say hello' }]
                }]
            }
        });
        
        const openaiOptions = {
            hostname: parsedUrl.hostname,
            port: 443,
            path: parsedUrl.pathname,
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                'Content-Type': 'application/json',
                'apikey': SUPABASE_ANON_KEY,
                'Content-Length': Buffer.byteLength(openaiPayload)
            }
        };
        
        const req2 = https.request(openaiOptions, (res2) => {
            let data2 = '';
            
            res2.on('data', (chunk) => {
                data2 += chunk;
            });
            
            res2.on('end', () => {
                console.log(`\n📊 Response Status: ${res2.statusCode} ${res2.statusMessage}`);
                
                if (res2.statusCode >= 200 && res2.statusCode < 300) {
                    console.log('✅ SUCCESS! OpenAI API is working\n');
                    console.log('Response preview:', data2.substring(0, 200));
                } else {
                    console.log('❌ FAILED! Got error:', res2.statusCode);
                    console.log('Error details:', data2);
                }
                
                console.log('\n' + '='.repeat(60));
                console.log('\n📋 Summary:');
                console.log('Perplexity (Web Search):', res.statusCode === 200 ? '✅ Working' : '❌ Failed');
                console.log('OpenAI (Answer Screen):', res2.statusCode === 200 ? '✅ Working' : '❌ Failed');
                console.log('\nIf both show ✅, the Edge Function is working correctly!');
                console.log('If app still shows 401, the issue is in the app itself.');
            });
        });
        
        req2.on('error', (error) => {
            console.error('❌ OpenAI test error:', error.message);
        });
        
        req2.write(openaiPayload);
        req2.end();
    });
});

req.on('error', (error) => {
    console.error('❌ Perplexity test error:', error.message);
});

req.write(perplexityPayload);
req.end();


