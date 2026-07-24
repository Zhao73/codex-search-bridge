import type { Depth, ResearchResult } from "./contracts.js";
import type { CodexEvidence } from "./jsonl-events.js";
import { BridgeError } from "./errors.js";
import { matchObservedUrl } from "./url-evidence.js";

const UNSUPPORTED_CLAIM_NOTE =
  "No cited source for this claim was observed in the Codex web event stream.";
const UNOBSERVED_SOURCE_LIMITATION =
  "One or more cited source URLs were not observed in the Codex web event stream.";
const DEEP_SOURCE_LIMITATION =
  "One or more confirmed deep-research claims cite fewer than two independent sources.";

function addUnique(values: readonly string[], value: string): string[] {
  return values.includes(value) ? [...values] : [...values, value];
}

function combineNote(existing: string | undefined, addition: string): string {
  if (existing === undefined || existing.length === 0) {
    return addition;
  }
  return existing.includes(addition) ? existing : `${existing} ${addition}`;
}

export function verifyResearchResult(
  input: ResearchResult,
  evidence: CodexEvidence,
  depth: Depth,
): ResearchResult {
  if (evidence.webSearchEvents < 1) {
    throw new BridgeError(
      "EVIDENCE_VERIFICATION_FAILED",
      "No completed live web-search event was observed.",
    );
  }
  if (depth !== "quick" && evidence.openedPageEvents < 1) {
    throw new BridgeError(
      "EVIDENCE_VERIFICATION_FAILED",
      "Standard and deep research require open-page evidence.",
    );
  }

  const verifiedSourceIds = new Set<string>();
  const sources = input.sources.map((source) => {
    const provenanceVerified =
      matchObservedUrl(source.url, evidence.observedUrls, evidence.redirects) !==
      undefined;
    if (provenanceVerified) {
      verifiedSourceIds.add(source.id);
    }
    return { ...source, provenance_verified: provenanceVerified };
  });

  if (sources.length === 0 || verifiedSourceIds.size === 0) {
    throw new BridgeError(
      "EVIDENCE_VERIFICATION_FAILED",
      "No cited source URL matched the Codex web event stream.",
    );
  }

  let claimWasDowngraded = false;
  let deepClaimHasSingleSource = false;
  const claims = input.claims.map((claim) => {
    const supportedSourceCount = claim.source_ids.filter((sourceId) =>
      verifiedSourceIds.has(sourceId),
    ).length;
    const hasSupport = supportedSourceCount > 0;
    const inferredDate = /\b(relative|inferred|derived)\b/i.test(claim.note ?? "");
    const confidence =
      inferredDate && claim.confidence === "high" ? "moderate" : claim.confidence;

    if (
      depth === "deep" &&
      claim.status === "confirmed" &&
      supportedSourceCount < 2
    ) {
      deepClaimHasSingleSource = true;
    }

    if (
      !hasSupport &&
      (claim.status === "confirmed" || claim.status === "partially_confirmed")
    ) {
      claimWasDowngraded = true;
      return {
        ...claim,
        status: "unconfirmed" as const,
        confidence: "unknown" as const,
        note: combineNote(claim.note, UNSUPPORTED_CLAIM_NOTE),
      };
    }

    return { ...claim, confidence };
  });

  let limitations = [...input.limitations];
  if (verifiedSourceIds.size < sources.length) {
    limitations = addUnique(limitations, UNOBSERVED_SOURCE_LIMITATION);
  }
  if (deepClaimHasSingleSource) {
    limitations = addUnique(limitations, DEEP_SOURCE_LIMITATION);
  }
  if (evidence.unknownEventTypes.length > 0) {
    limitations = addUnique(
      limitations,
      `Ignored unknown Codex event types: ${evidence.unknownEventTypes.join(", ")}.`,
    );
  }

  const completeProvenance =
    verifiedSourceIds.size === sources.length && !claimWasDowngraded;

  return {
    ...input,
    claims,
    sources,
    verification: {
      status: completeProvenance ? "verified" : "partial",
      web_search_events: evidence.webSearchEvents,
      opened_page_events: evidence.openedPageEvents,
      cited_sources_seen_in_events: verifiedSourceIds.size,
      total_cited_sources: sources.length,
    },
    limitations,
  };
}
