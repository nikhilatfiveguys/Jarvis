const { getActiveUrl } = require('./getActiveUrl');

async function summarizeWebsite(providedUrl = null, fullMessage = null) {
    try {
        let url = providedUrl;
        if (!url) {
            url = await getActiveUrl();
        }
        if (!url) {
            return 'Unknown (no URL provided and no active browser URL found)';
        }

        const apiKey = process.env.PPLX_API_KEY;
        if (!apiKey) {
            return 'Unknown (missing PPLX_API_KEY - please set environment variable)';
        }

        const systemPrompt = 'You are a concise summarizer. By default, provide brief summaries unless asked for more detail. Use HTML formatting: <b>text</b> for bold, <ul><li>item</li></ul> for lists. Keep responses short and to the point.';

        // Use the full message if provided, otherwise use default prompt
        const userPrompt = fullMessage || `Summarize this page in the requested structure:\n${url}`;

        console.log('Calling Perplexity API with URL:', url);
        console.log('User prompt:', userPrompt);
        const res = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'sonar',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ]
            })
        });

        console.log('Perplexity API response status:', res.status);
        
        // Check if response is JSON
        const contentType = res.headers.get('content-type');
        console.log('Response content-type:', contentType);
        
        if (!contentType || !contentType.includes('application/json')) {
            const textResponse = await res.text();
            console.log('Non-JSON response:', textResponse);
            return `API Error: Expected JSON but got ${contentType}. Response: ${textResponse.substring(0, 200)}...`;
        }
        
        const data = await res.json();
        console.log('Perplexity API response data:', JSON.stringify(data, null, 2));
        
        if (!res.ok) {
            return `API Error: ${res.status} - ${data.error?.message || 'Unknown error'}`;
        }
        
        const content = data?.choices?.[0]?.message?.content || '';
        return content || 'Unknown (no summary returned)';
    } catch (err) {
        return `Unknown (error: ${err.message})`;
    }
}

module.exports = { summarizeWebsite };
module.exports.default = summarizeWebsite;
