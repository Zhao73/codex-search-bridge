import { describe, expect, it } from "vitest";

import type { ResearchResult } from "../src/contracts.js";
import { BridgeError } from "../src/errors.js";
import { runDoctor } from "../src/doctor.js";

const verifiedResult: ResearchResult = {
  answer: "OpenAI homepage found.",
  as_of: "2026-07-25T03:00:00Z",
  query: {
    question: "Find and open the official OpenAI homepage.",
    depth: "standard",
    max_sources: 3,
  },
  claims: [
    {
      id: "C1",
      claim: "The homepage is available.",
      status: "confirmed",
      confidence: "high",
      source_ids: ["S1"],
    },
  ],
  sources: [
    {
      id: "S1",
      url: "https://openai.com",
      title: "OpenAI",
      retrieved_at: "2026-07-25T03:00:00Z",
      source_type: "primary",
      provenance_verified: true,
    },
  ],
  verification: {
    status: "verified",
    provider: "codex",
    evidence_tier: "native",
    web_search_events: 1,
    opened_page_events: 1,
    codex_open_page_events: 1,
    bridge_fetch_events: 0,
    content_audit_passes: 0,
    cited_sources_verified: 1,
    total_cited_sources: 1,
  },
  limitations: [],
};

describe("runDoctor", () => {
  it("reports a healthy verified installation", async () => {
    const report = await runDoctor({
      availability: async () => ({
        codex: true,
        claude: false,
        tavily: false,
      }),
      nodeVersion: "v20.19.0",
      getCodexVersion: async () => "codex-cli 0.145.0",
      runResearch: async () => verifiedResult,
      now: () => new Date("2026-07-25T03:00:00Z"),
    });

    expect(report).toMatchObject({
      status: "healthy",
      checked_at: "2026-07-25T03:00:00.000Z",
      node: { supported: true, version: "v20.19.0" },
      codex: { found: true, version: "0.145.0", authenticated: true },
      live_search: {
        available: true,
        web_search_events: 1,
        opened_page_events: 1,
        codex_open_page_events: 1,
        bridge_fetch_events: 0,
        content_audit_passes: 0,
      },
      structured_output: { valid: true },
    });
    expect(report.remediations).toEqual([]);
  });

  it("reports a missing Codex executable without secrets", async () => {
    const report = await runDoctor({
      availability: async () => ({
        codex: true,
        claude: false,
        tavily: false,
      }),
      nodeVersion: "v20.19.0",
      getCodexVersion: async () => {
        throw new BridgeError("CODEX_NOT_FOUND", "missing sk-secret123");
      },
      runResearch: async () => verifiedResult,
    });

    expect(report.status).toBe("failed");
    expect(report.codex.found).toBe(false);
    expect(JSON.stringify(report)).not.toContain("sk-secret123");
    expect(report.remediations.join(" ")).toMatch(/install Codex CLI/i);
  });

  it("classifies authentication and web-search failures", async () => {
    const report = await runDoctor({
      availability: async () => ({
        codex: true,
        claude: false,
        tavily: false,
      }),
      nodeVersion: "v20.19.0",
      getCodexVersion: async () => "codex-cli 0.145.0",
      runResearch: async () => {
        throw new BridgeError(
          "CODEX_AUTH_REQUIRED",
          "Authorization: Bearer abc sk-secret123",
        );
      },
    });

    expect(report.status).toBe("failed");
    expect(report.codex.authenticated).toBe(false);
    expect(report.live_search.available).toBe(false);
    expect(report.remediations.join(" ")).toMatch(/sign in/i);
    expect(JSON.stringify(report)).not.toContain("Bearer abc");
  });

  it("rejects unsupported Node versions before running live research", async () => {
    let researchCalls = 0;
    const report = await runDoctor({
      availability: async () => ({
        codex: true,
        claude: false,
        tavily: false,
      }),
      nodeVersion: "v18.20.0",
      getCodexVersion: async () => "codex-cli 0.145.0",
      runResearch: async () => {
        researchCalls += 1;
        return verifiedResult;
      },
    });

    expect(report.status).toBe("failed");
    expect(report.node.supported).toBe(false);
    expect(researchCalls).toBe(0);
  });
});
