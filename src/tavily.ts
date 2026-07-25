import type {
  Claim,
  ResearchResult,
  ResearchWebInput,
  Source,
} from "./contracts.js";
import { isIsoCalendarDate, isRfc3339 } from "./contracts.js";
import { BridgeError } from "./errors.js";
import { isIP } from "node:net";

import type { CodexEvidence } from "./jsonl-events.js";
import type { PageFetchSummary } from "./page-fetch.js";
import { isPublicAddress, validatePageUrl } from "./page-fetch.js";

const TAVILY_ENDPOINT = "https://api.tavily.com/search";
const REQUEST_TIMEOUT_MS = 45_000;

export type TavilyResult = {
  title: string;
  url: string;
  content?: string;
  published_date?: string;
};

export type TavilyResponse = {
  answer?: string;
  results: TavilyResult[];
};

export type TavilySearchOptions = {
  apiKey: string;
  question: string;
  maxResults: number;
  depth: "quick" | "standard" | "deep";
  /** Inclusive YYYY-MM-DD bounds filtering on publish or last-updated date. */
  startDate?: string;
  endDate?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(
  record: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function parseTavilyResponse(payload: unknown): TavilyResponse {
  const record = asRecord(payload);
  const rawResults = record?.results;
  if (!Array.isArray(rawResults)) {
    throw new BridgeError(
      "SEARCH_API_FAILED",
      "The Tavily search response did not contain a results array.",
    );
  }

  const results: TavilyResult[] = [];
  for (const entry of rawResults) {
    const item = asRecord(entry);
    const url = stringField(item, "url");
    if (url === undefined) {
      continue;
    }
    let parsedUrl: URL;
    try {
      // Reuse the same scheme/credential/port policy the restricted page
      // verifier enforces, so a hostile search response cannot smuggle in a
      // non-HTTP(S) URL.
      parsedUrl = validatePageUrl(url);
    } catch {
      continue;
    }
    // `validatePageUrl` leaves private-address rejection to DNS resolution at
    // fetch time. A literal IP never reaches that check as a hostname lookup,
    // so a loopback or RFC1918 literal is dropped here instead of being echoed
    // back to the caller as a citable source.
    const hostname = parsedUrl.hostname.replace(/^\[|\]$/g, "");
    if (isIP(hostname) !== 0 && !isPublicAddress(hostname)) {
      continue;
    }
    results.push({
      title: stringField(item, "title") ?? url,
      url,
      ...(stringField(item, "content") === undefined
        ? {}
        : { content: stringField(item, "content")! }),
      ...(stringField(item, "published_date") === undefined
        ? {}
        : { published_date: stringField(item, "published_date")! }),
    });
  }

  return {
    ...(stringField(record, "answer") === undefined
      ? {}
      : { answer: stringField(record, "answer")! }),
    results,
  };
}

export async function tavilySearch(
  options: TavilySearchOptions,
): Promise<TavilyResponse> {
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  const onAbort = (): void => {
    controller.abort();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    const response = await doFetch(TAVILY_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        query: options.question,
        search_depth: options.depth === "quick" ? "basic" : "advanced",
        max_results: options.maxResults,
        include_answer: "advanced",
        // `start_date`/`end_date` are the documented absolute-range filters and
        // apply to every topic. An earlier `days` parameter is not part of the
        // current API and was silently ignored.
        ...(options.startDate === undefined
          ? {}
          : { start_date: options.startDate }),
        ...(options.endDate === undefined ? {} : { end_date: options.endDate }),
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const isAuthFailure = response.status === 401 || response.status === 403;
      throw new BridgeError(
        "SEARCH_API_FAILED",
        `The Tavily search API responded with HTTP ${response.status}.`,
        isAuthFailure
          ? {
              remediation:
                "Check that TAVILY_API_KEY is valid and has remaining credits.",
            }
          : {},
      );
    }

    return parseTavilyResponse(await response.json());
  } catch (error) {
    if (error instanceof BridgeError) {
      throw error;
    }
    throw new BridgeError(
      "SEARCH_API_FAILED",
      "The Tavily search request failed.",
      { cause: error },
    );
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

function normalizePublishedDate(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (isIsoCalendarDate(value) || isRfc3339(value)) {
    return value;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString();
}

const SEARCH_API_LIMITATIONS = [
  "Sources came from the Tavily search API rather than a Codex or Claude native live-search worker.",
  "No model reconciled the fetched page text against the answer, so individual claims are not verified. Treat the answer as a lead, not as confirmed research.",
  "Most general-topic search results carry no publication date at all; where one is present it comes from the search index and was not separated from the event date.",
];

export type TavilyResultOptions = {
  input: ResearchWebInput;
  response: TavilyResponse;
  fetchSummary: PageFetchSummary;
  timestamp: string;
};

/**
 * Build a research result from search-API output.
 *
 * This path deliberately produces a single `unconfirmed` claim: only a model
 * that actually read the pages can attribute claims to sources, and no model
 * runs here. The verifier still enforces that the cited URLs were really opened
 * by the Bridge's restricted fetcher.
 */
export function buildTavilyResult(
  options: TavilyResultOptions,
): ResearchResult {
  const { input, response, fetchSummary, timestamp } = options;

  const opened = new Set(
    fetchSummary.successes.flatMap((success) => [
      success.requestedUrl,
      success.finalUrl,
    ]),
  );

  const sources: Source[] = response.results
    .slice(0, input.max_sources)
    .map((result, index) => {
      const published = normalizePublishedDate(result.published_date);
      return {
        id: `s${index + 1}`,
        url: result.url,
        title: result.title,
        ...(published === undefined ? {} : { published_at: published }),
        retrieved_at: timestamp,
        source_type: "unknown" as const,
        provenance_verified: opened.has(result.url),
      };
    });

  if (sources.length === 0) {
    throw new BridgeError(
      "EVIDENCE_VERIFICATION_FAILED",
      "The Tavily search returned no usable source URLs.",
    );
  }

  const answer =
    response.answer ??
    response.results
      .slice(0, input.max_sources)
      .map((result) => `- ${result.title}: ${result.content ?? result.url}`)
      .join("\n");

  const claims: Claim[] = [
    {
      id: "c1",
      claim: answer.slice(0, 2_000),
      status: "unconfirmed",
      confidence: "unknown",
      source_ids: sources.map((source) => source.id),
      note: "Generated by the search API without model-level source attribution or date reconciliation.",
    },
  ];

  return {
    answer,
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
    claims,
    sources,
    verification: {
      status: "failed",
      provider: "tavily",
      evidence_tier: "search_api",
      web_search_events: 0,
      opened_page_events: 0,
      codex_open_page_events: 0,
      bridge_fetch_events: 0,
      content_audit_passes: 0,
      cited_sources_verified: 0,
      total_cited_sources: 0,
    },
    limitations: [...SEARCH_API_LIMITATIONS],
  };
}

/** One completed Tavily query counts as exactly one live web-search event. */
export function buildTavilyEvidence(response: TavilyResponse): CodexEvidence {
  return {
    webSearchEvents: 1,
    openedPageEvents: 0,
    codexOpenPageEvents: 0,
    bridgeFetchEvents: 0,
    contentAuditPasses: 0,
    observedUrls: response.results.map((result) => result.url),
    openedUrls: [],
    redirects: new Map<string, string>(),
    queries: [],
    unknownEventTypes: [],
    errorMessages: [],
    bridgeFetchFailures: [],
  };
}
