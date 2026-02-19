/**
 * Run after packing the unsigned app. Unlocks files and fixes permissions
 * so the DMG/PKG don't contain locked/read-only items (avoids "some items had to be skipped").
 */
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function fixPermissions(targetPath) {
  if (!fs.existsSync(targetPath)) return;
  const escaped = targetPath.replace(/"/g, '\\"');
  const cmds = [
    `chflags -R nouchg,noschg "${escaped}"`,
    `chmod -R u+rwX "${escaped}"`,
    `chmod -R a+rX "${escaped}"`,
    `xattr -cr "${escaped}"`
  ];
  for (const cmd of cmds) {
    try { execSync(cmd, { stdio: 'pipe' }); } catch (_) {}
  }
}

function fixAllInDir(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      fixPermissions(full);
      if (e.isDirectory() && !e.name.startsWith('.')) {
        fixAllInDir(full);
      }
    }
  } catch (_) {}
}

exports.default = async function afterPack(context) {
  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  if (!fs.existsSync(appPath)) return;

  console.log('Unlocking and fixing permissions for unsigned app...');
  try {
    fixPermissions(appPath);
    fixAllInDir(appPath);
    console.log('Done.');
  } catch (e) {
    console.warn('afterPack-unsigned:', e.message);
  }
};
