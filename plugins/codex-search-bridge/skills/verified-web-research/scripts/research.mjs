#!/usr/bin/env node
import { spawn } from "node:child_process";
import process from "node:process";
import { fileURLToPath } from "node:url";

const serverPath = fileURLToPath(
  new URL("../../../dist/server.mjs", import.meta.url),
);
const child = spawn(process.execPath, [serverPath, "--research-stdin"], {
  env: {
    ...process.env,
    CODEX_SEARCH_BRIDGE_CLI_ONLY: "0",
  },
  stdio: "inherit",
  shell: false,
  windowsHide: true,
});

child.once("error", (error) => {
  process.stderr.write(`Codex Search Bridge CLI failed to start: ${error.message}\n`);
  process.exitCode = 1;
});
child.once("close", (code) => {
  process.exitCode = code ?? 1;
});
