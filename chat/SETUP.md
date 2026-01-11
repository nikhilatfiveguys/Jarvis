# Chat Setup Guide

This guide will help you set up the OpenAI API key in Supabase so the chat feature works.

## Option 1: Store API Key in Supabase Table (Recommended)

1. Go to your Supabase dashboard: https://supabase.com/dashboard
2. Navigate to your project: `nbmnbgouiammxpkbyaxj`
3. Go to **Table Editor** and create a new table called `api_keys` (if it doesn't exist)
4. Add the following columns:
   - `id` (integer, primary key, auto-increment)
   - `openai_key` (text)
5. Insert a row with:
   - `id`: 1
   - `openai_key`: Your OpenAI API key (starts with `sk-`)

**Alternative table structure:**
If you prefer a different table name, you can use `settings` table with column `openai_api_key`.

## Option 2: Use Environment Variable

Set the `OPENAI_API_KEY` environment variable in your Firebase Functions:
1. Go to Firebase Console
2. Navigate to Functions > Configuration
3. Add environment variable: `OPENAI_API_KEY` with your OpenAI API key value

## Option 3: Use Supabase Environment Variable

Set the `SUPABASE_SERVICE_KEY` environment variable in Firebase Functions if you want to use Supabase service role key for better access.

## Testing

After setting up the API key:
1. Deploy the Firebase Functions: `firebase deploy --only functions`
2. Visit `https://yesjarvis.com/chat`
3. Try sending a message to test the chat functionality

## Troubleshooting

- **"API key not configured" error**: Make sure the API key is stored in Supabase or set as an environment variable
- **CORS errors**: The function already includes CORS headers, but check browser console for specific errors
- **Streaming not working**: Check Firebase Functions logs for errors

## Security Notes

- Never commit API keys to version control
- Use Supabase Row Level Security (RLS) to protect the `api_keys` table
- Consider using Supabase Vault for storing sensitive keys
- The Firebase Function proxies requests to keep API keys server-side

