#!/usr/bin/env node
/**
 * Build unsigned DMG from this code (no shell required).
 * Writes build-log.txt and puts the DMG in project root + Desktop.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const logPath = path.join(root, 'build-log.txt');

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(logPath, line);
  console.log(msg);
}

async function run() {
  fs.writeFileSync(logPath, '');
  log('Build started.');

  // 1) Native rebuild (macOS only)
  if (process.platform === 'darwin' && process.env.SKIP_NATIVE_REBUILD !== '1') {
    log('Rebuilding native module...');
    const nativeDir = path.join(root, 'native', 'mac-content-protection');
    try {
      execSync('npx electron-rebuild -f -w mac_content_protection', {
        cwd: nativeDir,
        stdio: 'inherit'
      });
      log('Native module rebuilt.');
    } catch (e) {
      log('Native rebuild warning: ' + e.message);
    }
  } else {
    log('Skipping native rebuild.');
  }

  // 2) electron-builder
  log('Running electron-builder...');
  const builder = require('electron-builder');
  const configPath = path.join(root, 'electron-builder-unsigned.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  await builder.build({
    config,
    targets: builder.Platform.MAC.createTarget('dmg', builder.Arch.arm64)
  });

  // 3) Copy DMG to project root and Desktop
  const pkg = require(path.join(root, 'package.json'));
  const version = pkg.version;
  const productName = (pkg.productName || pkg.build?.productName || 'Jarvis').replace(/\s+/g, ' ');
  const dmgName = `${productName}-${version}-arm64.dmg`;
  const dmgPath = path.join(root, 'dist', dmgName);

  let srcDmg = dmgPath;
  if (!fs.existsSync(dmgPath)) {
    const distDir = path.join(root, 'dist');
    const files = fs.readdirSync(distDir, { withFileTypes: true });
    const anyDmg = files.find(f => f.name.endsWith('.dmg'));
    if (!anyDmg) throw new Error('No DMG found in dist/');
    srcDmg = path.join(distDir, anyDmg.name);
  }

  const destName = `${productName.replace(/\s+/g, '-')}-${version}-UNSIGNED.dmg`;
  const dest = path.join(root, destName);
  fs.copyFileSync(srcDmg, dest);
  log('SUCCESS: DMG at ' + dest);

  const desktop = path.join(process.env.HOME || '', 'Desktop');
  if (fs.existsSync(desktop)) {
    fs.copyFileSync(srcDmg, path.join(desktop, destName));
    log('Copied to Desktop.');
  }

  log('Build finished.');
}

run().catch(err => {
  log('FAIL: ' + (err.message || err));
  console.error(err);
  process.exit(1);
});
