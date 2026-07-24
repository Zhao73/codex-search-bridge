import { describe, expect, it } from "vitest";

import {
  ResearchResultSchema,
  ResearchWebInputSchema,
} from "../src/contracts.js";

describe("ResearchWebInputSchema", () => {
  it("rejects an empty question", () => {
    expect(() => ResearchWebInputSchema.parse({ question: "" })).toThrow();
    expect(() => ResearchWebInputSchema.parse({ question: "   " })).toThrow();
  });

  it("enforces source-count boundaries", () => {
    expect(() =>
      ResearchWebInputSchema.parse({ question: "x", max_sources: 2 }),
    ).toThrow();
    expect(() =>
      ResearchWebInputSchema.parse({ question: "x", max_sources: 13 }),
    ).toThrow();
  });

  it("normalizes a valid request and applies defaults", () => {
    expect(
      ResearchWebInputSchema.parse({
        question: " latest release ",
        language: "zh-CN",
      }),
    ).toEqual({
      question: "latest release",
      language: "zh-CN",
      max_sources: 6,
      depth: "standard",
    });
  });

  it("rejects impossible dates and invalid language tags", () => {
    expect(() =>
      ResearchWebInputSchema.parse({
        question: "x",
        date_from: "2026-02-30",
      }),
    ).toThrow();
    expect(() =>
      ResearchWebInputSchema.parse({ question: "x", language: "not_a_tag" }),
    ).toThrow();
  });
});

describe("ResearchResultSchema", () => {
  it("accepts all public verification states", () => {
    const result = ResearchResultSchema.parse({
      answer: "Two sources disagree about the launch date.",
      as_of: "2026-07-25T12:00:00+09:00",
      query: {
        question: "When did it launch?",
        depth: "deep",
        max_sources: 6,
      },
      claims: [
        {
          id: "C1",
          claim: "The product launched.",
          status: "confirmed",
          confidence: "high",
          event_date: "2026-07-24",
          source_ids: ["S1"],
        },
        {
          id: "C2",
          claim: "The rollout is global.",
          status: "partially_confirmed",
          confidence: "moderate",
          source_ids: ["S1"],
        },
        {
          id: "C3",
          claim: "Pricing changed.",
          status: "unconfirmed",
          confidence: "unknown",
          source_ids: [],
        },
        {
          id: "C4",
          claim: "Sources report different launch dates.",
          status: "conflicting",
          confidence: "low",
          source_ids: ["S1", "S2"],
          note: "Official and media dates differ.",
        },
      ],
      sources: [
        {
          id: "S1",
          url: "https://example.com/launch",
          title: "Launch announcement",
          publisher: "Example",
          published_at: "2026-07-24T09:00:00Z",
          retrieved_at: "2026-07-25T03:00:00Z",
          source_type: "primary",
          provenance_verified: true,
        },
        {
          id: "S2",
          url: "https://news.example.org/report",
          title: "Launch report",
          updated_at: "2026-07-25",
          retrieved_at: "2026-07-25T03:01:00Z",
          source_type: "secondary",
          provenance_verified: false,
        },
      ],
      verification: {
        status: "partial",
        web_search_events: 1,
        opened_page_events: 2,
        cited_sources_seen_in_events: 1,
        total_cited_sources: 2,
      },
      limitations: ["One source URL was not present in the event stream."],
    });

    expect(result.claims.map((claim) => claim.status)).toEqual([
      "confirmed",
      "partially_confirmed",
      "unconfirmed",
      "conflicting",
    ]);
  });
});
