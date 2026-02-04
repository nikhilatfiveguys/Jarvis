#!/usr/bin/env node
// Build the native macOS content-protection module after npm install so users don't need to run any terminal command.
// Only runs on macOS (native module is macOS-only).
const { execSync } = require('child_process');
const path = require('path');

if (process.platform !== 'darwin') {
  console.log('Skipping native module build (macOS only)');
  process.exit(0);
}

const nativeDir = path.join(__dirname, '..', 'native', 'mac-content-protection');
try {
  execSync('npm install', { cwd: nativeDir, stdio: 'inherit' });
  console.log('Native stealth module built successfully');
} catch (e) {
  console.warn('Native module build skipped or failed (stealth window level may use fallback):', e.message);
}
