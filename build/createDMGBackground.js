const fs = require('fs');
const path = require('path');

/**
 * Creates a DMG background image with an arrow pointing from app to Applications folder
 * This is a simple SVG-based approach that will be converted to PNG
 */
function createDMGBackground() {
  const backgroundDir = path.join(__dirname, '..', 'build');
  const backgroundPath = path.join(backgroundDir, 'dmg-background.png');
  
  // Create SVG with arrow
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="540" height="380" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <rect width="540" height="380" fill="#f5f5f5"/>
  
  <!-- Arrow pointing from app (left) to Applications (right) -->
  <defs>
    <marker id="arrowhead" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto">
      <polygon points="0 0, 10 3, 0 6" fill="#333" />
    </marker>
  </defs>
  
  <!-- Arrow line -->
  <line x1="230" y1="240" x2="330" y2="240" 
        stroke="#333" stroke-width="3" 
        marker-end="url(#arrowhead)"/>
  
  <!-- Optional: "Drag to install" text -->
  <text x="270" y="220" 
        font-family="Helvetica, Arial, sans-serif" 
        font-size="16" 
        font-weight="bold" 
        fill="#333" 
        text-anchor="middle">Drag to install</text>
</svg>`;
  
  // Save SVG (we'll convert it to PNG using a system command if available)
  const svgPath = path.join(backgroundDir, 'dmg-background.svg');
  fs.writeFileSync(svgPath, svg);
  
  console.log('✅ Created DMG background SVG at:', svgPath);
  console.log('📝 Note: For best results, convert SVG to PNG using:');
  console.log('   brew install librsvg  # if needed');
  console.log('   rsvg-convert -w 540 -h 380 dmg-background.svg -o dmg-background.png');
  
  return svgPath;
}

// Run if called directly
if (require.main === module) {
  createDMGBackground();
}

module.exports = { createDMGBackground };


