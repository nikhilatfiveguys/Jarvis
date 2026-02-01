const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Helper to copy to RAM disk and back (avoids com.apple.provenance)
function cleanOnRamDisk(filePath) {
  const fileName = path.basename(filePath);
  const ramDiskPath = '/tmp/jarvis-clean';
  const tempPath = path.join(ramDiskPath, fileName);
  
  try {
    // Create temp directory
    if (!fs.existsSync(ramDiskPath)) {
      fs.mkdirSync(ramDiskPath, { recursive: true });
    }
    
    // Read file content
    const content = fs.readFileSync(filePath);
    
    // Write to temp location
    fs.writeFileSync(tempPath, content, { mode: 0o755 });
    
    // Remove all attributes from temp
    execSync(`xattr -c "${tempPath}" 2>/dev/null || true`);
    
    // Read back and write to original location
    const cleanContent = fs.readFileSync(tempPath);
    fs.unlinkSync(filePath);
    
    // Use writeFileSync with specific flags to avoid provenance
    const fd = fs.openSync(filePath, 'w', 0o755);
    fs.writeSync(fd, cleanContent);
    fs.closeSync(fd);
    
    // Final cleanup
    fs.unlinkSync(tempPath);
    
    return true;
  } catch (e) {
    console.error(`  Failed to clean ${fileName}:`, e.message);
    return false;
  }
}

