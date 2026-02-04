#!/usr/bin/env node
// Rebuild native module before packaging so the built app includes the latest native code.
// Only runs on macOS; on other platforms we skip so the build doesn't fail.
const { execSync } = require('child_process');
const path = require('path');

if (process.platform !== 'darwin') {
  console.log('Skipping native rebuild (macOS only)');
  process.exit(0);
}

const nativeDir = path.join(__dirname, '..', 'native', 'mac-content-protection');
try {
  execSync('npx electron-rebuild -f -w mac_content_protection', { cwd: nativeDir, stdio: 'inherit' });
  console.log('Native module rebuilt for packaging');
} catch (e) {
  console.warn('Native rebuild failed, continuing build:', e.message);
}
