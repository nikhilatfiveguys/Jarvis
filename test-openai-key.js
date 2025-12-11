// Test if your OpenAI API key works
// This tests the Edge Function's ability to call OpenAI

const https = require('https');

const SUPABASE_URL = 'https://nbmnbgouiammxpkbyaxj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibW5iZ291aWFtbXhwa2J5YXhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI1MjEwODcsImV4cCI6MjA3ODA5NzA4N30.ppFaxEFUyBWjwkgdszbvP2HUdXXKjC0Bu-afCQr0YxE';
const PROXY_URL = `${SUPABASE_URL}/functions/v1/jarvis-api-proxy`;

console.log('🧪 Testing OpenAI API Key via Edge Function...\n');

const payload = JSON.stringify({
    provider: 'openai',
    endpoint: 'responses',
    payload: {
        model: 'gpt-5-mini',
        instructions: 'Say hello in one word',
        input: [{
            role: 'user',
            content: [{ type: 'input_text', text: 'hello' }]
        }]
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
        'Content-Length': Buffer.byteLength(payload)
    },
    rejectUnauthorized: false
};

const req = https.request(options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
        data += chunk;
    });
    
    res.on('end', () => {
        console.log(`📊 Response Status: ${res.statusCode} ${res.statusMessage}\n`);
        
        if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log('✅ SUCCESS! OpenAI API key is working!\n');
            console.log('Response preview:', data.substring(0, 300));
        } else if (res.statusCode === 401) {
            console.log('❌ 401 UNAUTHORIZED ERROR\n');
            console.log('This means ONE of these:');
            console.log('1. OpenAI API key is missing in Supabase Secrets');
            console.log('2. OpenAI API key is invalid/expired');
            console.log('3. OpenAI API key doesn\'t have permission\n');
            console.log('Error details:');
            try {
                const errorData = JSON.parse(data);
                console.log(JSON.stringify(errorData, null, 2));
            } catch (e) {
                console.log(data);
            }
            console.log('\n📝 TO FIX:');
            console.log('1. Go to: https://platform.openai.com/api-keys');
            console.log('2. Generate a new API key');
            console.log('3. Go to: https://supabase.com/dashboard/project/nbmnbgouiammxpkbyaxj/settings/functions');
            console.log('4. Click "Secrets" tab');
            console.log('5. Update OPENAI_API_KEY with the new key');
            console.log('6. Redeploy the Edge Function');
        } else {
            console.log('❌ ERROR:', res.statusCode);
            console.log(data);
        }
    });
});

req.on('error', (error) => {
    console.error('❌ Network error:', error.message);
});

req.write(payload);
req.end();


