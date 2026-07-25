import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  bundle: true,
  noExternal: [/.*/],
  banner: {
    js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
  },
  splitting: false,
  sourcemap: false,
  clean: true,
  outDir: "dist",
  outExtension: () => ({ js: ".mjs" }),
});
