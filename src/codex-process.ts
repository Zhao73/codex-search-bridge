import type { ChildProcess } from "node:child_process";
import process from "node:process";

import spawn from "cross-spawn";

import { BridgeError } from "./errors.js";

export type CodexProcessRequest = {
  command: string;
  args: string[];
  cwd: string;
  input: string;
  timeoutMs: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
};

export type CodexProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type DiagnosticOptions = {
  homeDirectory?: string;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitizeDiagnostic(
  value: string,
  options: DiagnosticOptions = {},
): string {
  let sanitized = value
    .replace(/\bBearer\s+[^\s]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(
      /\b(?:OPENAI_API_KEY|CODEX_API_KEY|API_KEY|TOKEN)=([^\s]+)/gi,
      (match) => `${match.slice(0, match.indexOf("=") + 1)}[REDACTED]`,
    );

  if (options.homeDirectory !== undefined && options.homeDirectory.length > 1) {
    sanitized = sanitized.replace(
      new RegExp(escapeRegExp(options.homeDirectory), "g"),
      "[HOME]",
    );
  }
  return sanitized;
}

function mapNonZeroExit(stderr: string): BridgeError {
  if (/\b(?:401|unauthorized|not logged in|authentication required)\b/i.test(stderr)) {
    return new BridgeError(
      "CODEX_AUTH_REQUIRED",
      "Codex authentication is required or has expired.",
      { remediation: "Sign in to Codex, then run the Bridge doctor again." },
    );
  }
  if (
    /web search.{0,80}(?:disabled|unavailable|not allowed|forbidden)|workspace.{0,80}search.{0,80}(?:disabled|blocked)/is.test(
      stderr,
    )
  ) {
    return new BridgeError(
      "WEB_SEARCH_UNAVAILABLE",
      "Live web search is unavailable for this Codex environment.",
      {
        remediation:
          "Check Codex account, organization, and workspace web-search policy.",
      },
    );
  }
  return new BridgeError(
    "WORKER_FAILED",
    "The Codex research worker exited unsuccessfully.",
  );
}

function terminateProcessTree(
  child: ChildProcess,
  force: boolean,
): void {
  if (child.pid === undefined || child.killed) {
    return;
  }

  if (process.platform === "win32") {
    const args = ["/pid", String(child.pid), "/T", ...(force ? ["/F"] : [])];
    const killer = spawn("taskkill", args, {
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    });
    killer.unref();
    return;
  }

  try {
    process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
  } catch {
    child.kill(force ? "SIGKILL" : "SIGTERM");
  }
}

export function runCodexProcess(
  request: CodexProcessRequest,
): Promise<CodexProcessResult> {
  if (request.signal?.aborted === true) {
    return Promise.reject(
      new BridgeError("WORKER_CANCELLED", "The research request was cancelled."),
    );
  }

  return new Promise((resolve, reject) => {
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: request.env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    if (child.stdin === null || child.stdout === null || child.stderr === null) {
      reject(
        new BridgeError(
          "WORKER_FAILED",
          "The Codex process did not expose the required stdio pipes.",
        ),
      );
      return;
    }
    const childStdin = child.stdin;
    const childStdout = child.stdout;
    const childStderr = child.stderr;
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let terminalError: BridgeError | undefined;
    let forceTimer: NodeJS.Timeout | undefined;

    const terminateWith = (error: BridgeError): void => {
      if (terminalError !== undefined) {
        return;
      }
      terminalError = error;
      terminateProcessTree(child, false);
      forceTimer = setTimeout(() => terminateProcessTree(child, true), 1_000);
      forceTimer.unref();
    };

    const timeout = setTimeout(() => {
      terminateWith(
        new BridgeError(
          "WORKER_TIMEOUT",
          `The research worker exceeded its ${request.timeoutMs} ms timeout.`,
        ),
      );
    }, request.timeoutMs);
    timeout.unref();

    const onAbort = (): void => {
      terminateWith(
        new BridgeError("WORKER_CANCELLED", "The research request was cancelled."),
      );
    };
    request.signal?.addEventListener("abort", onAbort, { once: true });

    childStdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength;
      if (stdoutBytes > request.maxStdoutBytes) {
        terminateWith(
          new BridgeError(
            "OUTPUT_LIMIT_EXCEEDED",
            "The research worker exceeded the stdout limit.",
          ),
        );
        return;
      }
      stdoutChunks.push(chunk);
    });

    childStderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes > request.maxStderrBytes) {
        terminateWith(
          new BridgeError(
            "OUTPUT_LIMIT_EXCEEDED",
            "The research worker exceeded the stderr limit.",
          ),
        );
        return;
      }
      stderrChunks.push(chunk);
    });

    child.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timeout);
      if (forceTimer !== undefined) {
        clearTimeout(forceTimer);
      }
      request.signal?.removeEventListener("abort", onAbort);
      if (error.code === "ENOENT") {
        reject(
          new BridgeError("CODEX_NOT_FOUND", "The Codex executable was not found.", {
            cause: error,
            remediation:
              "Install Codex CLI or set CODEX_SEARCH_BRIDGE_CODEX_BIN.",
          }),
        );
        return;
      }
      reject(
        new BridgeError("WORKER_FAILED", "The Codex process could not start.", {
          cause: error,
        }),
      );
    });

    child.once("close", (code) => {
      clearTimeout(timeout);
      if (forceTimer !== undefined) {
        clearTimeout(forceTimer);
      }
      request.signal?.removeEventListener("abort", onAbort);
      if (terminalError !== undefined) {
        reject(terminalError);
        return;
      }

      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      const exitCode = code ?? 1;
      if (exitCode !== 0) {
        reject(mapNonZeroExit(stderr));
        return;
      }
      resolve({ stdout, stderr, exitCode });
    });

    childStdin.on("error", () => {
      // The close/error handlers provide the authoritative process outcome.
    });
    childStdin.end(request.input);
  });
}

