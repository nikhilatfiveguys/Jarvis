#!/usr/bin/env node
/**
 * Create missing .js.map and .d.ts.map files referenced by sourceMappingURL.
 * electron-builder fails when it tries to open these and they don't exist.
 */
const fs = require('fs');
const path = require('path');

const EMPTY_MAP = JSON.stringify({ version: 3, sources: [], names: [], mappings: '' });
const nodeModules = path.join(__dirname, '..', 'node_modules');
const ONLY_PACKAGES = ['@polar-sh', '@supabase']; // only fix these to avoid scanning all node_modules
let created = 0;

function walk(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.name === '.bin' || e.name.startsWith('.')) continue;
    if (e.isDirectory()) {
      if (e.name === 'node_modules') {
        if (dir !== nodeModules) continue;
        const subs = fs.readdirSync(full);
        for (const sub of subs) {
          if (ONLY_PACKAGES.some(p => sub === p || sub.startsWith(p + '/'))) walk(path.join(full, sub));
        }
        continue;
      }
      walk(full);
    } else if (e.isFile() && (e.name.endsWith('.js') || e.name.endsWith('.d.ts'))) {
      try {
        const content = fs.readFileSync(full, 'utf8');
        const match = content.match(/# sourceMappingURL=(.+?)(?:\s|$)/);
        if (!match) continue;
        const mapRef = match[1].trim();
        const mapPath = path.resolve(dir, mapRef);
        if (!fs.existsSync(mapPath)) {
          fs.writeFileSync(mapPath, EMPTY_MAP);
          created++;
          if (created <= 20) console.log('Created', mapPath);
        }
      } catch (_) {}
    }
  }
}

walk(nodeModules);
console.log('Created', created, 'missing .map file(s).');
process.exit(0);
