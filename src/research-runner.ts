import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { ZodError } from "zod";

import {
  type ResearchResult,
  normalizeWorkerResult,
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
import {
  combineCodexEvidence,
  type CodexEvidence,
  parseCodexJsonl,
} from "./jsonl-events.js";
import {
  fetchPages,
  mergePageFetchEvidence,
  type FetchPagesOptions,
  type PageFetchSummary,
} from "./page-fetch.js";
import {
  buildClaudeArgs,
  extractJsonObject,
  parseClaudeStream,
  stripClaudeRedirects,
} from "./claude-worker.js";
import {
  detectAvailability,
  type EvidenceTier,
  type ProviderId,
  resolveProviderBinaries,
  selectProvider,
} from "./providers.js";
import { buildAuditPrompt, buildResearchPrompt } from "./research-prompt.js";
import {
  buildTavilyEvidence,
  buildTavilyResult,
  tavilySearch,
  type TavilyResponse,
} from "./tavily.js";
import { resolveTimeWindow } from "./time-window.js";
import { matchObservedUrl } from "./url-evidence.js";
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

/**
 * Claude Code authenticates from the user's own login rather than from an
 * OPENAI_* key, so the Claude worker needs a different passthrough set.
 * `ANTHROPIC_BASE_URL` is deliberately absent: a worker pointed at a
 * third-party gateway would run an open-weight model with no server-side
 * WebSearch tool, which is exactly the failure this provider exists to avoid.
 */
const CLAUDE_ENVIRONMENT_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  // Claude Code resolves the macOS Keychain entry for the logged-in account
  // from USER. Without it the worker reports "Not logged in" even though the
  // user has a valid session, so this is load-bearing, not cosmetic.
  // LOGNAME and USERNAME are the Linux and Windows equivalents.
  "USER",
  "LOGNAME",
  "USERNAME",
  "HOMEDRIVE",
  "HOMEPATH",
  "ANTHROPIC_API_KEY",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
  "APPDATA",
  "LOCALAPPDATA",
] as const;

/**
 * Unlike the Codex worker, the Claude worker keeps the real HOME.
 *
 * Claude Code resolves its login from the user's config directory and, on
 * macOS, the Keychain. Both a fresh HOME and an isolated `CLAUDE_CONFIG_DIR`
 * make it report "Not logged in", which would break every subscription user.
 * Isolation is therefore enforced on the command line instead — no MCP servers
 * (`--strict-mcp-config`), no settings or hooks (`--setting-sources ""`), an
 * allowlist limited to the two read-only web tools, and a throwaway cwd. Only
 * the temp directory is redirected here.
 */
export function buildClaudeWorkerEnvironment(
  source: NodeJS.ProcessEnv = process.env,
  isolation?: WorkerIsolation,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of CLAUDE_ENVIRONMENT_KEYS) {
    if (
      isolation !== undefined &&
      (key === "TMPDIR" || key === "TMP" || key === "TEMP")
    ) {
      continue;
    }
    const value = source[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  if (isolation !== undefined) {
    result.TMPDIR = isolation.tempDirectory;
    result.TMP = isolation.tempDirectory;
    result.TEMP = isolation.tempDirectory;
  }
  // Drops a gateway key that would be rejected by the real Anthropic endpoint.
  return stripClaudeRedirects({
    ...result,
    ...(source.ANTHROPIC_BASE_URL === undefined
      ? {}
      : { ANTHROPIC_BASE_URL: source.ANTHROPIC_BASE_URL }),
  });
}

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
  isolation?: WorkerIsolation,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_ENVIRONMENT_KEYS) {
    if (
      isolation !== undefined &&
      (key === "HOME" ||
        key === "USERPROFILE" ||
        key === "CODEX_HOME" ||
        key === "TMPDIR" ||
        key === "TMP" ||
        key === "TEMP")
    ) {
      continue;
    }
    const value = source[key];
    if (value !== undefined) {
      result[key] = value;
    }
  }
  if (isolation !== undefined) {
    result.HOME = isolation.homeDirectory;
    result.USERPROFILE = isolation.homeDirectory;
    result.CODEX_HOME = isolation.codexHomeDirectory;
    result.TMPDIR = isolation.tempDirectory;
    result.TMP = isolation.tempDirectory;
    result.TEMP = isolation.tempDirectory;
  }
  return result;
}

