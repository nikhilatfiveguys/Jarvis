import { getActiveUrl } from './getActiveUrl';

export async function summarizeWebsite(): Promise<string> {
    try {
        const url = await getActiveUrl();
        if (!url) {
            return 'Unknown (no active browser URL found)';
        }

        const apiKey = process.env.PPLX_API_KEY;
        if (!apiKey) {
            return 'Unknown (missing PPLX_API_KEY - please set environment variable)';
        }

        const systemPrompt = 'You are a precise summarizer. Always produce: (1) TL;DR in 5 lines, (2) Key Points as bullets, (3) 3 Actionable Takeaways.';

        const res = await fetch('https://api.perplexity.ai/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: 'pplx-online',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Summarize this page in the requested structure:\n${url}` }
                ]
            })
        });

        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content || '';
        return content || 'Unknown (no summary returned)';
    } catch (err) {
        return `Unknown (error: ${(err as Error).message})`;
    }
}

export default summarizeWebsite;


