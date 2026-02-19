# Build size breakdown & how to reduce it

## Current breakdown (before a fresh build)

Approximate sizes from the last built `.app`:

| Component | Size | Notes |
|-----------|------|--------|
| **Electron Framework** (Chromium + Node) | **~222 MB** | In `Contents/Frameworks/`. Baseline; can’t remove. |
| **Electron locales** (55 languages) | **~52 MB** | In `Electron Framework.framework/.../Resources/*.lproj`. **Now stripped to English only** (~2 MB) → **saves ~50 MB**. |
| **app.asar** (your app + packed node_modules) | **~305 MB** (old build) | Was bloated by DMG/junk; **after fix ~80–120 MB** expected. |
| **app.asar.unpacked** (native addons, updater) | **~72 MB** | Unpacked for native modules & electron-updater. |
| **icon.icns, .lproj placeholders** | **~1 MB** | Minor. |
| **Total .app** | **~600 MB** (old) | **After optimizations: ~350–400 MB** expected. |
| **DMG** (compressed) | **~356 MB** (old) | **After optimizations: ~150–220 MB** expected. |

---

## Optimizations already applied

1. **Packaging**
   - No longer packing `**/*` (DMG, scripts, etc. excluded).
   - Explicit `files` list so only needed app + node_modules are included.

2. **Dependencies**
   - Removed: `pdfjs-dist`, `whisper-node`, `config-file-ts`, `node-record-lpcm16`, `wav`, `sax`, `googleapis` (monolithic).
   - Only `@googleapis/gmail`, `calendar`, `docs`, `drive` + `google-auth-library` kept (~5 MB for Google).

3. **Native**
   - Only `native/mac-content-protection/build/**` packed; `bin/` (extra copies) excluded.

4. **Locales**
   - `mac.electronLanguages: ["en"]` → only English locale kept in Electron (~50 MB saved).

5. **Compression**
   - `compression: "maximum"` for the build.
   - `!**/*.map` in `files` to avoid packing source maps.

---

## How to get the smaller size

1. **Clean install** (drops unused packages like the 193 MB `googleapis`):
   ```bash
   npm install
   npm prune
   ```

2. **Rebuild**:
   ```bash
   npm run build-unsigned
   ```
   Or your signed build.

3. **Check size**:
   - DMG: `dist/Jarvis 6.0-1.4.6-arm64.dmg`
   - Unpacked: `dist/mac-arm64/Jarvis 6.0.app`

---

## If you need to shrink further

- **Lazy-load integrations**: Require Google/Polar/Supabase only when the user opens Account or uses those features (saves initial asar size; more code change).
- **Single architecture**: You already build arm64-only for Mac; no change unless you add x64.
- **Electron**: Size is dominated by Chromium; switching to a lighter runtime is a much larger project.
