# Check Edge Function Logs

Since the test script works but the app doesn't, we need to see what error the Edge Function is returning.

## Steps:

1. **Go to Supabase Dashboard:**
   - https://supabase.com/dashboard
   - Select project: `nbmnbgouiammxpkbyaxj`
   - Go to: **Edge Functions** → **jarvis-api-proxy**

2. **Open the Logs tab:**
   - Click on **"Logs"** tab (next to Overview, Code, etc.)

3. **Try a web search in the app:**
   - Ask Jarvis: "What's the weather today?"
   - Wait for the error

4. **Check the logs:**
   - Look for the most recent log entries
   - You should see logs starting with:
     - `📥 Request received:`
     - `❌` (if there's an error)
     - `🔑 API Keys check:`

5. **Copy the error message:**
   - Look for any error messages
   - Copy the full error text and share it

## What to look for:

- Does it say "Missing Authorization header"?
- Does it say "Perplexity API key not configured"?
- Does it show a 401 error with details?
- What does the `📥 Request received:` log show?

This will tell us exactly what's going wrong!

