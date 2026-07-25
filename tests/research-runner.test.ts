import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildCodexArgs,
  buildWorkerEnvironment,
  bindAuthoritativeMetadata,
  prepareWorkerIsolation,
  ResearchRunner,
} from "../src/research-runner.js";

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

describe("bindAuthoritativeMetadata", () => {
  it("does not trust worker-controlled query, retrieval, or verification metadata", () => {
    const bound = bindAuthoritativeMetadata(
      {
        answer: "Result",
        as_of: "not-a-date",
        query: {
          question: "changed",
          depth: "deep",
          max_sources: 12,
          date_from: "2026-07-18T00:00:00Z",
        },
        sources: [
          {
            id: "S1",
            url: "https://example.com",
            retrieved_at: "not-a-date",
            provenance_verified: true,
          },
        ],
        verification: { status: "verified", web_search_events: 99 },
      },
      {
        question: "Original question",
        depth: "standard",
        max_sources: 6,
        recency_hours: 168,
        language: "en",
      },
      "2026-07-25T05:00:00.000Z",
    ) as Record<string, unknown>;

    expect(bound.as_of).toBe("2026-07-25T05:00:00.000Z");
    expect(bound.query).toEqual({
      question: "Original question",
      depth: "standard",
      max_sources: 6,
      recency_hours: 168,
      language: "en",
    });
    expect(bound.verification).toMatchObject({
      status: "failed",
      web_search_events: 0,
      bridge_fetch_events: 0,
      content_audit_passes: 0,
    });
    expect(bound.sources).toEqual([
      {
        id: "S1",
        url: "https://example.com",
        retrieved_at: "2026-07-25T05:00:00.000Z",
        provenance_verified: false,
      },
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
      codex_open_page_events: 1,
      bridge_fetch_events: 0,
      content_audit_passes: 0,
    });
    expect(result.sources[0]?.provenance_verified).toBe(true);
    expect(await readdir(tempRoot)).toEqual([]);
  });

  it("uses the restricted page fetcher when Codex lacks URL-bearing open evidence", async () => {
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
      pageFetcher: async (urls) => ({
        successes: urls.map((url) => ({
          requestedUrl: url,
          finalUrl: url,
          statusCode: 200,
          contentType: "text/html",
          bytesRead: 100,
          retrievedAt: "2026-07-25T03:00:01.000Z",
          redirects: [],
        })),
        failures: [],
      }),
    });

    const result = await runner.run({
      question: "Bridge fallback: when did it launch?",
      depth: "standard",
    });

    expect(result.verification).toMatchObject({
      status: "verified",
      web_search_events: 2,
      opened_page_events: 1,
      codex_open_page_events: 0,
      bridge_fetch_events: 1,
      content_audit_passes: 1,
    });
    expect(await readdir(tempRoot)).toEqual([]);
  });
});

describe("worker home isolation", () => {
  it("copies only Codex auth and points all user/temp roots at the task", async () => {
    const root = await mkdtemp(join(tmpdir(), "bridge-isolation-test-"));
    cleanupPaths.push(root);
    const sourceHome = join(root, "source-home");
    const taskDirectory = join(root, "task");
    await mkdir(join(sourceHome, ".codex", "skills"), { recursive: true });
    await mkdir(join(sourceHome, ".agents", "skills"), { recursive: true });
    await mkdir(taskDirectory);
    await writeFile(
      join(sourceHome, ".codex", "auth.json"),
      '{"test":"credential-placeholder"}',
      "utf8",
    );
    await writeFile(
      join(sourceHome, ".codex", "skills", "must-not-copy.txt"),
      "no",
      "utf8",
    );

    const sourceEnvironment: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: sourceHome,
      USERPROFILE: sourceHome,
      NODE_OPTIONS: "--require malicious.js",
    };
    const isolation = await prepareWorkerIsolation(
      taskDirectory,
      sourceEnvironment,
    );
    const environment = buildWorkerEnvironment(
      sourceEnvironment,
      isolation,
    );
    const copiedAuth = join(isolation.codexHomeDirectory, "auth.json");

    expect(isolation.authCopied).toBe(true);
    expect(await readFile(copiedAuth, "utf8")).toBe(
      '{"test":"credential-placeholder"}',
    );
    if (process.platform !== "win32") {
      expect((await stat(copiedAuth)).mode & 0o777).toBe(0o600);
    }
    expect(environment).toMatchObject({
      HOME: isolation.homeDirectory,
      USERPROFILE: isolation.homeDirectory,
      CODEX_HOME: isolation.codexHomeDirectory,
      TMPDIR: isolation.tempDirectory,
      TMP: isolation.tempDirectory,
      TEMP: isolation.tempDirectory,
    });
    expect(environment.NODE_OPTIONS).toBeUndefined();
    expect(await readdir(isolation.homeDirectory)).toEqual([]);
    expect(await readdir(isolation.codexHomeDirectory)).toEqual(["auth.json"]);
  });
});

