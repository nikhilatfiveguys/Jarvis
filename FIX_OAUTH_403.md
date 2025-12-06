# Fix: Error 403: access_denied

## Problem
You're seeing "Error 403: access_denied" because your OAuth app is in "Testing" mode and your email isn't added as a test user.

## Quick Fix (Recommended)

### Add Yourself as a Test User

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project
3. Navigate to **APIs & Services** > **OAuth consent screen**
4. Scroll down to the **Test users** section
5. Click **+ ADD USERS**
6. Add your email address: `aaronsoni06@gmail.com`
7. Click **ADD**
8. Save the changes

### Try Again

1. Restart Jarvis
2. Click "Write to Docs" again
3. The authentication should work now

## Alternative: Publish Your App

If you want to avoid adding test users, you can publish your app:

1. Go to **APIs & Services** > **OAuth consent screen**
2. Click **PUBLISH APP** button at the top
3. Confirm the publishing

**Note:** Publishing makes your app available to all Google users. For personal use, adding test users is sufficient.

## Why This Happens

When an OAuth app is in "Testing" mode:
- Only test users can authenticate
- The app hasn't been verified by Google
- This is normal for development/personal apps

Adding yourself as a test user is the quickest solution!




