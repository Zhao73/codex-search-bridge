import { lookup } from "node:dns/promises";
import http, { type IncomingHttpHeaders } from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";

import { BridgeError } from "./errors.js";
import type { CodexEvidence } from "./jsonl-events.js";

const MAX_REDIRECTS = 5;
const MAX_BODY_BYTES = 512 * 1_024;
const MAX_EXCERPT_CHARACTERS = 40_000;
const REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_CONCURRENCY = 3;

const BLOCKED_ADDRESSES = new BlockList();
const GLOBAL_IPV6 = new BlockList();
GLOBAL_IPV6.addSubnet("2000::", 3, "ipv6");

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED_ADDRESSES.addSubnet(network, prefix, "ipv4");
}

for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["100:0:0:1::", 64],
  ["2001::", 23],
  ["2001:2::", 48],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED_ADDRESSES.addSubnet(network, prefix, "ipv6");
}

export type ResolvedAddress = {
  address: string;
  family: 4 | 6;
};

export type PinnedPageRequest = {
  url: URL;
  address: string;
  family: 4 | 6;
  timeoutMs: number;
  maxBodyBytes: number;
  signal?: AbortSignal;
};

export type PinnedPageResponse = {
  statusCode: number;
  headers: IncomingHttpHeaders;
  bytesRead: number;
  body: Buffer;
};

export type PageFetchSuccess = {
  requestedUrl: string;
  finalUrl: string;
  statusCode: number;
  contentType?: string;
  bytesRead: number;
  retrievedAt: string;
  redirects: Array<{ from: string; to: string }>;
  excerpt?: string;
};

export type PageFetchFailureReason =
  | "invalid_url"
  | "private_address"
  | "dns_failed"
  | "request_failed"
  | "http_status"
  | "unsupported_content_type"
  | "too_many_redirects";

export type PageFetchFailure = {
  url: string;
  reason: PageFetchFailureReason;
  statusCode?: number;
};

export type PageFetchSummary = {
  successes: PageFetchSuccess[];
  failures: PageFetchFailure[];
};

export type PageFetchDependencies = {
  resolveHost?: (hostname: string) => Promise<ResolvedAddress[]>;
  requestOnce?: (request: PinnedPageRequest) => Promise<PinnedPageResponse>;
  now?: () => Date;
};

export type FetchPagesOptions = PageFetchDependencies & {
  signal?: AbortSignal;
  maxPages?: number;
  concurrency?: number;
};

class PageFetchError extends Error {
  readonly reason: PageFetchFailureReason;
  readonly statusCode: number | undefined;

  constructor(
    reason: PageFetchFailureReason,
    message: string,
    statusCode?: number,
  ) {
    super(message);
    this.name = "PageFetchError";
    this.reason = reason;
    this.statusCode = statusCode;
  }
}

function headerValue(
  headers: IncomingHttpHeaders,
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function ensureNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new BridgeError(
      "WORKER_CANCELLED",
      "The research request was cancelled.",
    );
  }
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) {
    return false;
  }
  if (family === 6 && !GLOBAL_IPV6.check(address, "ipv6")) {
    return false;
  }
  return !BLOCKED_ADDRESSES.check(address, family === 4 ? "ipv4" : "ipv6");
}

export function validatePageUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new PageFetchError("invalid_url", "The source URL is invalid.");
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    (url.port.length > 0 &&
      !(
        (url.protocol === "http:" && url.port === "80") ||
        (url.protocol === "https:" && url.port === "443")
      ))
  ) {
    throw new PageFetchError(
      "invalid_url",
      "Only credential-free HTTP(S) source URLs are supported.",
    );
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new PageFetchError(
      "private_address",
      "Local source hostnames are not allowed.",
    );
  }
  return url;
}

async function defaultResolveHost(hostname: string): Promise<ResolvedAddress[]> {
  const family = isIP(hostname);
  if (family !== 0) {
    return [{ address: hostname, family: family as 4 | 6 }];
  }
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  return addresses
    .filter(({ family: resolvedFamily }) =>
      resolvedFamily === 4 || resolvedFamily === 6,
    )
    .map(({ address, family: resolvedFamily }) => ({
      address,
      family: resolvedFamily as 4 | 6,
    }));
}

