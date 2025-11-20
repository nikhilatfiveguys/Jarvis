# Update Supabase Secrets

The test shows that your OpenAI API key in Supabase Secrets is invalid or expired.

## Quick Fix:

Run this command with your **current valid** OpenAI API key:

```bash
supabase secrets set OPENAI_API_KEY=sk-your-actual-current-key-here
```

## Get Your Current OpenAI API Key:

1. Go to: https://platform.openai.com/api-keys
2. Create a new key or copy an existing valid key
3. Make sure it starts with `sk-` or `sk-proj-`

## Verify All Secrets:

```bash
supabase secrets list
```

You should see:
- ✅ OPENAI_API_KEY
- ✅ PPLX_API_KEY  
- ✅ CLAUDE_API_KEY

## Test After Update:

```bash
node test-edge-function.js
```

Both tests should pass (✅) after updating the key.

