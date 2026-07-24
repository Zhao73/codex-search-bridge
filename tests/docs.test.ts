import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function text(path: string): Promise<string> {
  return readFile(resolve(root, path), "utf8");
}

describe("public documentation", () => {
  it.each(["README.md", "README.zh-CN.md"])(
    "%s states the compatibility and evidence contract",
    async (path) => {
      const readme = await text(path);
      for (const required of [
        "Codex Search Bridge",
        "community",
        "MCP",
        "Codex authentication",
        "quota",
        "Windows",
        "macOS",
        "codex plugin marketplace add Zhao73/codex-search-bridge",
        "codex plugin add codex-search-bridge@codex-search-bridge",
        "doctor",
        "web_search_events",
        "opened_page_events",
        "published_at",
        "event_date",
        "retrieved_at",
        "codex plugin remove codex-search-bridge@codex-search-bridge",
        "docs/architecture.md",
        "docs/security.md",
      ]) {
        expect(readme).toContain(required);
      }
    },
  );

  it("documents the security boundary and responsible disclosure", async () => {
    const architecture = await text("docs/architecture.md");
    const security = await text("docs/security.md");
    const policy = await text("SECURITY.md");

    expect(architecture).toContain("codex --search");
    expect(architecture).toContain("open_page");
    expect(architecture).toContain("URL provenance");
    expect(security).toContain("Prompt injection");
    expect(security).toContain("shell=false");
    expect(security).toContain("CODEX_HOME");
    expect(policy).toContain("GitHub Security Advisory");
    expect(policy).not.toContain("TODO");
  });

  it("defines the complete operating-system and Node CI matrix", async () => {
    const workflow = await text(".github/workflows/ci.yml");
    for (const required of [
      "ubuntu-latest",
      "macos-latest",
      "windows-latest",
      "20",
      "22",
      "npm ci",
      "npm run check",
      "npm audit --audit-level=high",
      "git diff --exit-code",
    ]) {
      expect(workflow).toContain(required);
    }
  });

  it("creates checked release archives and checksums from version tags", async () => {
    const workflow = await text(".github/workflows/release.yml");
    expect(workflow).toContain("v*");
    expect(workflow).toContain("npm run check");
    expect(workflow).toContain("sha256sum");
    expect(workflow).toContain("gh release create");
    expect(workflow).toContain("contents: write");
  });
});
