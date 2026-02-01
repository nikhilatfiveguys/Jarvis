const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

exports.default = async function afterPack(context) {
  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  
  console.log('Aggressively cleaning resource forks and extended attributes...');
  
  try {
    // Step 1: Remove all resource forks and extended attributes recursively
    execSync(`find "${appPath}" -name "._*" -delete`, { stdio: 'inherit' });
    execSync(`xattr -cr "${appPath}"`, { stdio: 'inherit' });
    
    // Step 2: Use ditto to copy the entire app bundle without resource forks
    const tempPath = path.join(appOutDir, `${appName}.app.temp`);
    
    // Remove temp if it exists
    execSync(`rm -rf "${tempPath}"`, { stdio: 'inherit' });
    
    // Copy without resource forks using ditto --norsrc (recursive)
    execSync(`ditto --norsrc --noextattr "${appPath}" "${tempPath}"`, { stdio: 'inherit' });
    
    // Remove original
    execSync(`rm -rf "${appPath}"`, { stdio: 'inherit' });
    
    // Move back
    execSync(`mv "${tempPath}" "${appPath}"`, { stdio: 'inherit' });
    
    // Step 3: Final cleanup pass
    execSync(`find "${appPath}" -name "._*" -delete`, { stdio: 'inherit' });
    execSync(`xattr -cr "${appPath}"`, { stdio: 'inherit' });
    
    // Remove Finder info using SetFile (if available)
    try {
      execSync(`find "${appPath}" -type f -exec SetFile -a c {} \\;`, { stdio: 'inherit' });
    } catch (error) {
      // SetFile might not be available, ignore
    }
    
    // Clean all helper apps and remove existing signatures
    const frameworksPath = path.join(appPath, 'Contents', 'Frameworks');
    const helpers = [
      'Jarvis 5.0 Helper.app',
      'Jarvis 5.0 Helper (GPU).app',
      'Jarvis 5.0 Helper (Plugin).app',
      'Jarvis 5.0 Helper (Renderer).app'
    ];
    
    for (const helper of helpers) {
      const helperPath = path.join(frameworksPath, helper);
      if (fs.existsSync(helperPath)) {
        // Clean entire helper app bundle
        execSync(`xattr -cr "${helperPath}"`, { stdio: 'inherit' });
        execSync(`find "${helperPath}" -name "._*" -delete`, { stdio: 'inherit' });
        
        const helperMacosPath = path.join(helperPath, 'Contents', 'MacOS');
        if (fs.existsSync(helperMacosPath)) {
          // Remove existing signatures from executables
          const executableName = helper.replace('.app', '');
          const executablePath = path.join(helperMacosPath, executableName);
          
          if (fs.existsSync(executablePath)) {
            try {
              // Remove existing signature (ignore errors if none exists)
              execSync(`codesign --remove-signature "${executablePath}" 2>/dev/null || true`, { stdio: 'inherit' });
            } catch (error) {
              // Ignore errors
            }
            
            // Aggressively clean resource forks and extended attributes from executable
            execSync(`xattr -cr "${executablePath}"`, { stdio: 'inherit' });
            execSync(`find "${executablePath}" -name "._*" -delete 2>/dev/null || true`, { stdio: 'inherit' });
            
            // Remove specific problematic attributes
            execSync(`xattr -d com.apple.provenance "${executablePath}" 2>/dev/null || true`, { stdio: 'inherit' });
            execSync(`xattr -d com.apple.FinderInfo "${executablePath}" 2>/dev/null || true`, { stdio: 'inherit' });
            execSync(`xattr -d com.apple.ResourceFork "${executablePath}" 2>/dev/null || true`, { stdio: 'inherit' });
            
            // Use cp -X to copy executable without extended attributes, then clean
            const tempExecPath = `${executablePath}.temp`;
            try {
              // Copy without extended attributes using cp -X
              execSync(`cp -X "${executablePath}" "${tempExecPath}"`, { stdio: 'inherit' });
              execSync(`rm -f "${executablePath}"`, { stdio: 'inherit' });
              execSync(`mv "${tempExecPath}" "${executablePath}"`, { stdio: 'inherit' });
              execSync(`chmod +x "${executablePath}"`, { stdio: 'inherit' });
              
              // Final aggressive cleanup - remove ALL extended attributes
              execSync(`xattr -c "${executablePath}"`, { stdio: 'inherit' });
              
              // Remove any remaining Finder info using DeRez if available, or SetFile
              try {
                execSync(`SetFile -a c "${executablePath}"`, { stdio: 'inherit' });
              } catch (error) {
                // SetFile might not be available, ignore
              }
              
              // Verify no extended attributes remain
              const xattrCheck = execSync(`xattr -l "${executablePath}" 2>&1 || echo ""`, { encoding: 'utf8' });
              if (xattrCheck.trim() && !xattrCheck.includes('No such xattr') && !xattrCheck.includes('No such file')) {
                console.warn(`Warning: Extended attributes still present on ${executablePath}:`, xattrCheck);
                // Try one more aggressive removal
                execSync(`xattr -c "${executablePath}"`, { stdio: 'inherit' });
              }
            } catch (error) {
              console.warn(`Warning: Could not clean executable ${executablePath}:`, error.message);
            }
          }
        }
      }
    }
    
    console.log('Resource forks and extended attributes cleaned successfully');
  } catch (error) {
    console.warn('Warning: Could not clean resource forks:', error.message);
  }
};