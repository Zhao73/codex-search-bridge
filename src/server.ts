#!/usr/bin/env node
import { resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import {
  PROJECT_NAME,
  PROJECT_VERSION,
  ResearchResultSchema,
} from "./contracts.js";
import { sanitizeDiagnostic } from "./codex-process.js";
import {
  DoctorReportSchema,
  type DoctorReport,
  runDoctor,
} from "./doctor.js";
import { toPublicBridgeError } from "./errors.js";
import { ResearchRunner } from "./research-runner.js";

const ToolInputSchema = z
  .object({
    question: z.string().describe("The current-information question to research"),
    recency_hours: z
      .number()
      .optional()
      .describe("Optional lookback in whole hours, from 1 to 8760"),
    date_from: z
      .string()
      .optional()
      .describe("Optional inclusive start date in YYYY-MM-DD format"),
    date_to: z
      .string()
      .optional()
      .describe("Optional inclusive end date in YYYY-MM-DD format"),
    language: z
      .string()
      .optional()
      .describe("Optional BCP 47 language tag such as zh-CN, en, or ja"),
    max_sources: z
      .number()
      .optional()
      .describe("Maximum sources, from 3 to 12; defaults to 6"),
    depth: z
      .enum(["quick", "standard", "deep"])
      .optional()
      .describe("Research depth; defaults to standard"),
  })
  .strict();

type ResearchExecutor = Pick<ResearchRunner, "run">;

export type BridgeServerDependencies = {
  runner?: ResearchExecutor;
  doctor?: () => Promise<DoctorReport>;
};

export function createBridgeServer(
  dependencies: BridgeServerDependencies = {},
): McpServer {
  const runner = dependencies.runner ?? new ResearchRunner();
  const doctor = dependencies.doctor ?? runDoctor;
  const server = new McpServer({
    name: "codex-search-bridge",
    version: PROJECT_VERSION,
    title: PROJECT_NAME,
  });

  server.registerTool(
    "research_web",
    {
      title: "Research the live web with Codex",
      description:
        "Use Codex native live web search to search, open sources, verify publication and event dates, and return evidence-marked current information. Requires a Codex login and consumes the user's Codex quota.",
      inputSchema: ToolInputSchema.shape,
      outputSchema: ResearchResultSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input, extra) => {
      try {
        const result = await runner.run(input, { signal: extra.signal });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        const publicError = toPublicBridgeError(error);
        return {
          isError: true,
          content: [
            { type: "text", text: JSON.stringify(publicError, null, 2) },
          ],
        };
      }
    },
  );

  server.registerTool(
    "doctor",
    {
      title: "Diagnose Codex Search Bridge",
      description:
        "Run read-only checks for Node, Codex CLI, authentication, live web search evidence, and structured output. This performs a small live Codex search and consumes a small amount of quota.",
      inputSchema: {},
      outputSchema: DoctorReportSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async () => {
      const report = await doctor();
      return {
        content: [{ type: "text", text: JSON.stringify(report, null, 2) }],
        structuredContent: report,
      };
    },
  );

  return server;
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url);
}

async function main(): Promise<void> {
  if (process.argv.includes("--doctor")) {
    const report = await runDoctor();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.status === "healthy" ? 0 : 1;
    return;
  }

  const server = createBridgeServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`${PROJECT_NAME} MCP server running on stdio.\n`);
}

if (isDirectExecution()) {
  main().catch((error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown server startup failure";
    process.stderr.write(
      `${sanitizeDiagnostic(
        message,
        process.env.HOME === undefined
          ? {}
          : { homeDirectory: process.env.HOME },
      )}\n`,
    );
    process.exitCode = 1;
  });
}
