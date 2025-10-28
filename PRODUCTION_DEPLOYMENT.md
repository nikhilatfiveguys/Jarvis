# Production Deployment Guide for Jarvis 5.0

This guide covers how to securely deploy Jarvis 5.0 to production with all API keys and credentials properly managed.

## 🔐 Security Overview

Your app now uses a secure configuration system that:
- ✅ Loads credentials from environment variables
- ✅ Never hardcodes API keys in source code
- ✅ Supports different configurations for development/production
- ✅ Validates all required credentials on startup

## 📋 Pre-Deployment Checklist

### 1. Environment Variables Setup

Create a `.env` file in your project root (copy from `env.template`):

```bash
# Copy the template
cp env.template .env

# Edit with your actual credentials
nano .env
```

### 2. Required Environment Variables

```bash
# Application
NODE_ENV=production

# Google OAuth (from Google Cloud Console)
GOOGLE_CLIENT_ID=your_actual_client_id
GOOGLE_CLIENT_SECRET=your_actual_client_secret
GOOGLE_REDIRECT_URI=https://yourdomain.com/auth/callback

# Polar Subscription (from Polar Dashboard)
POLAR_ORGANIZATION_ID=your_organization_id
POLAR_API_KEY=your_polar_api_key
POLAR_WEBHOOK_SECRET=your_webhook_secret
POLAR_BASE_URL=https://api.polar.sh/v1

# OpenAI (from OpenAI Platform)
OPENAI_API_KEY=your_openai_api_key

# Exa API (from Exa.ai)
EXA_API_KEY=your_exa_api_key
```

## 🚀 Deployment Options

### Option 1: Electron Builder (Recommended)

1. **Install electron-builder** (if not already installed):
```bash
npm install --save-dev electron-builder
```

2. **Update package.json** with build configuration:
```json
{
  "build": {
    "appId": "com.yourcompany.jarvis",
    "productName": "Jarvis 5.0",
    "directories": {
      "output": "dist"
    },
    "files": [
      "**/*",
      "!**/node_modules/*/{CHANGELOG.md,README.md,README,readme.md,readme}",
      "!**/node_modules/*/{test,__tests__,tests,powered-test,example,examples}",
      "!**/node_modules/*.d.ts",
      "!**/node_modules/.bin",
      "!**/*.{iml,o,hprof,orig,pyc,pyo,rbc,swp,csproj,sln,xproj}",
      "!.editorconfig",
      "!**/._*",
      "!**/{.DS_Store,.git,.hg,.svn,CVS,RCS,SCCS,.gitignore,.gitattributes}",
      "!**/{__pycache__,thumbs.db,.flowconfig,.idea,.vs,.nyc_output}",
      "!**/{appveyor.yml,.travis.yml,circle.yml}",
      "!**/{npm-debug.log,yarn.lock,.yarn-integrity,.yarn-metadata.json}"
    ],
    "mac": {
      "category": "public.app-category.productivity",
      "target": "dmg"
    },
    "win": {
      "target": "nsis"
    },
    "linux": {
      "target": "AppImage"
    }
  }
}
```

3. **Build for production**:
```bash
# Build for current platform
npm run build

# Build for all platforms
npm run build:all
```

### Option 2: Manual Distribution

1. **Create production build**:
```bash
# Install production dependencies only
npm ci --production

# Create distribution package
tar -czf jarvis-5.0-production.tar.gz \
  --exclude=node_modules \
  --exclude=.env \
  --exclude=.git \
  --exclude=*.log \
  .
```

2. **Deploy to server**:
```bash
# Upload to your server
scp jarvis-5.0-production.tar.gz user@yourserver.com:/opt/jarvis/

# Extract on server
ssh user@yourserver.com "cd /opt/jarvis && tar -xzf jarvis-5.0-production.tar.gz"
```

## 🔧 Production Configuration

### 1. Server Environment Setup

Create a production environment file on your server:

```bash
# On your production server
sudo nano /opt/jarvis/.env.production
```

Add your production credentials:
```bash
NODE_ENV=production
GOOGLE_CLIENT_ID=your_production_client_id
GOOGLE_CLIENT_SECRET=your_production_client_secret
GOOGLE_REDIRECT_URI=https://yourdomain.com/auth/callback
POLAR_ORGANIZATION_ID=your_organization_id
POLAR_API_KEY=your_polar_api_key
POLAR_WEBHOOK_SECRET=your_webhook_secret
OPENAI_API_KEY=your_openai_api_key
EXA_API_KEY=your_exa_api_key
```

### 2. System Service Setup

Create a systemd service file:

```bash
sudo nano /etc/systemd/system/jarvis.service
```

