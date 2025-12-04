# Quick Google Docs API Setup

## Option 1: Using .env file (Recommended)

1. **Copy the template:**
   ```bash
   cp env.template .env
   ```

2. **Edit .env file and add your Google credentials:**
   ```bash
   nano .env  # or use any text editor
   ```

3. **Add these lines (get credentials from Google Cloud Console):**
   ```
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   ```

4. **Restart Jarvis** - The app will automatically load the .env file

## Option 2: Using Environment Variables

Set them in your shell before starting Jarvis:

```bash
export GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
export GOOGLE_CLIENT_SECRET="your-client-secret"
```

Then start Jarvis:
```bash
npm start
```

## Getting Google OAuth Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable **Google Docs API** and **Google Drive API**
4. Go to **APIs & Services** > **Credentials**
5. Click **Create Credentials** > **OAuth client ID**
6. Choose **Desktop app** as the application type
7. Copy the **Client ID** and **Client Secret**

## Full Setup Guide

See `GOOGLE_DOCS_SETUP.md` for detailed step-by-step instructions.

## Troubleshooting

- **"Credentials not configured"**: Make sure .env file exists and has the correct variable names
- **Restart required**: After creating/editing .env, restart the app
- **Check spelling**: Variable names must be exactly `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` (with underscores)



