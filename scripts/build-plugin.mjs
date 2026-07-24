import { chmod, copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(root, "plugins/codex-search-bridge");
const copies = [
  [resolve(root, "dist/server.mjs"), resolve(pluginRoot, "dist/server.mjs")],
  [
    resolve(root, "schemas/research-result.schema.json"),
    resolve(pluginRoot, "schemas/research-result.schema.json"),
  ],
];

for (const [source, destination] of copies) {
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

await chmod(resolve(pluginRoot, "dist/server.mjs"), 0o755);
