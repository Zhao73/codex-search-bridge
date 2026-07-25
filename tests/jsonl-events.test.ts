import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BridgeError } from "../src/errors.js";
import {
  combineCodexEvidence,
  parseCodexJsonl,
} from "../src/jsonl-events.js";

function fixture(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`./fixtures/events/${name}`, import.meta.url)),
    "utf8",
  );
}

describe("parseCodexJsonl", () => {
  it("extracts completed search and open-page evidence", () => {
    const evidence = parseCodexJsonl(fixture("successful.jsonl"));

    expect(evidence.webSearchEvents).toBe(1);
    expect(evidence.openedPageEvents).toBe(2);
    expect(evidence.codexOpenPageEvents).toBe(2);
    expect(evidence.bridgeFetchEvents).toBe(0);
    expect(evidence.observedUrls).toEqual([
      "https://example.com/news/launch",
      "https://news.example.org/report",
    ]);
    expect(evidence.queries).toEqual(["official launch"]);
    expect(evidence.unknownEventTypes).toEqual(["future.event"]);
    expect(evidence.finalMessage).toBe("Research complete.");
  });

  it("deduplicates archived event and response records by call id", () => {
    const evidence = parseCodexJsonl(fixture("archived.jsonl"));

    expect(evidence.webSearchEvents).toBe(1);
    expect(evidence.openedPageEvents).toBe(1);
    expect(evidence.openedUrls).toEqual([
      "https://example.com/news/launch",
    ]);
    expect(evidence.observedUrls).toEqual([
      "https://example.com/news/launch",
    ]);
  });

  it("rejects malformed non-empty JSONL", () => {
    expect(() => parseCodexJsonl(fixture("malformed.jsonl"))).toThrowError(
      BridgeError,
    );
    expect(() => parseCodexJsonl(fixture("malformed.jsonl"))).toThrowError(
      /WORKER_FAILED/,
    );
  });

  it("combines independent worker and Bridge evidence without hiding channels", () => {
    const first = parseCodexJsonl(fixture("successful.jsonl"));
    const second = parseCodexJsonl(fixture("archived.jsonl"));
    const combined = combineCodexEvidence(first, {
      ...second,
      bridgeFetchEvents: 2,
      openedPageEvents: second.codexOpenPageEvents + 2,
      openedUrls: [...second.openedUrls, "https://example.com/direct"],
    });

    expect(combined).toMatchObject({
      webSearchEvents: 2,
      codexOpenPageEvents: 3,
      bridgeFetchEvents: 2,
      openedPageEvents: 5,
    });
    expect(combined.openedUrls).toContain("https://example.com/direct");
  });
});
