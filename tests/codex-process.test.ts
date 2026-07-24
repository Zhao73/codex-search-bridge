import { describe, expect, it } from "vitest";

import {
  runCodexProcess,
  sanitizeDiagnostic,
  WorkerQueue,
} from "../src/codex-process.js";

function nodeRequest(
  source: string,
  overrides: Partial<Parameters<typeof runCodexProcess>[0]> = {},
): Parameters<typeof runCodexProcess>[0] {
  return {
    command: process.execPath,
    args: ["-e", source],
    cwd: process.cwd(),
    input: "hello from stdin",
    timeoutMs: 2_000,
    maxStdoutBytes: 64 * 1_024,
    maxStderrBytes: 64 * 1_024,
    env: { ...process.env },
    ...overrides,
  };
}

describe("runCodexProcess", () => {
  it("writes the research prompt to stdin", async () => {
    const result = await runCodexProcess(
      nodeRequest(
        "let s='';process.stdin.on('data',c=>s+=c);process.stdin.on('end',()=>process.stdout.write(s));",
      ),
    );

    expect(result.stdout).toBe("hello from stdin");
    expect(result.exitCode).toBe(0);
  });

  it("maps a timeout to WORKER_TIMEOUT", async () => {
    await expect(
      runCodexProcess(
        nodeRequest("setInterval(()=>{},1000)", { timeoutMs: 30 }),
      ),
    ).rejects.toMatchObject({ code: "WORKER_TIMEOUT" });
  });

  it("maps abort to WORKER_CANCELLED", async () => {
    const controller = new AbortController();
    const promise = runCodexProcess(
      nodeRequest("setInterval(()=>{},1000)", { signal: controller.signal }),
    );
    setTimeout(() => controller.abort(), 30);

    await expect(promise).rejects.toMatchObject({
      code: "WORKER_CANCELLED",
    });
  });

  it("enforces stdout byte limits", async () => {
    await expect(
      runCodexProcess(
        nodeRequest("process.stdout.write('x'.repeat(4096))", {
          maxStdoutBytes: 100,
        }),
      ),
    ).rejects.toMatchObject({
      code: "OUTPUT_LIMIT_EXCEEDED",
    });
  });

  it("maps authentication failures without exposing stderr", async () => {
    await expect(
      runCodexProcess(
        nodeRequest(
          "process.stderr.write('401 not logged in sk-secret123');process.exit(1)",
        ),
      ),
    ).rejects.toMatchObject({
      code: "CODEX_AUTH_REQUIRED",
      message: expect.not.stringContaining("sk-secret123"),
    });
  });

  it("maps a missing executable to CODEX_NOT_FOUND", async () => {
    await expect(
      runCodexProcess({
        ...nodeRequest(""),
        command: `missing-codex-${Date.now()}`,
      }),
    ).rejects.toMatchObject({ code: "CODEX_NOT_FOUND" });
  });
});

describe("sanitizeDiagnostic", () => {
  it("redacts tokens, bearer credentials, and home paths", () => {
    expect(
      sanitizeDiagnostic(
        "Authorization: Bearer abc.def sk-secret123 /Users/alice/private",
        { homeDirectory: "/Users/alice" },
      ),
    ).toBe("Authorization: Bearer [REDACTED] [REDACTED] [HOME]/private");
  });
});

describe("WorkerQueue", () => {
  it("bounds active and queued worker requests", async () => {
    const queue = new WorkerQueue(1, 1);
    let releaseFirst: (() => void) | undefined;
    const first = queue.run(
      () =>
        new Promise<string>((resolve) => {
          releaseFirst = () => resolve("first");
        }),
    );
    const second = queue.run(async () => "second");

    await expect(queue.run(async () => "third")).rejects.toMatchObject({
      code: "QUEUE_FULL",
    });
    releaseFirst?.();
    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
  });

  it("removes a cancelled queued request", async () => {
    const queue = new WorkerQueue(1, 1);
    let releaseFirst: (() => void) | undefined;
    const first = queue.run(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    const controller = new AbortController();
    const queued = queue.run(async () => "queued", controller.signal);
    controller.abort();

    await expect(queued).rejects.toMatchObject({ code: "WORKER_CANCELLED" });
    releaseFirst?.();
    await first;
    await expect(queue.run(async () => "replacement")).resolves.toBe(
      "replacement",
    );
  });
});
