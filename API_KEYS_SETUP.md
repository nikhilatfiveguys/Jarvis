# API Keys Setup Guide

This guide explains how to securely store your API keys for Jarvis 6.0 on both macOS and Windows.

## ✅ Recommended Method: Use `.env` File

The `.env` file is the **best and safest** way to store API keys. It:
- ✅ Works on both macOS and Windows
- ✅ Is automatically gitignored (never committed to GitHub)
- ✅ Is easy to set up and manage
- ✅ Keeps your keys secure and local

### Setup Steps:

1. **Copy the example file:**
   ```bash
   cp env.example .env
   ```

2. **Edit `.env` and add your API keys:**
   ```bash
   # On macOS/Linux:
   nano .env
   # or
   open -e .env
   
   # On Windows:
   notepad .env
   ```

3. **Fill in your API keys:**
   ```env
   OPENAI_API_KEY=sk-your-actual-key-here
   PPLX_API_KEY=pplx-your-actual-key-here
   CLAUDE_API_KEY=sk-ant-your-actual-key-here
   EXA_API_KEY=your-exa-key-here
   ```

4. **Save the file** - The app will automatically load these keys when it starts.

## 🔄 Alternative: Environment Variables

You can also set environment variables directly (useful for CI/CD or production servers):

### macOS/Linux:
```bash
export OPENAI_API_KEY="sk-your-key-here"
export PPLX_API_KEY="pplx-your-key-here"
```

### Windows (PowerShell):
```powershell
$env:OPENAI_API_KEY="sk-your-key-here"
$env:PPLX_API_KEY="pplx-your-key-here"
```

### Windows (Command Prompt):
```cmd
set OPENAI_API_KEY=sk-your-key-here
set PPLX_API_KEY=pplx-your-key-here
```

## 📝 Required API Keys

- **OPENAI_API_KEY** (Required) - Get from https://platform.openai.com/api-keys
- **PPLX_API_KEY** (Required) - Get from https://www.perplexity.ai/settings/api
- **CLAUDE_API_KEY** (Optional) - Get from https://console.anthropic.com/
- **EXA_API_KEY** (Optional) - Get from https://exa.ai/

## 🔒 Security Notes

- ⚠️ **Never commit `.env` to git** - It's already in `.gitignore`
- ⚠️ **Never share your `.env` file** - Keep it private
- ⚠️ **Don't put API keys in code** - Always use `.env` or environment variables

## ✅ Verification

After setting up your `.env` file, start the app:
```bash
npm start
```

Check the console logs - you should see:
```
Loading .env file from: /path/to/.env
✅ .env file loaded successfully
```

If you see warnings about missing API keys, double-check your `.env` file format.

