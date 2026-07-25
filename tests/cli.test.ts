import { chmod } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import spawn from "cross-spawn";
import { beforeAll, describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = resolve(root, "src/server.ts");
const fakeCodexMjs = resolve(root, "tests/fixtures/fake-codex.mjs");
const fakeCodexCmd = resolve(root, "tests/fixtures/fake-codex.cmd");

function runCli(input: string): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", serverPath, "--research-stdin"],
      {
        cwd: root,
        env: {
          ...process.env,
          CODEX_SEARCH_BRIDGE_CODEX_BIN:
            process.platform === "win32" ? fakeCodexCmd : fakeCodexMjs,
        },
        shell: false,
        windowsHide: true,
      },
    );
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) => {
      resolveResult({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
    child.stdin?.end(input);
  });
}

beforeAll(async () => {
  if (process.platform !== "win32") {
    await chmod(fakeCodexMjs, 0o755);
  }
});

describe("CLI-only compatibility entry", () => {
  it("runs the same verified research engine from one JSON line", async () => {
    const execution = await runCli(
      `${JSON.stringify({
        question: "When did it launch?",
        depth: "standard",
      })}\n`,
    );
    const result = JSON.parse(execution.stdout) as Record<string, unknown>;

    expect(execution.code).toBe(0);
    expect(execution.stderr).toBe("");
    expect(result.verification).toMatchObject({
      status: "verified",
      web_search_events: 1,
      opened_page_events: 1,
    });
  });

  it("returns a stable public error for malformed input", async () => {
    const execution = await runCli("not-json\n");

    expect(execution.code).toBe(1);
    expect(JSON.parse(execution.stdout)).toMatchObject({
      code: "INVALID_INPUT",
    });
  });

  it("accepts one double-escaped newline terminator from a command-tool PTY", async () => {
    const execution = await runCli(
      `${JSON.stringify({
        question: "When did it launch?",
        depth: "standard",
      })}\\n\n`,
    );
    const result = JSON.parse(execution.stdout) as Record<string, unknown>;

    expect(execution.code).toBe(0);
    expect(result.verification).toMatchObject({
      status: "verified",
      web_search_events: 1,
      opened_page_events: 1,
    });
  });
});