describe("ResearchRunner search-API path", () => {
  function runnerWith(
    capture: { options?: Record<string, unknown> },
    environment: NodeJS.ProcessEnv = { TAVILY_API_KEY: "tvly-test" },
  ): ResearchRunner {
    return new ResearchRunner({
      provider: "tavily",
      environment,
      availability: async () => ({
        codex: false,
        claude: false,
        tavily: true,
      }),
      now: () => new Date("2026-07-25T03:00:00Z"),
      timezone: "UTC",
      searchApi: async (options) => {
        capture.options = { ...options };
        return {
          answer: "Node 26 is current.",
          results: [
            { title: "Release", url: "https://nodejs.org/en/blog/release" },
          ],
        };
      },
      pageFetcher: async (urls) => ({
        successes: urls.map((url) => ({
          requestedUrl: url,
          finalUrl: url,
          statusCode: 200,
          bytesRead: 64,
          retrievedAt: "2026-07-25T03:00:00.000Z",
          redirects: [],
        })),
        failures: [],
      }),
    });
  }

  it("returns a capped search-API result without spawning a worker", async () => {
    const capture: { options?: Record<string, unknown> } = {};
    const result = await runnerWith(capture).run({
      question: "What is current?",
      depth: "standard",
      max_sources: 3,
    });

    expect(result.verification.provider).toBe("tavily");
    expect(result.verification.evidence_tier).toBe("search_api");
    expect(result.verification.status).toBe("partial");
    expect(result.verification.bridge_fetch_events).toBe(1);
    expect(capture.options?.maxResults).toBe(3);
  });

  it("converts an explicit date window into YYYY-MM-DD bounds", async () => {
    const capture: { options?: Record<string, unknown> } = {};
    await runnerWith(capture).run({
      question: "What is current?",
      depth: "standard",
      max_sources: 3,
      date_from: "2026-07-01",
      date_to: "2026-07-20",
    });

    expect(capture.options?.startDate).toBe("2026-07-01");
    expect(capture.options?.endDate).toBe("2026-07-20");
  });

  it("converts recency_hours into a day bound instead of dropping it", async () => {
    const capture: { options?: Record<string, unknown> } = {};
    await runnerWith(capture).run({
      question: "What is current?",
      depth: "standard",
      max_sources: 3,
      recency_hours: 48,
    });

    // 2026-07-25T03:00Z minus 48h lands on 2026-07-23.
    expect(capture.options?.startDate).toBe("2026-07-23");
    expect(String(capture.options?.startDate)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("fails clearly when the keyed provider has no API key", async () => {
    const capture: { options?: Record<string, unknown> } = {};
    await expect(
      runnerWith(capture, {}).run({
        question: "What is current?",
        depth: "standard",
        max_sources: 3,
      }),
    ).rejects.toThrow(/PROVIDER_UNAVAILABLE/);
  });
});
