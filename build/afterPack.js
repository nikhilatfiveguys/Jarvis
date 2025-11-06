const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function afterPack(context) {
  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  
  console.log('Cleaning resource forks...');
  
  try {
    // Remove resource forks and extended attributes
    execSync(`find "${appPath}" -name "._*" -delete`, { stdio: 'inherit' });
    execSync(`xattr -cr "${appPath}"`, { stdio: 'inherit' });
    console.log('Resource forks cleaned successfully');
  } catch (error) {
    console.warn('Warning: Could not clean resource forks:', error.message);
  }
  
  // Create DMG background with arrow if it doesn't exist
  try {
    const buildDir = path.join(__dirname);
    const backgroundPath = path.join(buildDir, 'dmg-background.png');
    
    if (!fs.existsSync(backgroundPath)) {
      console.log('Creating DMG background image...');
      const { createDMGBackground } = require('./createDMGBackground');
      createDMGBackground();
      
      // Try to convert SVG to PNG if rsvg-convert is available
      const svgPath = path.join(buildDir, 'dmg-background.svg');
      if (fs.existsSync(svgPath)) {
        try {
          execSync(`rsvg-convert -w 540 -h 380 "${svgPath}" -o "${backgroundPath}"`, { stdio: 'inherit' });
          console.log('✅ Converted SVG to PNG');
        } catch (e) {
          console.log('⚠️  rsvg-convert not available. Using SVG (may need manual conversion)');
        }
      }
    }
  } catch (error) {
    console.warn('Warning: Could not create DMG background:', error.message);
  }
};