import { BridgeError } from "./errors.js";
import type { CodexEvidence } from "./jsonl-events.js";

type JsonRecord = Record<string, unknown>;

/**
 * Claude Code exposes live search as the `WebSearch` tool and page opens as the
 * `WebFetch` tool. Both surface in `--output-format stream-json`, but unlike
 * Codex the cited URLs arrive inside a human-readable `tool_result` string as a
 * `Links: [{"title":...,"url":...}]` array rather than as structured fields.
 */
const SEARCH_TOOL = "WebSearch";
const FETCH_TOOL = "WebFetch";
const LINKS_PATTERN = /Links:\s*(\[[\s\S]*?\])\s*(?:\n\n|$)/;

export type ClaudeArgumentOptions = {
  cwd: string;
  maxTurns: number;
  model?: string;
};

export function buildClaudeArgs(options: ClaudeArgumentOptions): string[] {
  return [
    "--print",
    "--output-format",
    "stream-json",
    "--verbose",
    // Only the two read-only web tools; everything else stays denied.
    "--allowedTools",
    SEARCH_TOOL,
    FETCH_TOOL,
    "--disallowedTools",
    "Bash",
    "Edit",
    "Write",
    "Task",
    // `--strict-mcp-config` with no `--mcp-config` file loads zero MCP servers,
    // which is what stops the Bridge's own server from recursing into itself.
    // `--bare` would also do that but disables OAuth and keychain auth, which
    // breaks every subscription user, so it is deliberately not used here.
    "--strict-mcp-config",
    // Load no user, project, or local settings: no hooks, no permission
    // allowlists, no CLAUDE.md. This is the Claude-side equivalent of Codex's
    // `--ignore-user-config`, and unlike a fresh HOME it keeps auth working.
    "--setting-sources",
    "",
    "--permission-mode",
    "dontAsk",
    "--max-turns",
    String(options.maxTurns),
    ...(options.model === undefined ? [] : ["--model", options.model]),
  ];
}

/**
 * Claude Code inherits gateway redirects from the environment. A worker pointed
 * at a third-party gateway would run an open-weight model with no server-side
 * WebSearch tool, so the redirect variables are stripped and the worker always
 * talks to the real Anthropic endpoint with the user's own Claude credentials.
 */
export const CLAUDE_REDIRECT_KEYS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_CUSTOM_HEADERS",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
] as const;

export function stripClaudeRedirects(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = { ...environment };
  const usesGateway = (result.ANTHROPIC_BASE_URL ?? "").trim().length > 0;
  for (const key of CLAUDE_REDIRECT_KEYS) {
    delete result[key];
  }
  // A gateway supplies its own key through ANTHROPIC_API_KEY. Dropping it makes
  // the worker fall back to the user's real Claude login instead of sending a
  // gateway token to Anthropic, where it would fail as an invalid key.
  if (usesGateway) {
    delete result.ANTHROPIC_API_KEY;
  }
  return result;
}

function asRecord(value: unknown): JsonRecord | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonRecord;
}

function stringValue(record: JsonRecord | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
}

function uniquePush(values: string[], value: string | undefined): void {
  if (value !== undefined && value.length > 0 && !values.includes(value)) {
    values.push(value);
  }
}

export function extractSearchResultUrls(content: string): string[] {
  const match = LINKS_PATTERN.exec(content);
  if (match === null) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]!);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const urls: string[] = [];
  for (const entry of parsed) {
    uniquePush(urls, stringValue(asRecord(entry), "url"));
  }
  return urls;
}

/**
 * Pull the final JSON object out of an assistant message. The worker is asked
 * for raw JSON, but models routinely wrap it in a fenced block, so both shapes
 * are accepted before giving up.
 */
export function extractJsonObject(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/gi;
  const candidates: string[] = [];
  for (const match of text.matchAll(fenced)) {
    candidates.push(match[1]!.trim());
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    candidates.push(text.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (asRecord(parsed) !== undefined) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  throw new BridgeError(
    "INVALID_STRUCTURED_OUTPUT",
    "The Claude research worker did not return a JSON research result.",
  );
}

export type ClaudeStreamSummary = {
  evidence: CodexEvidence;
  finalMessage: string | undefined;
  isError: boolean;
};

export function parseClaudeStream(input: string): ClaudeStreamSummary {
  const observedUrls: string[] = [];
  const openedUrls: string[] = [];
  const queries: string[] = [];
  const errorMessages: string[] = [];
  const unknownEventTypes: string[] = [];
  const fetchToolUseIds = new Set<string>();
  let webSearchEvents = 0;
  let nativeOpenPageEvents = 0;
  let finalMessage: string | undefined;
  let isError = false;

  for (const [index, line] of input.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      // Claude Code writes plain-text diagnostics to stderr, but a merged
      // stream can interleave them. Skip unparseable lines instead of failing
      // the whole run; a genuinely empty stream is caught by the verifier.
      if (index === 0) {
        continue;
      }
      continue;
    }

    const event = asRecord(parsed);
    if (event === undefined) {
      continue;
    }

    const eventType = stringValue(event, "type");
    if (eventType === "result") {
      if (event.is_error === true) {
        isError = true;
        uniquePush(errorMessages, stringValue(event, "result"));
      }
      const resultText = stringValue(event, "result");
      if (resultText !== undefined && resultText.length > 0) {
        finalMessage = resultText;
      }
      continue;
    }

    if (eventType !== "assistant" && eventType !== "user") {
      if (eventType !== undefined && eventType !== "system") {
        uniquePush(unknownEventTypes, eventType);
      }
      continue;
    }

    const content = asRecord(event.message)?.content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const rawBlock of content) {
      const block = asRecord(rawBlock);
      const blockType = stringValue(block, "type");

      if (blockType === "tool_use") {
        const name = stringValue(block, "name");
        if (name === SEARCH_TOOL) {
          webSearchEvents += 1;
          uniquePush(queries, stringValue(asRecord(block?.input), "query"));
        } else if (name === FETCH_TOOL) {
          const url = stringValue(asRecord(block?.input), "url");
          const id = stringValue(block, "id");
          if (id !== undefined) {
            fetchToolUseIds.add(id);
          }
          if (url !== undefined) {
            nativeOpenPageEvents += 1;
            uniquePush(observedUrls, url);
            uniquePush(openedUrls, url);
          }
        }
        continue;
      }

      if (blockType === "tool_result") {
        const raw = block?.content;
        const text = typeof raw === "string" ? raw : undefined;
        if (text === undefined) {
          continue;
        }
        for (const url of extractSearchResultUrls(text)) {
          uniquePush(observedUrls, url);
        }
        continue;
      }

      if (blockType === "text") {
        const text = stringValue(block, "text");
        if (text !== undefined && text.trim().length > 0) {
          finalMessage = text;
        }
      }
    }
  }

  return {
    evidence: {
      webSearchEvents,
      openedPageEvents: nativeOpenPageEvents,
      codexOpenPageEvents: nativeOpenPageEvents,
      bridgeFetchEvents: 0,
      contentAuditPasses: 0,
      observedUrls,
      openedUrls,
      redirects: new Map<string, string>(),
      queries,
      unknownEventTypes,
      errorMessages,
      bridgeFetchFailures: [],
      ...(finalMessage === undefined ? {} : { finalMessage }),
    },
    finalMessage,
    isError,
  };
}
