import { access, readFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = resolve(root, "plugins/codex-search-bridge");

async function json(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
}

function resolveInsidePlugin(relativePath: string): string {
  const resolved = resolve(pluginRoot, relativePath);
  expect(resolved.startsWith(`${pluginRoot}${sep}`)).toBe(true);
  return resolved;
}

describe("Codex plugin package", () => {
  it("declares complete public plugin metadata", async () => {
    const manifest = await json(
      resolve(pluginRoot, ".codex-plugin/plugin.json"),
    );

    expect(manifest).toMatchObject({
      name: "codex-search-bridge",
      version: "0.1.0",
      description:
        "Verified Codex live-web research for tool-capable external models.",
      author: { name: "Zhao73", url: "https://github.com/Zhao73" },
      repository: "https://github.com/Zhao73/codex-search-bridge",
      homepage: "https://github.com/Zhao73/codex-search-bridge#readme",
      license: "Apache-2.0",
      skills: "./skills/",
      mcpServers: "./.mcp.json",
    });
    expect(JSON.stringify(manifest)).not.toContain("TODO");
  });

  it("declares a local stdio MCP server with safe relative paths", async () => {
    const config = await json(resolve(pluginRoot, ".mcp.json"));
    const servers = config.mcpServers as Record<
      string,
      { command: string; args: string[]; cwd: string }
    >;
    const bridge = servers["codex-search-bridge"];

    expect(bridge).toMatchObject({
      command: "node",
      args: ["./dist/server.mjs"],
      cwd: ".",
    });
    await access(resolveInsidePlugin(bridge!.args[0]!));
    await access(resolveInsidePlugin("./schemas/research-result.schema.json"));
  });

  it("contains a discoverable concise skill with MCP dependency metadata", async () => {
    const skillRoot = resolve(
      pluginRoot,
      "skills/verified-web-research",
    );
    const skill = await readFile(resolve(skillRoot, "SKILL.md"), "utf8");
    const metadata = await readFile(
      resolve(skillRoot, "agents/openai.yaml"),
      "utf8",
    );

    expect(skill).toContain("name: verified-web-research");
    expect(skill).toContain("research_web");
    expect(skill).toContain("未确认");
    expect(skill).not.toContain("TODO");
    expect(metadata).toContain('value: "codex-search-bridge"');
    expect(metadata).toContain("allow_implicit_invocation: true");
  });

  it("publishes one installable marketplace entry", async () => {
    const marketplace = await json(
      resolve(root, ".agents/plugins/marketplace.json"),
    );
    expect(marketplace).toMatchObject({
      name: "codex-search-bridge",
      interface: { displayName: "Codex Search Bridge" },
      plugins: [
        {
          name: "codex-search-bridge",
          source: {
            source: "local",
            path: "./plugins/codex-search-bridge",
          },
          policy: {
            installation: "AVAILABLE",
            authentication: "ON_INSTALL",
          },
          category: "Productivity",
        },
      ],
    });
  });
});
