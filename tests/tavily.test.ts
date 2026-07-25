import { describe, expect, it } from "vitest";

import type { ResearchWebInput } from "../src/contracts.js";
import { BridgeError } from "../src/errors.js";
import type { PageFetchSummary } from "../src/page-fetch.js";
import {
  buildTavilyEvidence,
  buildTavilyResult,
  parseTavilyResponse,
  tavilySearch,
} from "../src/tavily.js";
import { verifyResearchResult } from "../src/verifier.js";
import { mergePageFetchEvidence } from "../src/page-fetch.js";

const TIMESTAMP = "2026-07-25T04:00:00Z";

function input(overrides: Partial<ResearchWebInput> = {}): ResearchWebInput {
  return {
    question: "What shipped today?",
    depth: "standard",
    max_sources: 6,
    ...overrides,
  };
}

function fetchSummary(urls: readonly string[]): PageFetchSummary {
  return {
    successes: urls.map((url) => ({
      requestedUrl: url,
      finalUrl: url,
      statusCode: 200,
      bytesRead: 128,
      retrievedAt: TIMESTAMP,
      redirects: [],
    })),
    failures: [],
  };
}

describe("parseTavilyResponse", () => {
  it("keeps well-formed public HTTP(S) results", () => {
    const parsed = parseTavilyResponse({
      answer: "Node 26 is current.",
      results: [
        {
          title: "Release",
          url: "https://nodejs.org/en/blog/release",
          content: "text",
          published_date: "2026-07-20",
        },
      ],
    });

    expect(parsed.answer).toBe("Node 26 is current.");
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]?.url).toBe("https://nodejs.org/en/blog/release");
  });

  it("drops entries the restricted URL policy rejects", () => {
    const parsed = parseTavilyResponse({
      results: [
        { title: "loopback", url: "http://127.0.0.1/admin" },
        { title: "scheme", url: "file:///etc/passwd" },
        { title: "no url" },
        { title: "ok", url: "https://example.com/a" },
      ],
    });

    expect(parsed.results.map((result) => result.url)).toEqual([
      "https://example.com/a",
    ]);
  });

  it("rejects a response without a results array", () => {
    try {
      parseTavilyResponse({ answer: "nope" });
      expect.unreachable("missing results must throw");
    } catch (error) {
      expect((error as BridgeError).code).toBe("SEARCH_API_FAILED");
    }
  });
});

