import process from "node:process";

import { z } from "zod";

import { ProviderIdSchema } from "./contracts.js";
import type { ResearchResult } from "./contracts.js";
import { runCodexProcess } from "./codex-process.js";
import { BridgeError } from "./errors.js";
import {
  detectAvailability,
  type ProviderAvailability,
  type ProviderId,
  selectProvider,
} from "./providers.js";
import {
  buildWorkerEnvironment,
  ResearchRunner,
} from "./research-runner.js";

export const DoctorReportSchema = z
  .object({
    status: z.enum(["healthy", "degraded", "failed"]),
    checked_at: z.string(),
    node: z
      .object({
        version: z.string(),
        supported: z.boolean(),
      })
      .strict(),
    codex: z
      .object({
        found: z.boolean(),
        version: z.string().optional(),
        authenticated: z.boolean(),
      })
      .strict(),
    providers: z
      .object({
        selected: ProviderIdSchema.optional(),
        codex: z.boolean(),
        claude: z.boolean(),
        tavily: z.boolean(),
      })
      .strict(),
    live_search: z
      .object({
        available: z.boolean(),
        web_search_events: z.number().int().nonnegative(),
        opened_page_events: z.number().int().nonnegative(),
        codex_open_page_events: z.number().int().nonnegative(),
        bridge_fetch_events: z.number().int().nonnegative(),
        content_audit_passes: z.number().int().nonnegative(),
      })
      .strict(),
    structured_output: z
      .object({
        valid: z.boolean(),
      })
      .strict(),
    remediations: z.array(z.string()),
  })
  .strict();

export type DoctorReport = z.infer<typeof DoctorReportSchema>;

export type DoctorDependencies = {
  nodeVersion?: string;
  getCodexVersion?: () => Promise<string>;
  runResearch?: () => Promise<ResearchResult>;
  now?: () => Date;
  availability?: () => Promise<ProviderAvailability>;
  requestedProvider?: string;
};

function nodeMajor(version: string): number | undefined {
  const match = /^v?(\d+)/.exec(version);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

function parseCodexVersion(value: string): string | undefined {
  return /codex(?:-cli)?\s+([0-9]+\.[0-9]+\.[0-9]+)/i.exec(value)?.[1];
}

async function defaultCodexVersion(): Promise<string> {
  const result = await runCodexProcess({
    command: process.env.CODEX_SEARCH_BRIDGE_CODEX_BIN ?? "codex",
    args: ["--version"],
    cwd: process.cwd(),
    input: "",
    timeoutMs: 10_000,
    maxStdoutBytes: 64 * 1_024,
    maxStderrBytes: 64 * 1_024,
    env: buildWorkerEnvironment(),
  });
  return `${result.stdout}\n${result.stderr}`.trim();
}

async function defaultResearch(): Promise<ResearchResult> {
  const runner = new ResearchRunner();
  return runner.run({
    question:
      "Find the official OpenAI homepage, explicitly open the page, and report its exact title and URL.",
    depth: "standard",
    max_sources: 3,
    language: "en",
  });
}

function baseReport(
  checkedAt: string,
  version: string,
  nodeSupported: boolean,
): DoctorReport {
  return {
    status: "failed",
    checked_at: checkedAt,
    node: { version, supported: nodeSupported },
    codex: { found: false, authenticated: false },
    providers: { codex: false, claude: false, tavily: false },
    live_search: {
      available: false,
      web_search_events: 0,
      opened_page_events: 0,
      codex_open_page_events: 0,
      bridge_fetch_events: 0,
      content_audit_passes: 0,
    },
    structured_output: { valid: false },
    remediations: [],
  };
}

export async function runDoctor(
  dependencies: DoctorDependencies = {},
): Promise<DoctorReport> {
  const now = dependencies.now ?? (() => new Date());
  const nodeVersion = dependencies.nodeVersion ?? process.version;
  const major = nodeMajor(nodeVersion);
  const nodeSupported = major !== undefined && major >= 20;
  const report = baseReport(now().toISOString(), nodeVersion, nodeSupported);

  if (!nodeSupported) {
    report.remediations.push("Install Node.js 20 or newer.");
    return DoctorReportSchema.parse(report);
  }

  const detect = dependencies.availability ?? (() => detectAvailability());
  const availability = await detect();
  report.providers = { ...availability };

  let selected: ProviderId;
  try {
    selected = selectProvider(availability, dependencies.requestedProvider);
    report.providers.selected = selected;
  } catch {
    report.remediations.push(
      "No research provider is available. Install Codex CLI or Claude Code and sign in, or set TAVILY_API_KEY.",
    );
    return DoctorReportSchema.parse(report);
  }

  // The Codex version gate only applies when Codex is the backend that will
  // actually run the search.
  if (selected === "codex") {
    const getCodexVersion = dependencies.getCodexVersion ?? defaultCodexVersion;
    try {
      const rawVersion = await getCodexVersion();
      report.codex.found = true;
      const version = parseCodexVersion(rawVersion);
      if (version !== undefined) {
        report.codex.version = version;
      } else {
        report.status = "degraded";
        report.remediations.push(
          "Update Codex CLI because its version string was not recognized.",
        );
      }
    } catch (error) {
      report.remediations.push(
        error instanceof BridgeError && error.code === "CODEX_NOT_FOUND"
          ? "Install Codex CLI or set CODEX_SEARCH_BRIDGE_CODEX_BIN."
          : "Verify that the Codex CLI can start from this environment.",
      );
      return DoctorReportSchema.parse(report);
    }
  } else {
    report.codex.found = availability.codex;
  }

  const runResearch = dependencies.runResearch ?? defaultResearch;
  try {
    const result = await runResearch();
    report.codex.authenticated = selected === "codex";
    report.live_search = {
      available:
        result.verification.web_search_events > 0 &&
        result.verification.opened_page_events > 0,
      web_search_events: result.verification.web_search_events,
      opened_page_events: result.verification.opened_page_events,
      codex_open_page_events: result.verification.codex_open_page_events,
      bridge_fetch_events: result.verification.bridge_fetch_events,
      content_audit_passes: result.verification.content_audit_passes,
    };
    report.structured_output.valid = true;
    report.status = report.live_search.available ? report.status === "degraded" ? "degraded" : "healthy" : "failed";
    if (!report.live_search.available) {
      report.remediations.push(
        `Enable live web search and verify that the ${selected} provider both searches and opens a page.`,
      );
    }
  } catch (error) {
    if (error instanceof BridgeError) {
      if (error.code === "CODEX_AUTH_REQUIRED") {
        report.remediations.push("Sign in to Codex, then run doctor again.");
      } else if (error.code === "WEB_SEARCH_UNAVAILABLE") {
        report.codex.authenticated = selected === "codex";
        report.remediations.push(
          "Enable live Web Search in the Codex account or workspace policy.",
        );
      } else if (error.code === "EVIDENCE_VERIFICATION_FAILED") {
        report.codex.authenticated = selected === "codex";
        report.remediations.push(
          "Confirm Codex emits both live web_search and open_page evidence.",
        );
      } else {
        report.remediations.push(
          "Run Codex CLI directly and verify that a structured live-search task succeeds.",
        );
      }
    } else {
      report.remediations.push(
        "Run Codex CLI directly and verify that a structured live-search task succeeds.",
      );
    }
  }

  return DoctorReportSchema.parse(report);
}
