const TRACKING_PARAMETERS = new Set([
  "fbclid",
  "gclid",
  "mc_cid",
  "mc_eid",
  "ref_src",
]);

function isTrackingParameter(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.startsWith("utm_") || TRACKING_PARAMETERS.has(lower);
}

export function normalizeEvidenceUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new TypeError("Evidence URLs must use HTTP or HTTPS.");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new TypeError("Evidence URLs cannot contain credentials.");
  }

  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (isTrackingParameter(key)) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();

  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }

  const serialized = url.toString();
  if (url.pathname === "/" && url.search.length === 0) {
    return serialized.replace(/\/$/, "");
  }
  return serialized;
}

function normalizedRedirects(
  redirects: ReadonlyMap<string, string>,
): Map<string, string> {
  const result = new Map<string, string>();
  for (const [from, to] of redirects) {
    result.set(normalizeEvidenceUrl(from), normalizeEvidenceUrl(to));
  }
  return result;
}

function redirectClosure(
  value: string,
  redirects: ReadonlyMap<string, string>,
): Set<string> {
  const values = new Set<string>([value]);
  let current = value;
  for (let index = 0; index < 8; index += 1) {
    const next = redirects.get(current);
    if (next === undefined || values.has(next)) {
      break;
    }
    values.add(next);
    current = next;
  }
  return values;
}

export function urlsMatch(
  left: string,
  right: string,
  redirects: ReadonlyMap<string, string> = new Map(),
): boolean {
  const normalizedLeft = normalizeEvidenceUrl(left);
  const normalizedRight = normalizeEvidenceUrl(right);
  if (normalizedLeft === normalizedRight) {
    return true;
  }

  const mapping = normalizedRedirects(redirects);
  const leftClosure = redirectClosure(normalizedLeft, mapping);
  const rightClosure = redirectClosure(normalizedRight, mapping);
  return [...leftClosure].some((value) => rightClosure.has(value));
}

export function matchObservedUrl(
  citedUrl: string,
  observedUrls: readonly string[],
  redirects: ReadonlyMap<string, string> = new Map(),
): string | undefined {
  for (const observedUrl of observedUrls) {
    try {
      if (urlsMatch(citedUrl, observedUrl, redirects)) {
        return observedUrl;
      }
    } catch {
      // Invalid observed URLs are not provenance evidence.
    }
  }
  return undefined;
}
