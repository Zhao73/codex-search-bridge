import { describe, expect, it } from "vitest";

import { BridgeError } from "../src/errors.js";
import { resolveTimeWindow } from "../src/time-window.js";

const now = new Date("2026-07-25T12:00:00Z");

describe("resolveTimeWindow", () => {
  it("preserves an explicit calendar-date window", () => {
    expect(
      resolveTimeWindow(
        {
          question: "x",
          date_from: "2026-07-01",
          date_to: "2026-07-25",
        },
        now,
      ),
    ).toEqual({ from: "2026-07-01", to: "2026-07-25" });
  });

  it("resolves a recency window to UTC instants", () => {
    expect(resolveTimeWindow({ question: "x", recency_hours: 24 }, now)).toEqual(
      {
        fromInstant: "2026-07-24T12:00:00.000Z",
        toInstant: "2026-07-25T12:00:00.000Z",
      },
    );
  });

  it("rejects a reversed calendar-date window", () => {
    expect(() =>
      resolveTimeWindow(
        {
          question: "x",
          date_from: "2026-07-25",
          date_to: "2026-07-01",
        },
        now,
      ),
    ).toThrowError(BridgeError);
  });

  it("intersects recency and explicit date bounds", () => {
    expect(
      resolveTimeWindow(
        {
          question: "x",
          recency_hours: 48,
          date_from: "2026-07-25",
          date_to: "2026-07-26",
        },
        now,
      ),
    ).toEqual({
      from: "2026-07-25",
      to: "2026-07-26",
      fromInstant: "2026-07-25T00:00:00.000Z",
      toInstant: "2026-07-25T12:00:00.000Z",
    });
  });

  it("rejects an empty intersection", () => {
    expect(() =>
      resolveTimeWindow(
        {
          question: "x",
          recency_hours: 24,
          date_from: "2026-07-01",
          date_to: "2026-07-02",
        },
        now,
      ),
    ).toThrowError(/time constraints do not overlap/i);
  });
});
