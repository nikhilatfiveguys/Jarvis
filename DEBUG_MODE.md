# Debug Mode - See Errors Without Console

Since you can't access the console, here's how to see what's happening:

## Option 1: Check Error Notifications

When an error occurs, you'll see a red notification at the top of the Jarvis window with details about what went wrong.

## Option 2: Enable Debug Mode in App

The app now shows detailed error messages in notifications. Look for:
- Red error notifications at the top
- Messages that start with "❌"
- Debug info included in the message

## Option 3: Check Main Process Logs

If you started the app from terminal with `npm start`, check the terminal window - it will show:
- API key loading status
- Proxy configuration
- Detailed error messages

## Option 4: Temporary Debug File

I can add a feature that writes errors to a file you can read. Would you like me to add that?

## Common 401 Error Causes:

1. **Supabase anon key missing** - The app isn't loading it from main process
   - Fix: Restart the app
   
2. **Wrong anon key** - The key doesn't match what's in production-config.js
   - Fix: Check config/production-config.js line 7
   
3. **Edge Function not accessible** - The function might need to be made public
   - Fix: Check Supabase Dashboard → Edge Functions → jarvis-api-proxy → Settings

## Quick Test:

Try asking: "What's the weather today?"

If you see a 401 error notification, it will now show:
- Whether proxy is configured
- Whether anon key is present
- The exact error message

