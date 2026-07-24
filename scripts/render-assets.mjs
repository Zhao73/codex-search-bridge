import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginAssets = resolve(root, "plugins/codex-search-bridge/assets");
await mkdir(pluginAssets, { recursive: true });

await sharp(resolve(root, "assets/social-card.svg"), { density: 144 })
  .resize(1200, 630, { fit: "fill" })
  .png({ compressionLevel: 9, adaptiveFiltering: false })
  .toFile(resolve(root, "assets/social-card.png"));

await sharp(resolve(root, "assets/hero.svg"), { density: 144 })
  .resize(1440, 720, { fit: "fill" })
  .png({ compressionLevel: 9, adaptiveFiltering: false })
  .toFile(resolve(root, "assets/hero.png"));

await sharp(resolve(root, "assets/logo.svg"), { density: 144 })
  .resize(512, 512, { fit: "fill" })
  .png({ compressionLevel: 9, adaptiveFiltering: false })
  .toFile(resolve(root, "assets/logo.png"));
