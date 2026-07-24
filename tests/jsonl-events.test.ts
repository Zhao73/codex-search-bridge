import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BridgeError } from "../src/errors.js";
import { parseCodexJsonl } from "../src/jsonl-events.js";

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
});
