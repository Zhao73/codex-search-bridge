import { chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);
const serverPath = resolve(repositoryRoot, "src/server.ts");
const fakeCodexMjs = resolve(
  repositoryRoot,
  "tests/fixtures/fake-codex.mjs",
);
const fakeCodexCmd = resolve(
  repositoryRoot,
  "tests/fixtures/fake-codex.cmd",
);

function stringEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

describe("stdio MCP server", () => {
  let client: Client | undefined;

  beforeEach(async () => {
    if (process.platform !== "win32") {
      await chmod(fakeCodexMjs, 0o755);
    }
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", serverPath],
      cwd: repositoryRoot,
      env: {
        ...stringEnvironment(),
        CODEX_SEARCH_BRIDGE_CODEX_BIN:
          process.platform === "win32" ? fakeCodexCmd : fakeCodexMjs,
      },
      stderr: "pipe",
    });
    client = new Client({ name: "bridge-test-client", version: "1.0.0" });
    await client.connect(transport);
  });

  afterEach(async () => {
    await client?.close();
  });

  it("lists exactly the research and doctor tools", async () => {
    const response = await client!.listTools();
    expect(response.tools.map((tool) => tool.name).sort()).toEqual([
      "doctor",
      "research_web",
    ]);
  });

  it("returns machine-readable INVALID_INPUT without running Codex", async () => {
    const response = await client!.callTool({
      name: "research_web",
      arguments: { question: "" },
    });

    expect(response.isError).toBe(true);
    expect(JSON.stringify(response.content)).toContain("INVALID_INPUT");
  });

  it("returns structured verified research from the fake Codex worker", async () => {
    const response = await client!.callTool({
      name: "research_web",
      arguments: {
        question: "When did it launch?",
        depth: "standard",
      },
    });

    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      verification: {
        status: "verified",
        web_search_events: 1,
        opened_page_events: 1,
      },
    });
  });
});