export type WorkerIsolation = {
  homeDirectory: string;
  codexHomeDirectory: string;
  tempDirectory: string;
  authCopied: boolean;
};

function originalCodexHome(source: NodeJS.ProcessEnv): string | undefined {
  if (source.CODEX_HOME !== undefined && source.CODEX_HOME.length > 0) {
    return source.CODEX_HOME;
  }
  const home = source.HOME ?? source.USERPROFILE;
  return home === undefined || home.length === 0 ? undefined : join(home, ".codex");
}

export async function prepareWorkerIsolation(
  taskDirectory: string,
  source: NodeJS.ProcessEnv = process.env,
  provider: ProviderId = "codex",
): Promise<WorkerIsolation> {
  const homeDirectory = join(taskDirectory, "home");
  const codexHomeDirectory = join(taskDirectory, "codex-home");
  const tempDirectory = join(taskDirectory, "tmp");
  await Promise.all([
    mkdir(homeDirectory, { recursive: true, mode: 0o700 }),
    mkdir(codexHomeDirectory, { recursive: true, mode: 0o700 }),
    mkdir(tempDirectory, { recursive: true, mode: 0o700 }),
  ]);

  // The Claude worker authenticates from the user's real config directory, so
  // there is no auth material to stage into the task directory.
  if (provider === "claude") {
    return {
      homeDirectory,
      codexHomeDirectory,
      tempDirectory,
      authCopied: false,
    };
  }

  let authCopied = false;
  const codexHome = originalCodexHome(source);
  if (
    (source.OPENAI_API_KEY === undefined || source.OPENAI_API_KEY.length === 0) &&
    codexHome !== undefined
  ) {
    try {
      const target = join(codexHomeDirectory, "auth.json");
      await copyFile(join(codexHome, "auth.json"), target);
      await chmod(target, 0o600);
      authCopied = true;
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (code !== "ENOENT") {
        throw new BridgeError(
          "WORKER_FAILED",
          "Codex authentication could not be copied into the isolated worker.",
          { cause: error },
        );
      }
    }
  }

  return {
    homeDirectory,
    codexHomeDirectory,
    tempDirectory,
    authCopied,
  };
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
  pageFetcher?: (
    urls: readonly string[],
    options?: FetchPagesOptions,
  ) => Promise<PageFetchSummary>;
  environment?: NodeJS.ProcessEnv;
  queue?: WorkerQueue;
  /** `codex`, `claude`, `tavily`, or `auto` (default). */
  provider?: string;
  claudeCommand?: string;
  searchApi?: (options: {
    apiKey: string;
    question: string;
    maxResults: number;
    depth: "quick" | "standard" | "deep";
    startDate?: string;
    endDate?: string;
    signal?: AbortSignal;
  }) => Promise<TavilyResponse>;
  availability?: () => Promise<{
    codex: boolean;
    claude: boolean;
    tavily: boolean;
  }>;
};

