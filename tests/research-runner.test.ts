import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { buildCodexArgs, ResearchRunner } from "../src/research-runner.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("buildCodexArgs", () => {
  it("keeps global flags before exec and applies isolation flags", () => {
    const args = buildCodexArgs({
      cwd: "/tmp/research task",
      schemaPath: "/tmp/schema.json",
      outputPath: "/tmp/result.json",
    });

    expect(args.slice(0, 4)).toEqual([
      "--search",
      "-c",
      "features.plugins=false",
      "exec",
    ]);
    expect(args).toContain("--ignore-user-config");
    expect(args).toContain("--ignore-rules");
    expect(args).toContain("--sandbox");
    expect(args).toContain("read-only");
    expect(args).toContain("--ephemeral");
    expect(args).toContain("--skip-git-repo-check");
    expect(args.at(-1)).toBe("-");
  });

  it("places an explicit model before the exec subcommand", () => {
    const args = buildCodexArgs({
      cwd: "/tmp/work",
      schemaPath: "/tmp/schema.json",
      outputPath: "/tmp/result.json",
      model: "gpt-test",
    });

    expect(args.slice(0, 6)).toEqual([
      "--search",
      "-c",
      "features.plugins=false",
      "--model",
      "gpt-test",
      "exec",
    ]);
  });
});

describe("ResearchRunner", () => {
  it("runs fake Codex, verifies evidence, and cleans its task directory", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "bridge-runner-test-"));
    cleanupPaths.push(tempRoot);
    const fakeCodex = fileURLToPath(
      new URL("./fixtures/fake-codex.mjs", import.meta.url),
    );
    const runner = new ResearchRunner({
      command: process.execPath,
      commandPrefixArgs: [fakeCodex],
      tempRoot,
      now: () => new Date("2026-07-25T03:00:00Z"),
      timezone: "UTC",
    });

    const result = await runner.run({
      question: "When did it launch?",
      depth: "standard",
    });

    expect(result.verification).toMatchObject({
      status: "verified",
      web_search_events: 1,
      opened_page_events: 1,
    });
    expect(result.sources[0]?.provenance_verified).toBe(true);
    expect(await readdir(tempRoot)).toEqual([]);
  });
});
