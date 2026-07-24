import { describe, expect, it } from "vitest";

import type { ResearchResult } from "../src/contracts.js";
import type { CodexEvidence } from "../src/jsonl-events.js";
import { BridgeError } from "../src/errors.js";
import { verifyResearchResult } from "../src/verifier.js";

const baseResult: ResearchResult = {
  answer: "The launch occurred on July 24.",
  as_of: "2026-07-25T03:00:00Z",
  query: {
    question: "When was the launch?",
    depth: "standard",
    max_sources: 6,
  },
  claims: [
    {
      id: "C1",
      claim: "The launch occurred on July 24.",
      status: "confirmed",
      confidence: "high",
      event_date: "2026-07-24",
      source_ids: ["S1"],
    },
  ],
  sources: [
    {
      id: "S1",
      url: "https://example.com/launch",
      title: "Official launch",
      published_at: "2026-07-24",
      retrieved_at: "2026-07-25T03:00:00Z",
      source_type: "primary",
      provenance_verified: false,
    },
  ],
  verification: {
    status: "failed",
    web_search_events: 0,
    opened_page_events: 0,
    cited_sources_seen_in_events: 0,
    total_cited_sources: 0,
  },
  limitations: [],
};

function evidence(overrides: Partial<CodexEvidence> = {}): CodexEvidence {
  return {
    webSearchEvents: 1,
    openedPageEvents: 1,
    observedUrls: ["https://example.com/launch"],
    redirects: new Map(),
    queries: ["launch"],
    unknownEventTypes: [],
    errorMessages: [],
    finalMessage: "done",
    ...overrides,
  };
}

describe("verifyResearchResult", () => {
  it("fails when no real search event exists", () => {
    expect(() =>
      verifyResearchResult(
        baseResult,
        evidence({ webSearchEvents: 0 }),
        "standard",
      ),
    ).toThrowError(BridgeError);
  });

  it("fails standard research without an opened page", () => {
    expect(() =>
      verifyResearchResult(
        baseResult,
        evidence({ openedPageEvents: 0 }),
        "standard",
      ),
    ).toThrowError(/open-page evidence/i);
  });

  it("fails when all cited source URLs are unmatched", () => {
    expect(() =>
      verifyResearchResult(
        baseResult,
        evidence({ observedUrls: ["https://elsewhere.example/story"] }),
        "standard",
      ),
    ).toThrowError(/source URL/i);
  });

  it("marks complete provenance as verified", () => {
    const verified = verifyResearchResult(
      baseResult,
      evidence(),
      "standard",
    );

    expect(verified.verification).toEqual({
      status: "verified",
      web_search_events: 1,
      opened_page_events: 1,
      cited_sources_seen_in_events: 1,
      total_cited_sources: 1,
    });
    expect(verified.sources[0]?.provenance_verified).toBe(true);
    expect(baseResult.sources[0]?.provenance_verified).toBe(false);
  });

  it("marks partial provenance and downgrades unsupported claims", () => {
    const result: ResearchResult = {
      ...baseResult,
      claims: [
        ...baseResult.claims,
        {
          id: "C2",
          claim: "A second report confirms global availability.",
          status: "confirmed",
          confidence: "high",
          source_ids: ["S2"],
        },
      ],
      sources: [
        ...baseResult.sources,
        {
          id: "S2",
          url: "https://news.example.org/report",
          title: "Unobserved report",
          retrieved_at: "2026-07-25T03:00:00Z",
          source_type: "secondary",
          provenance_verified: false,
        },
      ],
    };

    const verified = verifyResearchResult(result, evidence(), "standard");

    expect(verified.verification.status).toBe("partial");
    expect(verified.claims[1]).toMatchObject({
      status: "unconfirmed",
      confidence: "unknown",
    });
    expect(verified.limitations.join(" ")).toMatch(/not observed/i);
  });

  it("preserves conflicts while lowering inferred-date confidence", () => {
    const result: ResearchResult = {
      ...baseResult,
      claims: [
        {
          ...baseResult.claims[0]!,
          status: "conflicting",
          confidence: "high",
          note: "Event time was inferred from a relative page timestamp.",
        },
      ],
    };

    const verified = verifyResearchResult(result, evidence(), "deep");

    expect(verified.claims[0]).toMatchObject({
      status: "conflicting",
      confidence: "moderate",
    });
  });
});
