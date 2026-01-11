const fs = require('fs');
const path = require('path');

// Simple script to convert PNG to ICO using to-ico package
async function convertLogoToIco() {
  try {
    // Check if to-ico is available
    let toIco;
    try {
      toIco = require('to-ico');
    } catch (e) {
      console.error('Error: to-ico package not found. Installing...');
      console.error('Please run: npm install --save-dev to-ico');
      process.exit(1);
    }

    // Check if sharp is available for resizing
    let sharp;
    try {
      sharp = require('sharp');
    } catch (e) {
      console.log('Note: sharp not available, using original image size');
    }

    const pngPath = path.join(__dirname, 'JarvisLogo.png');
    const icoPath = path.join(__dirname, 'icon.ico');

    // Check if PNG exists
    if (!fs.existsSync(pngPath)) {
      console.error(`Error: ${pngPath} not found`);
      process.exit(1);
    }

    console.log('Reading PNG file...');
    let pngBuffer = fs.readFileSync(pngPath);

    // Resize to common icon sizes if sharp is available
    if (sharp) {
      console.log('Resizing image to 256x256 for ICO format...');
      pngBuffer = await sharp(pngBuffer)
        .resize(256, 256, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .png()
        .toBuffer();
    }

    console.log('Converting to ICO format...');
    // Create multiple sizes for better Windows compatibility
    const sizes = [256, 128, 64, 48, 32, 16];
    const buffers = [];
    
    if (sharp) {
      for (const size of sizes) {
        const resized = await sharp(pngBuffer)
          .resize(size, size, {
            fit: 'contain',
            background: { r: 0, g: 0, b: 0, alpha: 0 }
          })
          .png()
          .toBuffer();
        buffers.push(resized);
      }
    } else {
      // If no sharp, just use the original (may fail if too large)
      buffers.push(pngBuffer);
    }

    const icoBuffer = await toIco(buffers);

    console.log('Writing ICO file...');
    fs.writeFileSync(icoPath, icoBuffer);

    console.log(`Successfully created ${icoPath}`);
    console.log('The icon.ico file is now ready for use in electron-builder.');
  } catch (error) {
    console.error('Error converting logo:', error);
    console.error('\nTrying alternative method with sharp for image processing...');
    console.error('Please run: npm install --save-dev sharp');
    process.exit(1);
  }
}

convertLogoToIco();