export type ResearchRunOptions = {
  signal?: AbortSignal;
};

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function bindAuthoritativeMetadata(
  workerValue: unknown,
  input: ResearchWebInput,
  timestamp: string,
  provider: ProviderId = "codex",
): unknown {
  const record = asObject(workerValue);
  if (record === undefined) {
    return workerValue;
  }
  const sources = Array.isArray(record.sources)
    ? record.sources.map((source) => {
        const sourceRecord = asObject(source);
        return sourceRecord === undefined
          ? source
          : {
              ...sourceRecord,
              retrieved_at: timestamp,
              provenance_verified: false,
            };
      })
    : record.sources;

  return {
    ...record,
    as_of: timestamp,
    query: {
      question: input.question,
      depth: input.depth,
      max_sources: input.max_sources,
      ...(input.recency_hours === undefined
        ? {}
        : { recency_hours: input.recency_hours }),
      ...(input.date_from === undefined ? {} : { date_from: input.date_from }),
      ...(input.date_to === undefined ? {} : { date_to: input.date_to }),
      ...(input.language === undefined ? {} : { language: input.language }),
    },
    sources,
    // Always discarded and re-authored by the verifier; the worker never gets
    // to grade its own evidence.
    verification: {
      status: "failed",
      provider,
      evidence_tier: provider === "tavily" ? "search_api" : "native",
      web_search_events: 0,
      opened_page_events: 0,
      codex_open_page_events: 0,
      bridge_fetch_events: 0,
      content_audit_passes: 0,
      cited_sources_verified: 0,
      total_cited_sources: 0,
    },
  };
}

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
  readonly #pageFetcher: (
    urls: readonly string[],
    options?: FetchPagesOptions,
  ) => Promise<PageFetchSummary>;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #queue: WorkerQueue;
  readonly #requestedProvider: string;
  readonly #claudeCommand: string;
  readonly #searchApi: NonNullable<ResearchRunnerOptions["searchApi"]>;
  readonly #availability: NonNullable<ResearchRunnerOptions["availability"]>;

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
    this.#pageFetcher = options.pageFetcher ?? fetchPages;
    this.#environment = options.environment ?? process.env;
    this.#queue = options.queue ?? new WorkerQueue();
    this.#requestedProvider =
      options.provider ??
      this.#environment.CODEX_SEARCH_BRIDGE_PROVIDER ??
      "auto";
    this.#claudeCommand =
      options.claudeCommand ?? resolveProviderBinaries(this.#environment).claudeBin;
    this.#searchApi = options.searchApi ?? tavilySearch;
    // Detection must probe the commands this runner will actually spawn, not
    // the bare names. A caller that injects an explicit `command` (tests, or a
    // user pointing at a non-PATH install) would otherwise be told the
    // provider is missing.
    this.#availability =
      options.availability ??
      (() =>
        detectAvailability(this.#environment, {
          codexBin: this.#command,
          claudeBin: this.#claudeCommand,
        }));
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

    const provider = selectProvider(
      await this.#availability(),
      this.#requestedProvider,
    );

    return this.#queue.run(
      () =>
        provider === "tavily"
          ? this.#runSearchApi(input, options.signal)
          : this.#runIsolated(input, provider, options.signal),
      options.signal,
    );
  }

  /**
   * Search-API path: no agent worker exists, so the Bridge itself opens every
   * cited page through the restricted verifier and the result is capped at the
   * `search_api` evidence tier.
   */
  async #runSearchApi(
    input: ResearchWebInput,
    signal: AbortSignal | undefined,
  ): Promise<ResearchResult> {
    const apiKey = (this.#environment.TAVILY_API_KEY ?? "").trim();
    if (apiKey.length === 0) {
      throw new BridgeError(
        "PROVIDER_UNAVAILABLE",
        "The Tavily provider requires TAVILY_API_KEY.",
      );
    }

    // Tavily filters on whole calendar days, so the resolved window collapses
    // to YYYY-MM-DD bounds. An hour-level `recency_hours` therefore widens to
    // its containing day rather than being dropped.
    const now = this.#now();
    const window = resolveTimeWindow(input, now);
    const startDate = window.from ?? window.fromInstant?.slice(0, 10);
    const endDate = window.to ?? window.toInstant?.slice(0, 10);

    const response = await this.#searchApi({
      apiKey,
      question: input.question,
      maxResults: input.max_sources,
      depth: input.depth,
      ...(startDate === undefined ? {} : { startDate }),
      ...(endDate === undefined ? {} : { endDate }),
      ...(signal === undefined ? {} : { signal }),
    });

    const fetchSummary = await this.#pageFetcher(
      response.results.map((result) => result.url).slice(0, input.max_sources),
      {
        maxPages: input.max_sources,
        ...(signal === undefined ? {} : { signal }),
      },
    );

    const timestamp = this.#now().toISOString();
    const draft = buildTavilyResult({
      input,
      response,
      fetchSummary,
      timestamp,
    });
    const evidence = mergePageFetchEvidence(
      buildTavilyEvidence(response),
      fetchSummary,
    );

    return verifyResearchResult(draft, evidence, {
      depth: input.depth,
      provider: "tavily",
      evidenceTier: "search_api",
    });
  }

  async #runIsolated(
    input: ResearchWebInput,
    provider: ProviderId,
    signal: AbortSignal | undefined,
  ): Promise<ResearchResult> {
    const taskDirectory = await mkdtemp(
      join(this.#tempRoot, "codex-search-bridge-"),
    );
    const now = this.#now();

    try {
      const isolation = await prepareWorkerIsolation(
        taskDirectory,
        this.#environment,
        provider,
      );
      const initial = await this.#runWorker({
        taskDirectory,
        isolation,
        input,
        provider,
        prompt: buildResearchPrompt(input, now, this.#timezone, provider),
        outputFilename: "research-result.json",
        metadataTimestamp: now.toISOString(),
        signal,
      });
      let result = initial.result;
      const codexEvidence = initial.evidence;
      const sourceUrlsWithoutOpenEvidence = result.sources
        .filter(
          (source) =>
            matchObservedUrl(
              source.url,
              codexEvidence.openedUrls,
              codexEvidence.redirects,
            ) === undefined,
        )
        .map((source) => source.url);
      const fetchSummary = await this.#pageFetcher(
        sourceUrlsWithoutOpenEvidence,
        {
          maxPages: input.max_sources,
          ...(signal === undefined ? {} : { signal }),
        },
      );
      let evidence = mergePageFetchEvidence(codexEvidence, fetchSummary);

      if (fetchSummary.successes.length > 0) {
        const auditNow = this.#now();
        const audited = await this.#runWorker({
          taskDirectory,
          isolation,
          input,
          provider,
          prompt: buildAuditPrompt(
            input,
            result,
            fetchSummary,
            auditNow,
            this.#timezone,
            provider,
          ),
          outputFilename: "audited-result.json",
          metadataTimestamp: auditNow.toISOString(),
          signal,
        });
        result = audited.result;
        const combinedEvidence = combineCodexEvidence(
          evidence,
          audited.evidence,
        );
        evidence = {
          ...combinedEvidence,
          contentAuditPasses: combinedEvidence.contentAuditPasses + 1,
        };

        const newSourceUrls = result.sources
          .filter(
            (source) =>
              matchObservedUrl(
                source.url,
                evidence.openedUrls,
                evidence.redirects,
              ) === undefined,
          )
          .map((source) => source.url);
        const finalFetchSummary = await this.#pageFetcher(newSourceUrls, {
          maxPages: input.max_sources,
          ...(signal === undefined ? {} : { signal }),
        });
        evidence = mergePageFetchEvidence(evidence, finalFetchSummary);
      }

      const completedAt = this.#now().toISOString();
      const authoritativeResult: ResearchResult = {
        ...result,
        as_of: completedAt,
        sources: result.sources.map((source) => ({
          ...source,
          retrieved_at: completedAt,
          provenance_verified: false,
        })),
      };
      const evidenceTier: EvidenceTier =
        evidence.contentAuditPasses > 0 ? "native_audited" : "native";
      return verifyResearchResult(authoritativeResult, evidence, {
        depth: input.depth,
        provider,
        evidenceTier,
      });
    } finally {
      await rm(taskDirectory, { recursive: true, force: true });
    }
  }

  async #runWorker(options: {
    taskDirectory: string;
    isolation: WorkerIsolation;
    input: ResearchWebInput;
    provider: ProviderId;
    prompt: string;
    outputFilename: string;
    metadataTimestamp: string;
    signal: AbortSignal | undefined;
  }): Promise<{ result: ResearchResult; evidence: CodexEvidence }> {
    const { parsed, evidence } =
      options.provider === "claude"
        ? await this.#runClaudeWorker(options)
        : await this.#runCodexWorker(options);

    let result: ResearchResult;
    try {
      result = normalizeWorkerResult(
        bindAuthoritativeMetadata(
          parsed,
          options.input,
          options.metadataTimestamp,
          options.provider,
        ),
      );
    } catch (error) {
      throw new BridgeError(
        "INVALID_STRUCTURED_OUTPUT",
        `The ${options.provider} research worker produced JSON that does not match the research schema.`,
        { cause: error instanceof ZodError ? error.issues : error },
      );
    }
    return { result, evidence };
  }

  async #runCodexWorker(options: {
    taskDirectory: string;
    isolation: WorkerIsolation;
    input: ResearchWebInput;
    prompt: string;
    outputFilename: string;
    signal: AbortSignal | undefined;
  }): Promise<{ parsed: unknown; evidence: CodexEvidence }> {
    const outputPath = join(options.taskDirectory, options.outputFilename);
    const codexArgs = buildCodexArgs({
      cwd: options.taskDirectory,
      schemaPath: this.#schemaPath,
      outputPath,
      ...(this.#model === undefined ? {} : { model: this.#model }),
    });
    const processResult = await this.#processRunner({
      command: this.#command,
      args: [...this.#commandPrefixArgs, ...codexArgs],
      cwd: options.taskDirectory,
      input: options.prompt,
      timeoutMs: TIMEOUTS[options.input.depth],
      maxStdoutBytes: 8 * 1_024 * 1_024,
      maxStderrBytes: 1 * 1_024 * 1_024,
      env: buildWorkerEnvironment(this.#environment, options.isolation),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    try {
      return {
        parsed: JSON.parse(await readFile(outputPath, "utf8")),
        evidence: parseCodexJsonl(processResult.stdout),
      };
    } catch (error) {
      if (error instanceof BridgeError) {
        throw error;
      }
      throw new BridgeError(
        "INVALID_STRUCTURED_OUTPUT",
        "Codex did not produce valid JSON at the expected result path.",
        { cause: error },
      );
    }
  }

  /**
   * Claude Code has no `--output-schema` or `--output-last-message`, so the
   * result is recovered from the final assistant message in the stream and
   * validated afterwards by `normalizeWorkerResult`.
   */
  async #runClaudeWorker(options: {
    taskDirectory: string;
    isolation: WorkerIsolation;
    input: ResearchWebInput;
    prompt: string;
    signal: AbortSignal | undefined;
  }): Promise<{ parsed: unknown; evidence: CodexEvidence }> {
    const claudeArgs = buildClaudeArgs({
      cwd: options.taskDirectory,
      maxTurns: options.input.depth === "deep" ? 24 : 12,
      ...(this.#model === undefined ? {} : { model: this.#model }),
    });
    const processResult = await this.#processRunner({
      command: this.#claudeCommand,
      args: claudeArgs,
      label: "Claude Code",
      cwd: options.taskDirectory,
      input: options.prompt,
      timeoutMs: TIMEOUTS[options.input.depth],
      maxStdoutBytes: 8 * 1_024 * 1_024,
      maxStderrBytes: 1 * 1_024 * 1_024,
      env: buildClaudeWorkerEnvironment(this.#environment, options.isolation),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });

    const summary = parseClaudeStream(processResult.stdout);
    if (summary.isError) {
      throw new BridgeError(
        "WORKER_FAILED",
        "The Claude research worker reported an error result.",
      );
    }
    if (summary.finalMessage === undefined) {
      throw new BridgeError(
        "INVALID_STRUCTURED_OUTPUT",
        "The Claude research worker returned no final message.",
      );
    }

    return {
      parsed: extractJsonObject(summary.finalMessage),
      evidence: summary.evidence,
    };
  }
}