```ini
[Unit]
Description=Jarvis 5.0 Application
After=network.target

[Service]
Type=simple
User=jarvis
WorkingDirectory=/opt/jarvis
Environment=NODE_ENV=production
EnvironmentFile=/opt/jarvis/.env.production
ExecStart=/usr/bin/node main.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl enable jarvis
sudo systemctl start jarvis
sudo systemctl status jarvis
```

## 🌐 Webhook Setup

### 1. Configure Polar Webhooks

1. Go to your Polar dashboard
2. Navigate to "Webhooks" section
3. Create a new webhook with:
   - **URL**: `https://yourdomain.com/webhook/polar`
   - **Events**: Select all subscription and payment events
   - **Secret**: Generate a strong secret and save it

### 2. Webhook Endpoint

Your webhook handler is already set up in `webhook-handler.js`. Deploy it to your server:

```javascript
// webhook-server.js
const express = require('express');
const PolarWebhookHandler = require('./webhook-handler');

const app = express();
const webhookHandler = new PolarWebhookHandler();

app.use('/webhook/polar', express.json(), webhookHandler.handleWebhook);

app.listen(3000, () => {
  console.log('Webhook server running on port 3000');
});
```

## 🔒 Security Best Practices

### 1. File Permissions

```bash
# Set secure permissions
chmod 600 /opt/jarvis/.env.production
chown jarvis:jarvis /opt/jarvis/.env.production
```

### 2. Environment Validation

The app will automatically validate all required environment variables on startup. If any are missing, it will show a clear error message.

### 3. Logging and Monitoring

```bash
# View application logs
sudo journalctl -u jarvis -f

# Check for errors
sudo journalctl -u jarvis --since "1 hour ago" | grep ERROR
```

### 4. Backup Strategy

```bash
# Backup user data
tar -czf jarvis-backup-$(date +%Y%m%d).tar.gz \
  /opt/jarvis/user-data/ \
  /opt/jarvis/.env.production
```

## 🧪 Testing Production Setup

### 1. Validate Configuration

```bash
# Test configuration loading
node -e "
const SecureConfig = require('./config/secure-config');
const config = new SecureConfig();
try {
  config.validateConfig();
  console.log('✅ All credentials configured correctly');
} catch (error) {
  console.error('❌ Configuration error:', error.message);
}
"
```

### 2. Test OAuth Flow

1. Start your app in production mode
2. Try the Google sign-in flow
3. Verify user data is stored correctly
4. Test subscription checking

### 3. Test Webhook Integration

```bash
# Test webhook endpoint
curl -X POST https://yourdomain.com/webhook/polar \
  -H "Content-Type: application/json" \
  -H "polar-signature: test" \
  -d '{"type": "test", "data": {}}'
```

## 📦 Distribution

### 1. Create Installer

```bash
# Build installer
npm run build:installer

# The installer will be in dist/
ls dist/
```

### 2. Code Signing (Optional)

For macOS and Windows, you can add code signing:

```json
{
  "build": {
    "mac": {
      "identity": "Developer ID Application: Your Name (XXXXXXXXXX)"
    },
    "win": {
      "certificateFile": "path/to/certificate.p12",
      "certificatePassword": "password"
    }
  }
}
```

## 🚨 Troubleshooting

### Common Issues:

1. **"Credentials not configured" error**
   - Check your `.env` file exists and has correct values
   - Verify environment variables are loaded

2. **OAuth redirect URI mismatch**
   - Update Google Console with correct redirect URI
   - Check `GOOGLE_REDIRECT_URI` environment variable

3. **Polar API errors**
   - Verify `POLAR_API_KEY` is correct
   - Check organization ID matches your Polar account

4. **Webhook not receiving events**
   - Verify webhook URL is accessible
   - Check webhook secret matches Polar dashboard

### Debug Commands:

```bash
# Check environment variables
printenv | grep -E "(GOOGLE|POLAR|OPENAI|EXA)"

# Test API connectivity
curl -H "Authorization: Bearer $POLAR_API_KEY" \
  https://api.polar.sh/v1/organizations

# View application logs
tail -f /var/log/jarvis.log
```

## ✅ Final Checklist

Before releasing to public:

- [ ] All environment variables configured
- [ ] Google OAuth redirect URIs updated for production
- [ ] Polar webhooks configured and tested
- [ ] Application builds successfully
- [ ] OAuth flow works end-to-end
- [ ] Subscription linking works
- [ ] Webhook events are received
- [ ] Error handling is robust
- [ ] Logging is configured
- [ ] Backup strategy is in place
- [ ] Security permissions are set correctly

Your app is now ready for secure production deployment! 🚀