function defaultRequestOnce(
  pinned: PinnedPageRequest,
): Promise<PinnedPageResponse> {
  return new Promise((resolve, reject) => {
    const transport = pinned.url.protocol === "https:" ? https : http;
    let settled = false;

    const finish = (
      callback: () => void,
    ): void => {
      if (settled) {
        return;
      }
      settled = true;
      callback();
    };

    const request = transport.request(
      {
        protocol: pinned.url.protocol,
        hostname: pinned.address,
        family: pinned.family,
        port:
          pinned.url.port.length > 0
            ? Number(pinned.url.port)
            : pinned.url.protocol === "https:"
              ? 443
              : 80,
        path: `${pinned.url.pathname}${pinned.url.search}`,
        method: "GET",
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/json,text/plain,application/pdf;q=0.8,*/*;q=0.1",
          "Accept-Encoding": "identity",
          Host: pinned.url.host,
          Range: `bytes=0-${pinned.maxBodyBytes - 1}`,
          "User-Agent": "Codex-Search-Bridge/0.1 (+https://github.com/Zhao73/codex-search-bridge)",
        },
        ...(pinned.url.protocol === "https:" && isIP(pinned.url.hostname) === 0
          ? { servername: pinned.url.hostname }
          : {}),
        ...(pinned.signal === undefined ? {} : { signal: pinned.signal }),
      },
      (response) => {
        let bytesRead = 0;
        const bodyChunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          const remaining = pinned.maxBodyBytes - bytesRead;
          if (remaining > 0) {
            const retained = chunk.subarray(0, remaining);
            bodyChunks.push(retained);
            bytesRead += retained.byteLength;
          }
          if (bytesRead >= pinned.maxBodyBytes) {
            finish(() =>
              resolve({
                statusCode: response.statusCode ?? 0,
                headers: response.headers,
                bytesRead,
                body: Buffer.concat(bodyChunks),
              }),
            );
            response.destroy();
          }
        });
        response.once("end", () => {
          finish(() =>
            resolve({
              statusCode: response.statusCode ?? 0,
              headers: response.headers,
              bytesRead,
              body: Buffer.concat(bodyChunks),
            }),
          );
        });
        response.once("error", (error) => {
          finish(() => reject(error));
        });
      },
    );

    request.setTimeout(pinned.timeoutMs, () => {
      request.destroy(new Error("Page request timed out."));
    });
    request.once("error", (error) => {
      finish(() => reject(error));
    });
    request.end();
  });
}

function acceptedContentType(value: string | undefined): boolean {
  if (value === undefined) {
    return true;
  }
  const type = value.split(";", 1)[0]?.trim().toLowerCase();
  return (
    type === "text/html" ||
    type === "application/xhtml+xml" ||
    type === "text/plain" ||
    type === "application/json" ||
    type === "application/ld+json" ||
    type === "application/pdf"
  );
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    hellip: "…",
    lt: "<",
    nbsp: " ",
    ndash: "-",
    quot: '"',
  };
  return value.replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi,
    (entity, decimal: string | undefined, hexadecimal: string | undefined, name: string | undefined) => {
      if (decimal !== undefined) {
        const codePoint = Number(decimal);
        return Number.isInteger(codePoint) && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : entity;
      }
      if (hexadecimal !== undefined) {
        const codePoint = Number.parseInt(hexadecimal, 16);
        return Number.isInteger(codePoint) && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : entity;
      }
      return name === undefined ? entity : (named[name.toLowerCase()] ?? entity);
    },
  );
}

export function extractPageExcerpt(
  body: Buffer,
  contentType: string | undefined,
): string | undefined {
  const type = contentType?.split(";", 1)[0]?.trim().toLowerCase();
  if (type === "application/pdf") {
    return undefined;
  }
  let text = body.toString("utf8");
  if (type === "text/html" || type === "application/xhtml+xml") {
    text = text
      .replace(
        /<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi,
        " ",
      )
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " ");
    text = decodeHtmlEntities(text);
  }
  text = text.replace(/\s+/g, " ").trim();
  return text.length === 0 ? undefined : text.slice(0, MAX_EXCERPT_CHARACTERS);
}

async function resolvePublicAddress(
  url: URL,
  resolveHost: (hostname: string) => Promise<ResolvedAddress[]>,
): Promise<ResolvedAddress> {
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolveHost(url.hostname);
  } catch {
    throw new PageFetchError("dns_failed", "The source hostname did not resolve.");
  }

  if (addresses.length === 0) {
    throw new PageFetchError("dns_failed", "The source hostname did not resolve.");
  }
  if (addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new PageFetchError(
      "private_address",
      "The source hostname resolves to a non-public address.",
    );
  }
  return addresses.find(({ family }) => family === 4) ?? addresses[0]!;
}

export async function fetchPage(
  value: string,
  options: PageFetchDependencies & { signal?: AbortSignal } = {},
): Promise<PageFetchSuccess> {
  const resolveHost = options.resolveHost ?? defaultResolveHost;
  const requestOnce = options.requestOnce ?? defaultRequestOnce;
  const now = options.now ?? (() => new Date());
  const redirects: Array<{ from: string; to: string }> = [];
  const requestedUrl = validatePageUrl(value).toString();
  let current = validatePageUrl(value);

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    ensureNotCancelled(options.signal);
    const address = await resolvePublicAddress(current, resolveHost);
    let response: PinnedPageResponse;
    try {
      response = await requestOnce({
        url: current,
        address: address.address,
        family: address.family,
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxBodyBytes: MAX_BODY_BYTES,
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      });
    } catch (error) {
      ensureNotCancelled(options.signal);
      throw new PageFetchError(
        "request_failed",
        "The source page request failed.",
      );
    }

    const location = headerValue(response.headers, "location");
    if (
      response.statusCode >= 300 &&
      response.statusCode < 400 &&
      location !== undefined
    ) {
      if (redirectCount === MAX_REDIRECTS) {
        throw new PageFetchError(
          "too_many_redirects",
          "The source exceeded the redirect limit.",
        );
      }
      const next = validatePageUrl(new URL(location, current).toString());
      redirects.push({ from: current.toString(), to: next.toString() });
      current = next;
      continue;
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new PageFetchError(
        "http_status",
        "The source returned an unsuccessful HTTP status.",
        response.statusCode,
      );
    }

    const contentType = headerValue(response.headers, "content-type");
    if (!acceptedContentType(contentType)) {
      throw new PageFetchError(
        "unsupported_content_type",
        "The source returned an unsupported content type.",
      );
    }

    const excerpt = extractPageExcerpt(response.body, contentType);
    return {
      requestedUrl,
      finalUrl: current.toString(),
      statusCode: response.statusCode,
      ...(contentType === undefined ? {} : { contentType }),
      bytesRead: response.bytesRead,
      retrievedAt: now().toISOString(),
      redirects,
      ...(excerpt === undefined ? {} : { excerpt }),
    };
  }

  throw new PageFetchError(
    "too_many_redirects",
    "The source exceeded the redirect limit.",
  );
}

export async function fetchPages(
  values: readonly string[],
  options: FetchPagesOptions = {},
): Promise<PageFetchSummary> {
  ensureNotCancelled(options.signal);
  const maxPages = options.maxPages ?? 12;
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, DEFAULT_CONCURRENCY),
  );
  const queue = [...new Set(values)].slice(0, maxPages);
  const successes: PageFetchSuccess[] = [];
  const failures: PageFetchFailure[] = [];
  let nextIndex = 0;

  const worker = async (): Promise<void> => {
    while (nextIndex < queue.length) {
      const index = nextIndex;
      nextIndex += 1;
      const url = queue[index]!;
      try {
        successes.push(await fetchPage(url, options));
      } catch (error) {
        if (error instanceof BridgeError) {
          throw error;
        }
        const failure =
          error instanceof PageFetchError
            ? error
            : new PageFetchError("request_failed", "The source page request failed.");
        failures.push({
          url,
          reason: failure.reason,
          ...(failure.statusCode === undefined
            ? {}
            : { statusCode: failure.statusCode }),
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, worker),
  );
  ensureNotCancelled(options.signal);
  return { successes, failures };
}

function appendUnique(values: string[], value: string): void {
  if (!values.includes(value)) {
    values.push(value);
  }
}

export function mergePageFetchEvidence(
  evidence: CodexEvidence,
  summary: PageFetchSummary,
): CodexEvidence {
  const observedUrls = [...evidence.observedUrls];
  const openedUrls = [...evidence.openedUrls];
  const redirects = new Map(evidence.redirects);

  for (const success of summary.successes) {
    appendUnique(observedUrls, success.requestedUrl);
    appendUnique(observedUrls, success.finalUrl);
    appendUnique(openedUrls, success.requestedUrl);
    appendUnique(openedUrls, success.finalUrl);
    for (const redirect of success.redirects) {
      appendUnique(observedUrls, redirect.from);
      appendUnique(observedUrls, redirect.to);
      redirects.set(redirect.from, redirect.to);
    }
  }

  const bridgeFetchEvents = evidence.bridgeFetchEvents + summary.successes.length;
  return {
    ...evidence,
    openedPageEvents: evidence.codexOpenPageEvents + bridgeFetchEvents,
    bridgeFetchEvents,
    observedUrls,
    openedUrls,
    redirects,
    bridgeFetchFailures: [
      ...evidence.bridgeFetchFailures,
      ...summary.failures,
    ],
  };
}
