# Google Docs API Setup Guide

This guide will walk you through setting up Google OAuth credentials to enable the Google Docs API integration in Jarvis.

## Prerequisites

- A Google account
- Access to Google Cloud Console (https://console.cloud.google.com/)

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click on the project dropdown at the top
3. Click "New Project"
4. Enter a project name (e.g., "Jarvis Integration")
5. Click "Create"

## Step 2: Enable Google Docs API

1. In your project, go to **APIs & Services** > **Library**
2. Search for "Google Docs API"
3. Click on "Google Docs API"
4. Click **Enable**

Also enable:
- **Google Drive API** (required for creating documents)

## Step 3: Create OAuth 2.0 Credentials

1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. If prompted, configure the OAuth consent screen first:
   - Choose **External** (unless you have a Google Workspace account)
   - Fill in the required information:
     - App name: "Jarvis"
     - User support email: Your email
     - Developer contact: Your email
   - Click **Save and Continue**
   - Add scopes:
     - `https://www.googleapis.com/auth/documents`
     - `https://www.googleapis.com/auth/drive.file`
   - Click **Save and Continue**
   - Add test users (your email) if needed
   - Click **Save and Continue**
   - Review and click **Back to Dashboard**

4. Now create OAuth client ID:
   - Application type: **Desktop app**
   - Name: "Jarvis Desktop"
   - Click **Create**

5. Copy the **Client ID** and **Client Secret**

## Step 4: Configure Environment Variables

You need to set the following environment variables:

### Option 1: Environment Variables (Recommended)

Add to your shell profile (`~/.zshrc` or `~/.bash_profile`):

```bash
export GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
export GOOGLE_CLIENT_SECRET="your-client-secret"
```

Then restart your terminal or run:
```bash
source ~/.zshrc  # or source ~/.bash_profile
```

### Option 2: Create `.env` file (if using dotenv)

Create a `.env` file in the project root:

```
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

### Option 3: Set in Electron app (Development)

You can temporarily set them in `main.js` for testing:

```javascript
process.env.GOOGLE_CLIENT_ID = 'your-client-id.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'your-client-secret';
```

## Step 5: Test the Integration

1. Start Jarvis
2. Generate some output from Jarvis
3. Click "Write to Docs" button
4. You should see an authentication window
5. Sign in with your Google account
6. Grant permissions to Jarvis
7. The content should be written to a new Google Doc

## Troubleshooting

### "OAuth credentials not configured" error

- Make sure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set
- Restart the app after setting environment variables
- Check that the credentials are correct

### "Access blocked" error

- Make sure you've added yourself as a test user in OAuth consent screen
- If your app is in "Testing" mode, only test users can authenticate
- Publish your app or add more test users

### "Redirect URI mismatch" error

- The redirect URI is hardcoded to `http://localhost:8080/oauth2callback`
- Make sure this matches in your OAuth client settings
- In Google Cloud Console, go to your OAuth client and add this redirect URI

### Authentication window doesn't open

- Check browser console for errors
- Make sure pop-ups aren't blocked
- Try restarting the app

## Security Notes

- **Never commit** your `GOOGLE_CLIENT_SECRET` to version control
- Store credentials securely
- The OAuth tokens are stored in `~/.jarvis-google-tokens.json`
- You can revoke access at any time in your Google Account settings

## How It Works

1. User clicks "Write to Docs"
2. App checks if user is authenticated
3. If not authenticated, opens OAuth flow
4. User grants permissions
5. Tokens are saved locally
6. App uses Google Docs API to create document and insert text
7. Returns document URL to user

## API Features

- Creates new Google Docs automatically
- Inserts text directly via API (no browser needed)
- Faster than typing simulation
- Works cross-platform
- Secure token storage

## Revoking Access

To revoke access:
1. Go to [Google Account Settings](https://myaccount.google.com/permissions)
2. Find "Jarvis" in the list
3. Click "Remove Access"

Or use the sign-out function in the app (if implemented in UI).




