# resources

Build resources for electron-builder live here:

- `icon.icns` — macOS app icon (1024×1024 source recommended). Add your own.
- `entitlements.mac.plist` — required once you enable code signing / notarization.

These are intentionally omitted from the Phase 1 foundation because they are
account- and brand-specific. The app runs in development (`npm run dev`) and as
an unsigned local build (`npm run package:dir`) without them.
