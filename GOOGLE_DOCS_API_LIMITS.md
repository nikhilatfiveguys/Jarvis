# Google Docs API Rate Limits

## Current Limits

Google Docs API has strict rate limits:

- **Per User**: 60 write requests per minute
- **Per Project**: 600 write requests per minute

## What This Means

For realistic typing simulation:
- **Before optimization**: 1000 characters = 1000 API calls ❌ (exceeds limit)
- **After optimization**: 1000 characters = ~33 API calls ✅ (within limit)

## Current Optimization

The typing function now:
1. **Batches characters**: Types 30 characters per API call
2. **Rate limiting**: Minimum 1.5 seconds between API calls (max 40 calls/min)
3. **Progress tracking**: Logs progress every 10 API calls
4. **Error handling**: Waits 15 seconds on quota errors and retries

## Performance

For a typical 200-word paper (~1000 characters):
- **API calls**: ~33 calls
- **Time**: ~50 seconds of API calls + typing delays
- **Total time**: ~6-10 minutes (with realistic pauses)

## If You Still Hit Limits

### Option 1: Request Quota Increase
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to **APIs & Services** > **Quotas**
3. Search for "Google Docs API"
4. Find "Write requests per minute per user"
5. Click **Edit Quotas** and request increase
6. Note: Approval may take time and isn't guaranteed

### Option 2: Further Optimize
- Increase batch size (currently 30 characters)
- Increase delay between calls (currently 1.5 seconds)
- Trade-off: Less realistic typing appearance

### Option 3: Use Different Approach
- Write entire document at once (not realistic typing)
- Use Google Drive API to upload file directly
- Use web automation instead of API

## Monitoring

The function now logs:
- Progress every 10 API calls
- Total characters typed
- Total API calls made
- Quota errors with automatic retry

Check the console/logs to see progress and API usage.



