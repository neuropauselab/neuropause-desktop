# resources

Build resources for electron-builder live here.

## App icon

- `icon.svg` — **editable source** (indigo squircle + pause glyph). This is the
  master; edit it, or replace it with final brand art, then regenerate the
  binaries below.
- `icon.icns` — macOS icon, generated from the source (16→1024, incl. retina).
  Referenced by `mac.icon` in `electron-builder.yml`.
- `icon.ico` — Windows icon, generated from the source (16→256).
  Referenced by `win.icon` in `electron-builder.yml`.
- `icon.png` — 512×512 generic/Linux fallback.

Regenerate the binaries after editing `icon.svg` (needs `sharp` + `png2icons`):

```js
// node regen-icons.js  (from this directory)
const fs = require('fs');
const sharp = require('sharp');
const png2icons = require('png2icons');
(async () => {
  const master = await sharp('icon.svg', { density: 384 }).resize(1024, 1024).png().toBuffer();
  fs.writeFileSync('icon.icns', png2icons.createICNS(master, png2icons.BICUBIC, 0));
  fs.writeFileSync('icon.ico',  png2icons.createICO(master, png2icons.BICUBIC, 0, false));
  await sharp(master).resize(512, 512).png().toFile('icon.png');
})();
```

## Signing

- `entitlements.mac.plist` / `entitlements.mac.inherit.plist` — required for the
  macOS hardened runtime once code signing / notarization is enabled.

The app runs in development (`npm run dev`) and as an unsigned local build
(`npm run package:dir`). Signed, notarized distribution requires the Apple
Developer ID and Windows Authenticode certificates (supplied via CI secrets).
