import { BridgeError } from "./errors.js";

type JsonRecord = Record<string, unknown>;

export type CodexEvidence = {
  webSearchEvents: number;
  openedPageEvents: number;
  codexOpenPageEvents: number;
  bridgeFetchEvents: number;
  contentAuditPasses: number;
  observedUrls: string[];
  openedUrls: string[];
  redirects: Map<string, string>;
  queries: string[];
  unknownEventTypes: string[];
  errorMessages: string[];
  bridgeFetchFailures: Array<{
    url: string;
    reason: string;
    statusCode?: number;
  }>;
  finalMessage?: string;
};

const KNOWN_TOP_LEVEL_EVENTS = new Set([
  "thread.started",
  "turn.started",
  "turn.completed",
  "turn.failed",
  "item.started",
  "item.updated",
  "item.completed",
  "event_msg",
  "response_item",
  "error",
]);

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

function stringArray(record: JsonRecord | undefined, key: string): string[] {
  const value = record?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function uniquePush(values: string[], value: string | undefined): void {
  if (value !== undefined && value.length > 0 && !values.includes(value)) {
    values.push(value);
  }
}

export class CodexJsonlAccumulator {
  readonly #seenCalls = new Set<string>();
  readonly #observedUrls: string[] = [];
  readonly #openedUrls: string[] = [];
  readonly #queries: string[] = [];
  readonly #unknownEventTypes: string[] = [];
  readonly #errorMessages: string[] = [];
  readonly #redirects = new Map<string, string>();
  #webSearchEvents = 0;
  #codexOpenPageEvents = 0;
  #finalMessage: string | undefined;

  pushLine(line: string, lineNumber?: number): void {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      throw new BridgeError(
        "WORKER_FAILED",
        `Codex emitted malformed JSONL${
          lineNumber === undefined ? "" : ` on line ${lineNumber}`
        }.`,
        { cause: error },
      );
    }

    const event = asRecord(parsed);
    if (event === undefined) {
      throw new BridgeError(
        "WORKER_FAILED",
        `Codex emitted a non-object JSONL event${
          lineNumber === undefined ? "" : ` on line ${lineNumber}`
        }.`,
      );
    }

    const eventType = stringValue(event, "type") ?? "<missing>";
    if (!KNOWN_TOP_LEVEL_EVENTS.has(eventType)) {
      uniquePush(this.#unknownEventTypes, eventType);
      return;
    }

    if (eventType === "item.completed") {
      const item = asRecord(event.item);
      this.#consumeCompletedItem(item);
      return;
    }

    if (eventType === "event_msg" || eventType === "response_item") {
      const payload = asRecord(event.payload);
      this.#consumeArchivedPayload(payload);
      return;
    }

    if (eventType === "error" || eventType === "turn.failed") {
      uniquePush(
        this.#errorMessages,
        stringValue(event, "message") ?? stringValue(asRecord(event.error), "message"),
      );
    }
  }

  snapshot(): CodexEvidence {
    return {
      webSearchEvents: this.#webSearchEvents,
      openedPageEvents: this.#codexOpenPageEvents,
      codexOpenPageEvents: this.#codexOpenPageEvents,
      bridgeFetchEvents: 0,
      contentAuditPasses: 0,
      observedUrls: [...this.#observedUrls],
      openedUrls: [...this.#openedUrls],
      redirects: new Map(this.#redirects),
      queries: [...this.#queries],
      unknownEventTypes: [...this.#unknownEventTypes],
      errorMessages: [...this.#errorMessages],
      bridgeFetchFailures: [],
      ...(this.#finalMessage === undefined
        ? {}
        : { finalMessage: this.#finalMessage }),
    };
  }

  #consumeCompletedItem(item: JsonRecord | undefined): void {
    const itemType = stringValue(item, "type");
    if (itemType === "web_search") {
      this.#consumeWebAction(item);
      return;
    }
    if (itemType === "agent_message") {
      const text = stringValue(item, "text");
      if (text !== undefined) {
        this.#finalMessage = text;
      }
      return;
    }
    if (itemType === "error") {
      uniquePush(this.#errorMessages, stringValue(item, "message"));
    }
  }

  #consumeArchivedPayload(payload: JsonRecord | undefined): void {
    const payloadType = stringValue(payload, "type");
    if (payloadType === "web_search_end" || payloadType === "web_search_call") {
      if (
        payloadType === "web_search_call" &&
        stringValue(payload, "status") !== "completed"
      ) {
        return;
      }
      this.#consumeWebAction(payload);
      return;
    }

    if (payloadType === "message") {
      const content = payload?.content;
      if (Array.isArray(content)) {
        for (const part of content) {
          const partRecord = asRecord(part);
          if (stringValue(partRecord, "type") === "output_text") {
            const text = stringValue(partRecord, "text");
            if (text !== undefined) {
              this.#finalMessage = text;
            }
          }
        }
      }
    }
  }

  #consumeWebAction(container: JsonRecord | undefined): void {
    const action = asRecord(container?.action);
    const actionType = stringValue(action, "type");
    if (actionType !== "search" && actionType !== "open_page") {
      return;
    }

    const callId =
      stringValue(container, "id") ??
      stringValue(container, "call_id") ??
      `${actionType}:${stringValue(action, "url") ?? stringValue(action, "query") ?? ""}`;
    if (this.#seenCalls.has(callId)) {
      return;
    }
    this.#seenCalls.add(callId);

    if (actionType === "search") {
      this.#webSearchEvents += 1;
      uniquePush(
        this.#queries,
        stringValue(action, "query") ?? stringValue(container, "query"),
      );
      for (const query of stringArray(action, "queries")) {
        uniquePush(this.#queries, query);
      }
      for (const url of stringArray(action, "urls")) {
        uniquePush(this.#observedUrls, url);
      }
      return;
    }

    this.#codexOpenPageEvents += 1;
    const url = stringValue(action, "url") ?? stringValue(container, "query");
    const resolvedUrl =
      stringValue(action, "resolved_url") ?? stringValue(action, "redirect_url");
    uniquePush(this.#observedUrls, url);
    uniquePush(this.#observedUrls, resolvedUrl);
    uniquePush(this.#openedUrls, url);
    uniquePush(this.#openedUrls, resolvedUrl);
    if (url !== undefined && resolvedUrl !== undefined && url !== resolvedUrl) {
      this.#redirects.set(url, resolvedUrl);
    }
  }
}

export function parseCodexJsonl(input: string): CodexEvidence {
  const accumulator = new CodexJsonlAccumulator();
  const lines = input.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    accumulator.pushLine(line, index + 1);
  }
  return accumulator.snapshot();
}

function uniqueValues(groups: readonly string[][]): string[] {
  return [...new Set(groups.flat())];
}

export function combineCodexEvidence(
  ...evidenceSets: readonly CodexEvidence[]
): CodexEvidence {
  const redirects = new Map<string, string>();
  for (const evidence of evidenceSets) {
    for (const [from, to] of evidence.redirects) {
      redirects.set(from, to);
    }
  }
  const codexOpenPageEvents = evidenceSets.reduce(
    (total, evidence) => total + evidence.codexOpenPageEvents,
    0,
  );
  const bridgeFetchEvents = evidenceSets.reduce(
    (total, evidence) => total + evidence.bridgeFetchEvents,
    0,
  );
  const contentAuditPasses = evidenceSets.reduce(
    (total, evidence) => total + evidence.contentAuditPasses,
    0,
  );
  const finalMessage = [...evidenceSets]
    .reverse()
    .find((evidence) => evidence.finalMessage !== undefined)?.finalMessage;

  return {
    webSearchEvents: evidenceSets.reduce(
      (total, evidence) => total + evidence.webSearchEvents,
      0,
    ),
    openedPageEvents: codexOpenPageEvents + bridgeFetchEvents,
    codexOpenPageEvents,
    bridgeFetchEvents,
    contentAuditPasses,
    observedUrls: uniqueValues(
      evidenceSets.map((evidence) => evidence.observedUrls),
    ),
    openedUrls: uniqueValues(
      evidenceSets.map((evidence) => evidence.openedUrls),
    ),
    redirects,
    queries: uniqueValues(evidenceSets.map((evidence) => evidence.queries)),
    unknownEventTypes: uniqueValues(
      evidenceSets.map((evidence) => evidence.unknownEventTypes),
    ),
    errorMessages: uniqueValues(
      evidenceSets.map((evidence) => evidence.errorMessages),
    ),
    bridgeFetchFailures: evidenceSets.flatMap(
      (evidence) => evidence.bridgeFetchFailures,
    ),
    ...(finalMessage === undefined ? {} : { finalMessage }),
  };
}
