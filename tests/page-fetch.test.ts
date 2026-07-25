import { describe, expect, it, vi } from "vitest";

import {
  fetchPage,
  fetchPages,
  extractPageExcerpt,
  isPublicAddress,
  type PinnedPageRequest,
  validatePageUrl,
} from "../src/page-fetch.js";

const PUBLIC_ADDRESS = "93.184.216.34";

function publicResolver() {
  return Promise.resolve([{ address: PUBLIC_ADDRESS, family: 4 as const }]);
}

describe("page fetch URL and address policy", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "192.168.1.1",
    "198.51.100.8",
    "::1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002::1",
    "4000::1",
    "::ffff:127.0.0.1",
  ])("rejects non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it("allows a routable public address", () => {
    expect(isPublicAddress(PUBLIC_ADDRESS)).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
  });

  it.each([
    "file:///etc/passwd",
    "https://user:secret@example.com/",
    "https://example.com:8443/admin",
    "http://localhost/admin",
    "http://service.local/admin",
  ])("rejects unsafe URL %s", (url) => {
    expect(() => validatePageUrl(url)).toThrow();
  });
});

describe("fetchPage", () => {
  it("pins the validated address and records a successful open", async () => {
    const requestOnce = vi.fn(async (_request: PinnedPageRequest) => ({
      statusCode: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
      bytesRead: 321,
      body: Buffer.from("<main>Latest: alpha.8 &amp; stable</main>"),
    }));

    const result = await fetchPage("https://example.com/news?id=1", {
      resolveHost: publicResolver,
      requestOnce,
      now: () => new Date("2026-07-25T04:00:00Z"),
    });

    expect(requestOnce).toHaveBeenCalledOnce();
    expect(requestOnce.mock.calls[0]?.[0]).toMatchObject({
      address: PUBLIC_ADDRESS,
      family: 4,
    });
    expect(result).toMatchObject({
      requestedUrl: "https://example.com/news?id=1",
      finalUrl: "https://example.com/news?id=1",
      statusCode: 200,
      bytesRead: 321,
      retrievedAt: "2026-07-25T04:00:00.000Z",
      excerpt: "Latest: alpha.8 & stable",
    });
  });

  it("revalidates every redirect target before sending the next request", async () => {
    const requestOnce = vi.fn(async () => ({
      statusCode: 302,
      headers: { location: "http://127.0.0.1/admin" },
      bytesRead: 0,
      body: Buffer.alloc(0),
    }));

    await expect(
      fetchPage("https://example.com/start", {
        resolveHost: async (hostname) =>
          hostname === "127.0.0.1"
            ? [{ address: "127.0.0.1", family: 4 }]
            : [{ address: PUBLIC_ADDRESS, family: 4 }],
        requestOnce,
      }),
    ).rejects.toThrow(/non-public/i);
    expect(requestOnce).toHaveBeenCalledOnce();
  });

  it("stops redirect loops after the fixed limit", async () => {
    let redirects = 0;
    await expect(
      fetchPage("https://example.com/start", {
        resolveHost: publicResolver,
        requestOnce: async () => {
          redirects += 1;
          return {
            statusCode: 302,
            headers: { location: `/redirect-${redirects}` },
            bytesRead: 0,
            body: Buffer.alloc(0),
          };
        },
      }),
    ).rejects.toThrow(/redirect limit/i);
    expect(redirects).toBe(6);
  });
});

describe("fetchPages", () => {
  it("keeps successful page evidence and reports individual failures", async () => {
    const summary = await fetchPages(
      ["https://example.com/good", "https://example.com/missing"],
      {
        resolveHost: publicResolver,
        requestOnce: async ({ url }) => ({
          statusCode: url.pathname === "/good" ? 200 : 404,
          headers: { "content-type": "text/html" },
          bytesRead: 10,
          body: Buffer.from("page text"),
        }),
      },
    );

    expect(summary.successes).toHaveLength(1);
    expect(summary.failures).toEqual([
      {
        url: "https://example.com/missing",
        reason: "http_status",
        statusCode: 404,
      },
    ]);
  });
});

describe("extractPageExcerpt", () => {
  it("removes executable HTML and keeps compact visible evidence", () => {
    const excerpt = extractPageExcerpt(
      Buffer.from(
        "<style>.hidden{}</style><main>Release &amp; date <b>July 24</b></main><script>ignore()</script>",
      ),
      "text/html; charset=utf-8",
    );

    expect(excerpt).toBe("Release & date July 24");
  });

  it("does not convert a PDF binary into prompt text", () => {
    expect(
      extractPageExcerpt(Buffer.from("%PDF-1.7 binary"), "application/pdf"),
    ).toBeUndefined();
  });
});
