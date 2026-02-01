const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function beforeSign(context) {
  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  
  console.log('Removing existing signatures and cleaning resource forks before signing...');
  
  try {
    const frameworksPath = path.join(appPath, 'Contents', 'Frameworks');
    
    // Remove signatures from all helper apps
    const helpers = [
      'Jarvis 5.0 Helper.app',
      'Jarvis 5.0 Helper (GPU).app',
      'Jarvis 5.0 Helper (Plugin).app',
      'Jarvis 5.0 Helper (Renderer).app'
    ];
    
    for (const helper of helpers) {
      const helperPath = path.join(frameworksPath, helper);
      if (fs.existsSync(helperPath)) {
        const helperMacosPath = path.join(helperPath, 'Contents', 'MacOS');
        if (fs.existsSync(helperMacosPath)) {
          const executableName = helper.replace('.app', '');
          const executablePath = path.join(helperMacosPath, executableName);
          
          if (fs.existsSync(executablePath)) {
            try {
              // Remove existing signature
              execSync(`codesign --remove-signature "${executablePath}"`, { stdio: 'inherit' });
            } catch (error) {
              // Ignore if no signature exists
            }
            
            // Clean resource forks and extended attributes
            execSync(`xattr -cr "${executablePath}"`, { stdio: 'inherit' });
            execSync(`find "${helperMacosPath}" -name "._*" -delete`, { stdio: 'inherit' });
          }
        }
      }
    }
    
    console.log('Signatures removed and resource forks cleaned successfully');
  } catch (error) {
    console.warn('Warning: Could not clean before signing:', error.message);
  }
};












