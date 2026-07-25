import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pairs = [
  [resolve(root, "dist/server.mjs"), resolve(root, "plugins/codex-search-bridge/dist/server.mjs")],
  [
    resolve(root, "schemas/research-result.schema.json"),
    resolve(root, "plugins/codex-search-bridge/schemas/research-result.schema.json"),
  ],
  [resolve(root, "assets/logo.svg"), resolve(root, "plugins/codex-search-bridge/assets/logo.svg")],
  [resolve(root, "assets/logo.png"), resolve(root, "plugins/codex-search-bridge/assets/logo.png")],
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

const isolatedRoot = await mkdtemp(join(tmpdir(), "codex-search-bridge-dist-"));
const isolatedPlugin = join(isolatedRoot, "codex-search-bridge");
let client;
const isolatedStderr = [];
try {
  await cp(resolve(root, "plugins/codex-search-bridge"), isolatedPlugin, {
    recursive: true,
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(isolatedPlugin, "dist/server.mjs")],
    cwd: isolatedPlugin,
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => {
    isolatedStderr.push(Buffer.from(chunk));
  });
  client = new Client({ name: "isolated-dist-smoke", version: "1.0.0" });
  await client.connect(transport);
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(["doctor", "research_web"])) {
    throw new Error(`Unexpected isolated distribution tools: ${names.join(", ")}`);
  }
  process.stdout.write(
    "Isolated plugin MCP starts without repository node_modules.\n",
  );

  await client.close();
  client = undefined;

  const cliOnlyTransport = new StdioClientTransport({
    command: process.execPath,
    args: [join(isolatedPlugin, "dist/server.mjs")],
    cwd: isolatedPlugin,
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter((entry) => entry[1] !== undefined),
      ),
      CODEX_SEARCH_BRIDGE_CLI_ONLY: "1",
    },
    stderr: "pipe",
  });
  cliOnlyTransport.stderr?.on("data", (chunk) => {
    isolatedStderr.push(Buffer.from(chunk));
  });
  client = new Client({ name: "isolated-cli-only-smoke", version: "1.0.0" });
  await client.connect(cliOnlyTransport);
  const cliOnlyTools = await client.listTools();
  if (cliOnlyTools.tools.length !== 0) {
    throw new Error("CLI-only distribution unexpectedly exposed MCP tools.");
  }
  process.stdout.write(
    "Isolated plugin CLI-only mode exposes an intentional empty MCP tool list.\n",
  );
} catch (error) {
  const diagnostic = Buffer.concat(isolatedStderr).toString("utf8").trim();
  throw new Error(
    `Isolated plugin MCP failed${diagnostic.length === 0 ? "." : `: ${diagnostic}`}`,
    { cause: error },
  );
} finally {
  await client?.close();
  await rm(isolatedRoot, { recursive: true, force: true });
}
