import { describe, expect, it } from "vitest";

import { BridgeError } from "../src/errors.js";
import {
  type ProviderAvailability,
  PROVIDER_PREFERENCE,
  selectProvider,
} from "../src/providers.js";

function availability(
  overrides: Partial<ProviderAvailability> = {},
): ProviderAvailability {
  return { codex: false, claude: false, tavily: false, ...overrides };
}

describe("selectProvider", () => {
  it("prefers the strongest available evidence backend", () => {
    expect(PROVIDER_PREFERENCE).toEqual(["codex", "claude", "tavily"]);
    expect(
      selectProvider(availability({ codex: true, claude: true, tavily: true })),
    ).toBe("codex");
    expect(
      selectProvider(availability({ claude: true, tavily: true })),
    ).toBe("claude");
    expect(selectProvider(availability({ tavily: true }))).toBe("tavily");
  });

  it("honours an explicit provider request", () => {
    expect(
      selectProvider(availability({ codex: true, tavily: true }), "tavily"),
    ).toBe("tavily");
  });

  it("treats auto and an empty request as automatic selection", () => {
    expect(selectProvider(availability({ claude: true }), "auto")).toBe("claude");
    expect(selectProvider(availability({ claude: true }), "  ")).toBe("claude");
  });

  it("normalizes case and surrounding whitespace on an explicit request", () => {
    expect(selectProvider(availability({ codex: true }), " CODEX ")).toBe("codex");
  });

  it("rejects an explicitly requested provider that is unavailable", () => {
    expect(() => selectProvider(availability({ codex: true }), "claude")).toThrow(
      BridgeError,
    );
    try {
      selectProvider(availability({ codex: true }), "claude");
    } catch (error) {
      expect((error as BridgeError).code).toBe("PROVIDER_UNAVAILABLE");
    }
  });

  it("rejects an unknown provider name", () => {
    try {
      selectProvider(availability({ codex: true }), "perplexity");
      expect.unreachable("unknown provider must throw");
    } catch (error) {
      expect((error as BridgeError).code).toBe("INVALID_INPUT");
    }
  });

  it("fails when nothing is available", () => {
    try {
      selectProvider(availability());
      expect.unreachable("empty availability must throw");
    } catch (error) {
      expect((error as BridgeError).code).toBe("PROVIDER_UNAVAILABLE");
    }
  });
});
