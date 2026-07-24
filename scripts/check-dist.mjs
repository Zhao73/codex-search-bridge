import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pairs = [
  [resolve(root, "dist/server.mjs"), resolve(root, "plugins/codex-search-bridge/dist/server.mjs")],
  [
    resolve(root, "schemas/research-result.schema.json"),
    resolve(root, "plugins/codex-search-bridge/schemas/research-result.schema.json"),
  ],
];

for (const [built, packaged] of pairs) {
  const [builtBytes, packagedBytes] = await Promise.all([
    readFile(built),
    readFile(packaged),
  ]);
  if (!builtBytes.equals(packagedBytes)) {
    throw new Error(`Packaged artifact is stale: ${packaged}`);
  }
}

process.stdout.write("Plugin distribution matches the clean build.\n");