describe("tavilySearch request shape", () => {
  async function capture(
    overrides: Partial<Parameters<typeof tavilySearch>[0]> = {},
  ): Promise<{ url: string; headers: Headers; body: Record<string, unknown> }> {
    let seen: { url: string; headers: Headers; body: Record<string, unknown> } =
      { url: "", headers: new Headers(), body: {} };

    await tavilySearch({
      apiKey: "tvly-test",
      question: "what shipped today?",
      maxResults: 6,
      depth: "standard",
      ...overrides,
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen = {
          url: String(url),
          headers: new Headers(init.headers),
          body: JSON.parse(String(init.body)) as Record<string, unknown>,
        };
        return new Response(JSON.stringify({ answer: "a", results: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });

    return seen;
  }

  it("posts to the documented endpoint with a bearer key", async () => {
    const seen = await capture();
    expect(seen.url).toBe("https://api.tavily.com/search");
    expect(seen.headers.get("authorization")).toBe("Bearer tvly-test");
    expect(seen.body.query).toBe("what shipped today?");
    expect(seen.body.max_results).toBe(6);
    expect(seen.body.include_answer).toBe("advanced");
  });

  it("maps depth onto the documented search_depth values", async () => {
    expect((await capture({ depth: "quick" })).body.search_depth).toBe("basic");
    expect((await capture({ depth: "deep" })).body.search_depth).toBe("advanced");
  });

  it("sends absolute date bounds and never the undocumented days parameter", async () => {
    const seen = await capture({
      startDate: "2026-07-01",
      endDate: "2026-07-25",
    });
    expect(seen.body.start_date).toBe("2026-07-01");
    expect(seen.body.end_date).toBe("2026-07-25");
    // `days` is not part of the current Tavily API. Sending it is silently
    // ignored, which would drop the caller's recency window without an error.
    expect(seen.body).not.toHaveProperty("days");
  });

  it("omits date bounds when the request has no time window", async () => {
    const seen = await capture();
    expect(seen.body).not.toHaveProperty("start_date");
    expect(seen.body).not.toHaveProperty("end_date");
  });

  it("surfaces an auth failure with remediation", async () => {
    try {
      await tavilySearch({
        apiKey: "bad",
        question: "q",
        maxResults: 3,
        depth: "quick",
        fetchImpl: (async () =>
          new Response("nope", { status: 401 })) as unknown as typeof fetch,
      });
      expect.unreachable("401 must throw");
    } catch (error) {
      expect((error as BridgeError).code).toBe("SEARCH_API_FAILED");
      expect((error as BridgeError).remediation).toMatch(/TAVILY_API_KEY/);
    }
  });
});

describe("buildTavilyResult", () => {
  it("never claims more than an unconfirmed search-API result", () => {
    const response = parseTavilyResponse({
      answer: "Node 26 is current.",
      results: [{ title: "Release", url: "https://nodejs.org/a" }],
    });

    const result = buildTavilyResult({
      input: input(),
      response,
      fetchSummary: fetchSummary(["https://nodejs.org/a"]),
      timestamp: TIMESTAMP,
    });

    expect(result.verification.provider).toBe("tavily");
    expect(result.verification.evidence_tier).toBe("search_api");
    expect(result.claims).toHaveLength(1);
    expect(result.claims[0]?.status).toBe("unconfirmed");
    expect(result.claims[0]?.confidence).toBe("unknown");
    expect(result.limitations.join(" ")).toContain("No model reconciled");
  });

  it("fails when the search returned no usable sources", () => {
    try {
      buildTavilyResult({
        input: input(),
        response: { results: [] },
        fetchSummary: fetchSummary([]),
        timestamp: TIMESTAMP,
      });
      expect.unreachable("no sources must throw");
    } catch (error) {
      expect((error as BridgeError).code).toBe("EVIDENCE_VERIFICATION_FAILED");
    }
  });
});

describe("search-API tier through the verifier", () => {
  it("is capped at partial even with complete URL provenance", () => {
    const url = "https://nodejs.org/a";
    const response = parseTavilyResponse({
      answer: "Node 26 is current.",
      results: [{ title: "Release", url }],
    });
    const summary = fetchSummary([url]);
    const draft = buildTavilyResult({
      input: input(),
      response,
      fetchSummary: summary,
      timestamp: TIMESTAMP,
    });
    const evidence = mergePageFetchEvidence(
      buildTavilyEvidence(response),
      summary,
    );

    const verified = verifyResearchResult(draft, evidence, {
      depth: "standard",
      provider: "tavily",
      evidenceTier: "search_api",
    });

    // Every cited URL was opened, yet `verified` requires a model audit that
    // this tier structurally cannot perform.
    expect(verified.verification.cited_sources_verified).toBe(1);
    expect(verified.verification.total_cited_sources).toBe(1);
    expect(verified.verification.status).toBe("partial");
    expect(verified.verification.bridge_fetch_events).toBe(1);
    expect(verified.verification.content_audit_passes).toBe(0);
  });

  it("still rejects a run with no search event at all", () => {
    const url = "https://nodejs.org/a";
    const response = parseTavilyResponse({
      results: [{ title: "Release", url }],
    });
    const summary = fetchSummary([url]);
    const draft = buildTavilyResult({
      input: input(),
      response,
      fetchSummary: summary,
      timestamp: TIMESTAMP,
    });
    const evidence = {
      ...mergePageFetchEvidence(buildTavilyEvidence(response), summary),
      webSearchEvents: 0,
    };

    try {
      verifyResearchResult(draft, evidence, {
        depth: "standard",
        provider: "tavily",
        evidenceTier: "search_api",
      });
      expect.unreachable("zero search events must throw");
    } catch (error) {
      expect((error as BridgeError).code).toBe("EVIDENCE_VERIFICATION_FAILED");
    }
  });
});
