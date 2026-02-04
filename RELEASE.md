# Releasing Jarvis (signed DMG + GitHub)

## Two steps: sign first, then push

**Step 1 — Sign the DMG** (build, sign app, create DMG, notarize):

```bash
./build-signed.sh
```

**Step 2 — Push to GitHub** (after the signed DMG exists in `dist/`):

```bash
export GH_TOKEN=your_github_token   # or: gh auth login
./push-release-to-github.sh
```

That’s it. The release (e.g. v1.4.4) will have the signed DMG plus zip + `latest-mac.yml` for in-app updates.

## Updating from 1.4.1 → 1.4.4

Users on v1.4.1 (or any earlier 1.4.x) get the update via **Jarvis menu → Check for updates**. The app uses `electron-updater` and the GitHub release’s `latest-mac.yml` + zip.

## Credentials

- **Apple (notarize + sign):** Set in `build-signed.sh` (`APPLE_ID`, `APPLE_ID_PASSWORD`, `APPLE_TEAM_ID`).
- **GitHub:** Set `GH_TOKEN` or run `gh auth login` before `./publish-release-signed.sh`.
