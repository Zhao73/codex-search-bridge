import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildClaudeArgs } from "../src/claude-worker.js";
import { runCodexProcess } from "../src/codex-process.js";

const here = dirname(fileURLToPath(import.meta.url));
const echoArgsScript = resolve(here, "fixtures/echo-args.mjs");
const echoArgsShim = resolve(here, "fixtures/echo-args.cmd");

async function spawnEcho(
  command: string,
  args: readonly string[],
): Promise<string[]> {
  const result = await runCodexProcess({
    command,
    args: [...args],
    cwd: here,
    input: "",
    timeoutMs: 30_000,
    maxStdoutBytes: 256 * 1_024,
    maxStderrBytes: 64 * 1_024,
    env: process.env,
  });
  return JSON.parse(result.stdout.trim()) as string[];
}

describe("worker argument vector survives the spawn layer", () => {
  const claudeArgs = buildClaudeArgs({ cwd: "/tmp/task", maxTurns: 12 });

  it("includes an empty-string argument that must not be dropped", () => {
    const index = claudeArgs.indexOf("--setting-sources");
    expect(index).toBeGreaterThan(-1);
    // Loading zero settings is expressed as an empty value. If the spawn layer
    // drops it, `--setting-sources` would swallow the next flag instead.
    expect(claudeArgs[index + 1]).toBe("");
  });

  it("round-trips every argument through a direct executable spawn", async () => {
    const received = await spawnEcho(process.execPath, [
      echoArgsScript,
      ...claudeArgs,
    ]);
    expect(received).toEqual(claudeArgs);
  });

  it.runIf(process.platform === "win32")(
    "round-trips every argument through a Windows .cmd shim",
    async () => {
      // On Windows `claude` resolves to an npm-generated .cmd shim, which
      // cross-spawn runs through cmd.exe. This is where an empty-string
      // argument is most likely to be lost.
      const received = await spawnEcho(echoArgsShim, claudeArgs);
      expect(received).toEqual(claudeArgs);
    },
  );
});
