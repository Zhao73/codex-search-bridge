import { access, constants } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import process from "node:process";

import { BridgeError } from "./errors.js";

export const PROVIDER_IDS = ["codex", "claude", "tavily"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/**
 * How much of the evidence pipeline actually ran, from strongest to weakest.
 *
 * - `native_audited`: the provider's own live search opened pages, and a second
 *   isolated worker reconciled directly fetched page text against the answer.
 * - `native`: the provider's own live search ran, but no content-audit pass
 *   reconciled directly fetched text.
 * - `search_api`: a third-party search API supplied the sources and only the
 *   Bridge's restricted HTTP(S) verifier opened pages. No model reconciled the
 *   fetched text, so claim-level verification is not available.
 */
export const EVIDENCE_TIERS = [
  "native_audited",
  "native",
  "search_api",
] as const;
export type EvidenceTier = (typeof EVIDENCE_TIERS)[number];

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value);
}

function executableCandidates(
  name: string,
  environment: NodeJS.ProcessEnv,
): string[] {
  if (isAbsolute(name) || name.includes("/") || name.includes("\\")) {
    return [name];
  }

  const pathValue = environment.PATH ?? environment.Path ?? "";
  const directories = pathValue.split(delimiter).filter((entry) => entry.length > 0);
  // ponytail: PATHEXT only matters on Windows; elsewhere the bare name is the file.
  const extensions =
    process.platform === "win32"
      ? [
          "",
          ...(environment.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
            .split(";")
            .filter((entry) => entry.length > 0),
        ]
      : [""];

  return directories.flatMap((directory) =>
    extensions.map((extension) => join(directory, `${name}${extension}`)),
  );
}

export async function resolveExecutable(
  name: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  for (const candidate of executableCandidates(name, environment)) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

export type ProviderAvailability = {
  codex: boolean;
  claude: boolean;
  tavily: boolean;
};

export type ProviderBinaries = {
  codexBin: string;
  claudeBin: string;
};

export function resolveProviderBinaries(
  environment: NodeJS.ProcessEnv = process.env,
): ProviderBinaries {
  return {
    codexBin: environment.CODEX_SEARCH_BRIDGE_CODEX_BIN ?? "codex",
    claudeBin: environment.CODEX_SEARCH_BRIDGE_CLAUDE_BIN ?? "claude",
  };
}

export async function detectAvailability(
  environment: NodeJS.ProcessEnv = process.env,
  binaries?: Partial<ProviderBinaries>,
): Promise<ProviderAvailability> {
  const defaults = resolveProviderBinaries(environment);
  const codexBin = binaries?.codexBin ?? defaults.codexBin;
  const claudeBin = binaries?.claudeBin ?? defaults.claudeBin;
  const [codex, claude] = await Promise.all([
    resolveExecutable(codexBin, environment),
    resolveExecutable(claudeBin, environment),
  ]);

  return {
    codex: codex !== undefined,
    claude: claude !== undefined,
    tavily: (environment.TAVILY_API_KEY ?? "").trim().length > 0,
  };
}

/**
 * Preference order is strongest evidence first. Codex and Claude both run a real
 * agent with native live search, so they can produce audited claim-level
 * evidence; Tavily only supplies URLs, so it is the last resort.
 */
export const PROVIDER_PREFERENCE: readonly ProviderId[] = [
  "codex",
  "claude",
  "tavily",
];

const UNAVAILABLE_REMEDIATION =
  "Install Codex CLI or Claude Code and sign in, or set TAVILY_API_KEY for the keyed search backend.";

export function selectProvider(
  availability: ProviderAvailability,
  requested?: string,
): ProviderId {
  const normalized = (requested ?? "auto").trim().toLowerCase();

  if (normalized !== "auto" && normalized.length > 0) {
    if (!isProviderId(normalized)) {
      throw new BridgeError(
        "INVALID_INPUT",
        `Unknown research provider "${normalized}". Expected one of: ${PROVIDER_IDS.join(", ")}, or auto.`,
      );
    }
    if (!availability[normalized]) {
      throw new BridgeError(
        "PROVIDER_UNAVAILABLE",
        `The "${normalized}" research provider was requested but is not available.`,
        { remediation: UNAVAILABLE_REMEDIATION },
      );
    }
    return normalized;
  }

  const selected = PROVIDER_PREFERENCE.find((id) => availability[id]);
  if (selected === undefined) {
    throw new BridgeError(
      "PROVIDER_UNAVAILABLE",
      "No research provider is available.",
      { remediation: UNAVAILABLE_REMEDIATION },
    );
  }
  return selected;
}
