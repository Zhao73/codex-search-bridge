import { describe, expect, it } from "vitest";

import {
  matchObservedUrl,
  normalizeEvidenceUrl,
  urlsMatch,
} from "../src/url-evidence.js";

describe("normalizeEvidenceUrl", () => {
  it("normalizes safe structural and tracking differences", () => {
    expect(
      normalizeEvidenceUrl(
        "HTTPS://Example.COM:443/a/?utm_source=x&gclid=y#top",
      ),
    ).toBe("https://example.com/a");
  });

  it("sorts semantic query parameters without discarding them", () => {
    expect(normalizeEvidenceUrl("https://example.com/a?z=2&id=7")).toBe(
      "https://example.com/a?id=7&z=2",
    );
  });

  it("rejects unsupported protocols and credentials", () => {
    expect(() => normalizeEvidenceUrl("file:///etc/passwd")).toThrow();
    expect(() =>
      normalizeEvidenceUrl("https://user:pass@example.com/private"),
    ).toThrow();
  });
});

describe("urlsMatch", () => {
  it("does not treat same-domain semantic URLs as equivalent", () => {
    expect(
      urlsMatch(
        "https://example.com/story?id=7",
        "https://example.com/story?id=8",
      ),
    ).toBe(false);
  });

  it("accepts an explicit observed redirect mapping", () => {
    const redirects = new Map([
      ["https://example.com/go", "https://example.org/final"],
    ]);
    expect(
      urlsMatch(
        "https://example.com/go",
        "https://example.org/final",
        redirects,
      ),
    ).toBe(true);
  });

  it("returns the observed URL that proves a cited source", () => {
    expect(
      matchObservedUrl("https://example.com/a?utm_campaign=x", [
        "https://example.org/no",
        "https://example.com/a",
      ]),
    ).toBe("https://example.com/a");
  });
});