type QueueEntry = {
  start: () => void;
  reject: (error: BridgeError) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
};

export class WorkerQueue {
  readonly #maxActive: number;
  readonly #maxQueued: number;
  #active = 0;
  readonly #queued: QueueEntry[] = [];

  constructor(maxActive = 2, maxQueued = 8) {
    this.#maxActive = maxActive;
    this.#maxQueued = maxQueued;
  }

  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted === true) {
      return Promise.reject(
        new BridgeError("WORKER_CANCELLED", "The research request was cancelled."),
      );
    }

    return new Promise<T>((resolve, reject) => {
      const execute = (): void => {
        this.#active += 1;
        void task().then(resolve, reject).finally(() => {
          this.#active -= 1;
          this.#dispatch();
        });
      };

      if (this.#active < this.#maxActive) {
        execute();
        return;
      }
      if (this.#queued.length >= this.#maxQueued) {
        reject(
          new BridgeError(
            "QUEUE_FULL",
            "The local research-worker queue is full.",
          ),
        );
        return;
      }

      const entry: QueueEntry = { start: execute, reject, ...(signal === undefined ? {} : { signal }) };
      if (signal !== undefined) {
        const abortListener = (): void => {
          const index = this.#queued.indexOf(entry);
          if (index !== -1) {
            this.#queued.splice(index, 1);
          }
          reject(
            new BridgeError(
              "WORKER_CANCELLED",
              "The queued research request was cancelled.",
            ),
          );
        };
        entry.abortListener = abortListener;
        signal.addEventListener("abort", abortListener, { once: true });
      }
      this.#queued.push(entry);
    });
  }

  #dispatch(): void {
    while (this.#active < this.#maxActive) {
      const entry = this.#queued.shift();
      if (entry === undefined) {
        return;
      }
      if (entry.abortListener !== undefined) {
        entry.signal?.removeEventListener("abort", entry.abortListener);
      }
      entry.start();
    }
  }
}
