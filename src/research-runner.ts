import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { ZodError } from "zod";

import {
  type ResearchResult,
  ResearchResultSchema,
  type ResearchWebInput,
  ResearchWebInputSchema,
} from "./contracts.js";
import {
  type CodexProcessRequest,
  type CodexProcessResult,
  runCodexProcess,
  WorkerQueue,
} from "./codex-process.js";
import { BridgeError } from "./errors.js";
import { parseCodexJsonl } from "./jsonl-events.js";
import { buildResearchPrompt } from "./research-prompt.js";
import { resolveTimeWindow } from "./time-window.js";
import { verifyResearchResult } from "./verifier.js";

const DEFAULT_SCHEMA_PATH = fileURLToPath(
  new URL("../schemas/research-result.schema.json", import.meta.url),
);

const TIMEOUTS = {
  quick: 90_000,
  standard: 180_000,
  deep: 300_000,
} as const;

const ALLOWED_ENVIRONMENT_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "CODEX_HOME",
  "OPENAI_API_KEY",
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT_ID",
  "OPENAI_BASE_URL",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
] as const;

export type CodexArgumentOptions = {
  cwd: string;
  schemaPath: string;
  outputPath: string;
  model?: string;
};

export function buildCodexArgs(options: CodexArgumentOptions): string[] {
  return [
    "--search",
    "-c",
    "features.plugins=false",
    ...(options.model === undefined ? [] : ["--model", options.model]),
    "exec",
    "--ignore-user-config",
    "--ignore-rules",
    "--sandbox",
    "read-only",
    "--ephemeral",
    "--skip-git-repo-check",
    "--cd",
    options.cwd,
    "--json",
    "--output-schema",
    options.schemaPath,
    "--output-last-message",
    options.outputPath,
    "-",
  ];
}

export function buildWorkerEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_ENVIRONMENT_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

export type ResearchRunnerOptions = {
  command?: string;
  commandPrefixArgs?: string[];
  schemaPath?: string;
  model?: string;
  tempRoot?: string;
  timezone?: string;
  now?: () => Date;
  processRunner?: (
    request: CodexProcessRequest,
  ) => Promise<CodexProcessResult>;
  queue?: WorkerQueue;
};

export type ResearchRunOptions = {
  signal?: AbortSignal;
};

export class ResearchRunner {
  readonly #command: string;
  readonly #commandPrefixArgs: string[];
  readonly #schemaPath: string;
  readonly #model: string | undefined;
  readonly #tempRoot: string;
  readonly #timezone: string;
  readonly #now: () => Date;
  readonly #processRunner: (
    request: CodexProcessRequest,
  ) => Promise<CodexProcessResult>;
  readonly #queue: WorkerQueue;

  constructor(options: ResearchRunnerOptions = {}) {
    this.#command =
      options.command ?? process.env.CODEX_SEARCH_BRIDGE_CODEX_BIN ?? "codex";
    this.#commandPrefixArgs = [...(options.commandPrefixArgs ?? [])];
    this.#schemaPath = options.schemaPath ?? DEFAULT_SCHEMA_PATH;
    this.#model = options.model ?? process.env.CODEX_SEARCH_BRIDGE_MODEL;
    this.#tempRoot = options.tempRoot ?? tmpdir();
    this.#timezone =
      options.timezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      "UTC";
    this.#now = options.now ?? (() => new Date());
    this.#processRunner = options.processRunner ?? runCodexProcess;
    this.#queue = options.queue ?? new WorkerQueue();
  }

  async run(
    rawInput: unknown,
    options: ResearchRunOptions = {},
  ): Promise<ResearchResult> {
    let input: ResearchWebInput;
    try {
      input = ResearchWebInputSchema.parse(rawInput);
      resolveTimeWindow(input, this.#now());
    } catch (error) {
      if (error instanceof BridgeError) {
        throw error;
      }
      throw new BridgeError("INVALID_INPUT", "The research request is invalid.", {
        cause: error,
      });
    }

    return this.#queue.run(
      () => this.#runIsolated(input, options.signal),
      options.signal,
    );
  }

  async #runIsolated(
    input: ResearchWebInput,
    signal: AbortSignal | undefined,
  ): Promise<ResearchResult> {
    const taskDirectory = await mkdtemp(
      join(this.#tempRoot, "codex-search-bridge-"),
    );
    const outputPath = join(taskDirectory, "research-result.json");
    const now = this.#now();
    const prompt = buildResearchPrompt(input, now, this.#timezone);
    const codexArgs = buildCodexArgs({
      cwd: taskDirectory,
      schemaPath: this.#schemaPath,
      outputPath,
      ...(this.#model === undefined ? {} : { model: this.#model }),
    });

    try {
      const processResult = await this.#processRunner({
        command: this.#command,
        args: [...this.#commandPrefixArgs, ...codexArgs],
        cwd: taskDirectory,
        input: prompt,
        timeoutMs: TIMEOUTS[input.depth],
        maxStdoutBytes: 8 * 1_024 * 1_024,
        maxStderrBytes: 1 * 1_024 * 1_024,
        env: buildWorkerEnvironment(),
        ...(signal === undefined ? {} : { signal }),
      });

      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(outputPath, "utf8"));
      } catch (error) {
        throw new BridgeError(
          "INVALID_STRUCTURED_OUTPUT",
          "Codex did not produce valid JSON at the expected result path.",
          { cause: error },
        );
      }

      let result: ResearchResult;
      try {
        result = ResearchResultSchema.parse(parsed);
      } catch (error) {
        throw new BridgeError(
          "INVALID_STRUCTURED_OUTPUT",
          "Codex produced JSON that does not match the research schema.",
          { cause: error instanceof ZodError ? error.issues : error },
        );
      }

      const evidence = parseCodexJsonl(processResult.stdout);
      return verifyResearchResult(result, evidence, input.depth);
    } finally {
      await rm(taskDirectory, { recursive: true, force: true });
    }
  }
}