exports.default = async function cleanBeforeSign(context) {
  const { appOutDir, packager } = context;
  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  
  console.log('🧹 Aggressively cleaning resource forks and extended attributes before signing...');
  
  try {
    // Clean entire app bundle recursively
    execSync(`find "${appPath}" -name "._*" -delete`, { stdio: 'inherit' });
    execSync(`xattr -cr "${appPath}"`, { stdio: 'inherit' });
    
    // Clean main executable using RAM disk method
    const mainExecutablePath = path.join(appPath, 'Contents', 'MacOS', appName);
    if (fs.existsSync(mainExecutablePath)) {
      console.log('Cleaning main executable...');
      
      // Try multiple methods to clean the main executable
      // Method 1: Read content and rewrite through /tmp
      try {
        const tempDir = '/tmp/jarvis-clean-exec';
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        const tempPath = path.join(tempDir, 'clean-exec');
        
        // Read raw bytes
        const content = fs.readFileSync(mainExecutablePath);
        
        // Write to temp location
        fs.writeFileSync(tempPath, content);
        execSync(`chmod +x "${tempPath}"`);
        execSync(`xattr -c "${tempPath}" 2>/dev/null || true`);
      
        // Remove original and copy back using cp without preserving attributes
        fs.unlinkSync(mainExecutablePath);
        execSync(`cp "${tempPath}" "${mainExecutablePath}"`);
        execSync(`chmod +x "${mainExecutablePath}"`);
        execSync(`xattr -c "${mainExecutablePath}" 2>/dev/null || true`);
        
        // Clean up
        fs.unlinkSync(tempPath);
        
        console.log('✅ Cleaned main executable');
      } catch (e) {
        console.log(`⚠️ Error cleaning main executable: ${e.message}`);
        // Try fallback method
        if (cleanOnRamDisk(mainExecutablePath)) {
          console.log('✅ Cleaned main executable (fallback)');
        } else {
          console.log('⚠️ Could not fully clean main executable');
        }
      }
    }
    
    // Clean all helper apps and their executables
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
        // Clean entire helper app bundle
        execSync(`xattr -cr "${helperPath}"`, { stdio: 'inherit' });
        execSync(`find "${helperPath}" -name "._*" -delete`, { stdio: 'inherit' });
        
        const helperMacosPath = path.join(helperPath, 'Contents', 'MacOS');
        if (fs.existsSync(helperMacosPath)) {
          const executableName = helper.replace('.app', '');
          const executablePath = path.join(helperMacosPath, executableName);
          
          if (fs.existsSync(executablePath)) {
            // Remove existing signature
            execSync(`codesign --remove-signature "${executablePath}" 2>/dev/null || true`, { stdio: 'inherit' });
            
            // Aggressive removal of ALL extended attributes
            execSync(`xattr -c "${executablePath}"`, { stdio: 'inherit' });
            
            // Try to remove specific attributes individually
            const attrsToRemove = [
              'com.apple.provenance',
              'com.apple.FinderInfo',
              'com.apple.ResourceFork',
              'com.apple.quarantine',
              'com.apple.metadata:kMDItemWhereFroms'
            ];
            
            for (const attr of attrsToRemove) {
              execSync(`xattr -d "${attr}" "${executablePath}" 2>/dev/null || true`, { stdio: 'inherit' });
            }
            
            // Use ditto to copy without resource forks or extended attributes
            const tempExecPath = `${executablePath}.temp`;
            execSync(`ditto --norsrc --noextattr "${executablePath}" "${tempExecPath}"`, { stdio: 'inherit' });
            execSync(`rm -f "${executablePath}"`, { stdio: 'inherit' });
            execSync(`mv "${tempExecPath}" "${executablePath}"`, { stdio: 'inherit' });
            execSync(`chmod +x "${executablePath}"`, { stdio: 'inherit' });
            
            // Final aggressive cleanup - remove ALL attributes again
            execSync(`xattr -c "${executablePath}"`, { stdio: 'inherit' });
            
            // Use SetFile to clear Finder info if available
            try {
              execSync(`SetFile -a c "${executablePath}"`, { stdio: 'inherit' });
            } catch (error) {
              // SetFile might not be available, ignore
            }
            
            // Verify it's clean
            let xattrCheck = execSync(`xattr -l "${executablePath}" 2>&1 || echo ""`, { encoding: 'utf8' });
            if (xattrCheck.trim() && !xattrCheck.includes('No such xattr') && !xattrCheck.includes('No such file')) {
              console.warn(`⚠️ Warning: Extended attributes still present on ${executableName}, trying aggressive cleanup...`);
              
              // Last resort: Copy via stdin/stdout to strip all metadata, then use SetFile to clear Finder info
              try {
                // Copy file content only (strips all metadata)
                execSync(`cat "${executablePath}" > "${tempExecPath}"`, { stdio: 'inherit' });
                execSync(`chmod +x "${tempExecPath}"`, { stdio: 'inherit' });
                
                // Use SetFile to clear Finder attributes (this removes Finder info from file metadata)
                try {
                  execSync(`SetFile -a c "${tempExecPath}"`, { stdio: 'inherit' });
                } catch (error) {
                  // SetFile might not be available, continue
                }
                
                execSync(`rm -f "${executablePath}"`, { stdio: 'inherit' });
                execSync(`mv "${tempExecPath}" "${executablePath}"`, { stdio: 'inherit' });
                
                // Remove all extended attributes
                execSync(`xattr -c "${executablePath}"`, { stdio: 'inherit' });
                
                // Try Python script to remove provenance (handles binary data better)
                try {
                  const pythonScript = path.join(__dirname, 'remove-provenance.py');
                  execSync(`python3 "${pythonScript}" "${executablePath}"`, { stdio: 'inherit' });
                } catch (error) {
                  // Python script might not work, try xattr again
                  try {
                    execSync(`xattr -w com.apple.provenance "" "${executablePath}" 2>&1 || xattr -d com.apple.provenance "${executablePath}" 2>&1 || true`, { stdio: 'inherit' });
                  } catch (error) {
                    // Ignore
                  }
                }
                
                // Final cleanup
                execSync(`xattr -c "${executablePath}"`, { stdio: 'inherit' });
                
                // Verify again
                xattrCheck = execSync(`xattr -l "${executablePath}" 2>&1 || echo ""`, { encoding: 'utf8' });
                if (xattrCheck.trim() && !xattrCheck.includes('No such xattr') && !xattrCheck.includes('No such file')) {
                  // If still present, try one more aggressive method: use cp from /dev/zero to overwrite metadata
                  console.warn(`⚠️ com.apple.provenance still present on ${executableName}, trying final method...`);
                  try {
                    // Use DeRez to extract and remove Finder info from resource fork
                    console.log(`Attempting to remove Finder info from ${executableName} using DeRez...`);
                    try {
                      // Extract Finder info (this will fail if there's no Finder info, which is fine)
                      execSync(`DeRez -only 'fndr' "${executablePath}" > /dev/null 2>&1 || true`, { stdio: 'inherit' });
                      
                      // Read file content (binary)
                      const fileContent = fs.readFileSync(executablePath);
                      
                      // Write to temp file without any metadata
                      fs.writeFileSync(tempExecPath, fileContent, { mode: 0o755 });
                      
                      // Use Rez to write empty Finder info (clears resource fork)
                      execSync(`Rez -o "${tempExecPath}" /dev/null 2>&1 || true`, { stdio: 'inherit' });
                      
                      execSync(`rm -f "${executablePath}"`, { stdio: 'inherit' });
                      execSync(`mv "${tempExecPath}" "${executablePath}"`, { stdio: 'inherit' });
                      execSync(`xattr -c "${executablePath}"`, { stdio: 'inherit' });
                      
                      // Final check
                      xattrCheck = execSync(`xattr -l "${executablePath}" 2>&1 || echo ""`, { encoding: 'utf8' });
                      if (xattrCheck.trim() && !xattrCheck.includes('No such xattr') && !xattrCheck.includes('No such file')) {
                        console.warn(`⚠️ com.apple.provenance still present after DeRez/Rez - this is a macOS system limitation`);
                        console.warn(`⚠️ The attribute may be re-added by macOS immediately after removal`);
                        console.warn(`⚠️ You may need to sign with a workaround or rebuild Electron`);
                      } else {
                        console.log(`✅ Cleaned ${executableName} using DeRez/Rez`);
                      }
                    } catch (error) {
                      console.error(`❌ DeRez/Rez method failed for ${executableName}:`, error.message);
                      // Fallback to simple file copy
                      const fileContent = fs.readFileSync(executablePath);
                      fs.writeFileSync(tempExecPath, fileContent, { mode: 0o755 });
                      execSync(`rm -f "${executablePath}"`, { stdio: 'inherit' });
                      execSync(`mv "${tempExecPath}" "${executablePath}"`, { stdio: 'inherit' });
                      execSync(`xattr -c "${executablePath}"`, { stdio: 'inherit' });
                    }
                  } catch (error) {
                    console.error(`❌ Final cleanup failed for ${executableName}:`, error.message);
                  }
                } else {
                  console.log(`✅ Cleaned ${executableName} using stdin/stdout copy`);
                }
              } catch (error) {
                console.error(`❌ Failed to clean ${executableName} completely:`, error.message);
              }
            } else {
              console.log(`✅ Cleaned ${executableName}`);
            }
          }
        }
      }
    }
    
    console.log('✅ Cleaning complete - ready for signing');
  } catch (error) {
    console.error('❌ Error cleaning before sign:', error.message);
    throw error;
  }
};
