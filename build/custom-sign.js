const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Custom signing script that handles com.apple.provenance attribute
 * This runs after afterPack but before electron-builder's automatic signing
 */
exports.default = async function customSign(context) {
  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  
  console.log('🔐 Custom signing with provenance handling...');
  
  const identity = process.env.CSC_NAME || 'Developer ID Application: Aaron Soni (DMH3RU9FQQ)';
  
  // Sign helpers first (electron-builder will skip them if already signed)
  const frameworksPath = path.join(appPath, 'Contents', 'Frameworks');
  const helpers = [
    `${appName} Helper.app`,
    `${appName} Helper (GPU).app`,
    `${appName} Helper (Plugin).app`,
    `${appName} Helper (Renderer).app`
  ];
  
  for (const helper of helpers) {
    const helperPath = path.join(frameworksPath, helper);
    if (fs.existsSync(helperPath)) {
      const helperMacosPath = path.join(helperPath, 'Contents', 'MacOS');
      const executableName = helper.replace('.app', '');
      const executablePath = path.join(helperMacosPath, executableName);
      
      if (fs.existsSync(executablePath)) {
        try {
          // Try to sign with --preserve-metadata to see if that helps
          console.log(`Signing ${executableName}...`);
          execSync(`codesign --sign "${identity}" --force --timestamp --options runtime --entitlements "${path.join(__dirname, 'entitlements.mac.plist')}" "${executablePath}" 2>&1 || codesign --sign "${identity}" --force --timestamp --options runtime "${executablePath}"`, { stdio: 'inherit' });
          console.log(`✅ Signed ${executableName}`);
        } catch (error) {
          console.error(`❌ Failed to sign ${executableName}:`, error.message);
          // Continue with other helpers
        }
      }
    }
  }
  
  // Sign main executable
  const mainExecutablePath = path.join(appPath, 'Contents', 'MacOS', appName);
  if (fs.existsSync(mainExecutablePath)) {
    try {
      console.log(`Signing main executable...`);
      execSync(`codesign --sign "${identity}" --force --timestamp --options runtime --entitlements "${path.join(__dirname, 'entitlements.mac.plist')}" "${mainExecutablePath}"`, { stdio: 'inherit' });
      console.log(`✅ Signed main executable`);
    } catch (error) {
      console.error(`❌ Failed to sign main executable:`, error.message);
    }
  }
};










