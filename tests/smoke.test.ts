import { describe, expect, it } from "vitest";

import { PROJECT_NAME } from "../src/contracts.js";

describe("package skeleton", () => {
  it("exports the public project name", () => {
    expect(PROJECT_NAME).toBe("Codex Search Bridge");
  });
});
