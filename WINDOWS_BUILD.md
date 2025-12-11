# 🪟 Building Windows Installer for Jarvis 5.0

## Prerequisites

To build a Windows installer (.exe), you have several options:

### Option 1: Build on Windows Machine (Recommended) ✅

**Step-by-Step Instructions:**

1. **Install Node.js on Windows:**
   - Download Node.js from https://nodejs.org/ (LTS version recommended)
   - Run the installer and follow the prompts
   - Verify installation by opening Command Prompt or PowerShell and running:
     ```cmd
     node --version
     npm --version
     ```

2. **Transfer your project to Windows:**
   - Copy your entire project folder to the Windows computer
   - Or clone from GitHub if you have it in a repository:
     ```cmd
     git clone https://github.com/nikhilatfiveguys/Jarvis.git
     cd Jarvis
     ```

3. **Install project dependencies:**
   - Open Command Prompt or PowerShell in your project folder
   - Run:
     ```cmd
     npm install
     ```
   - This will install all required packages (may take a few minutes)

4. **Build the Windows installer:**
   - For unsigned build (recommended for testing):
     ```cmd
     npm run build:win:unsigned
     ```
   - For standard build:
     ```cmd
     npm run build:win
     ```

5. **Find your installer:**
   - After building completes, go to the `dist` folder
   - You'll find: `Jarvis 5.0 Setup 1.0.0.exe` (and possibly a 32-bit version)
   - This is your Windows installer ready to distribute!

### Option 2: Cross-Compile from macOS (Requires Wine)
1. Install Wine:
   ```bash
   brew install --cask wine-stable
   ```
2. Install NSIS (Windows installer tool):
   ```bash
   brew install nsis
   ```
3. Build:
   ```bash
   npm run build:win
   ```

### Option 3: Use GitHub Actions (CI/CD)
Set up automated builds using GitHub Actions - builds will run on Windows runners automatically.

## Build Commands (On Windows)

Open **Command Prompt** or **PowerShell** in your project folder, then run:

### Standard Build (Signed - if configured)
```cmd
npm run build:win
```

### Unsigned Build (Recommended for testing)
```cmd
npm run build:win:unsigned
```

**Note:** The build process will:
- Package your Electron app
- Create an NSIS installer (.exe file)
- Place the installer in the `dist` folder
- May take 5-10 minutes depending on your computer

## Output Files

After building, you'll find Windows installers in the `dist/` folder:
- `Jarvis 5.0 Setup 1.0.0.exe` - Main installer (x64)
- `Jarvis 5.0 Setup 1.0.0-ia32.exe` - 32-bit installer (if configured)

## Windows Installer Features

The Windows installer includes:
- ✅ Custom icon (icon.ico)
- ✅ Desktop shortcut creation
- ✅ Start menu shortcut
- ✅ Custom installation directory selection
- ✅ Uninstaller included

## Current Configuration

- **Installer Type**: NSIS (Nullsoft Scriptable Install System)
- **Architecture**: x64 and ia32 (32-bit)
- **One-Click Install**: Disabled (allows custom directory)
- **Shortcuts**: Desktop and Start Menu

## Troubleshooting

### "icon.ico not found"
- The icon.ico file should already be in your project folder
- If missing, you can create it from the icon.iconset folder (requires image conversion tool)

### "electron-builder not found"
- Run: `npm install` to install all dependencies
- Make sure you're in the project root directory

### Build fails with permission errors
- Run Command Prompt or PowerShell as Administrator
- Or check that you have write permissions to the `dist` folder

### NSIS errors
- NSIS is bundled with electron-builder, so it should work automatically
- If issues persist, try: `npm install electron-builder --save-dev`

### Build takes too long
- This is normal! Building can take 5-15 minutes
- Make sure you have a stable internet connection (may download dependencies)
- Close other applications to free up system resources

### "Cannot find module" errors
- Run `npm install` again to ensure all dependencies are installed
- Delete `node_modules` folder and `package-lock.json`, then run `npm install` again

## Distribution

Once built, you can:
1. Test the installer on a Windows machine
2. Upload to your distribution platform
3. Share the .exe file with Windows users

