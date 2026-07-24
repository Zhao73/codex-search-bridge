import type { ResearchWebInput } from "./contracts.js";
import { isIsoCalendarDate } from "./contracts.js";
import { BridgeError } from "./errors.js";

export type TimeWindowInput = Pick<
  ResearchWebInput,
  "question" | "recency_hours" | "date_from" | "date_to"
>;

export type ResolvedTimeWindow = {
  from?: string;
  to?: string;
  fromInstant?: string;
  toInstant?: string;
};

function startOfUtcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function endOfUtcDate(value: string): Date {
  return new Date(`${value}T23:59:59.999Z`);
}

function invalidInput(message: string): never {
  throw new BridgeError("INVALID_INPUT", message);
}

export function resolveTimeWindow(
  input: TimeWindowInput,
  now = new Date(),
): ResolvedTimeWindow {
  if (Number.isNaN(now.getTime())) {
    return invalidInput("The current time is invalid.");
  }

  if (input.date_from !== undefined && !isIsoCalendarDate(input.date_from)) {
    return invalidInput("date_from must be a valid YYYY-MM-DD date.");
  }
  if (input.date_to !== undefined && !isIsoCalendarDate(input.date_to)) {
    return invalidInput("date_to must be a valid YYYY-MM-DD date.");
  }
  if (
    input.date_from !== undefined &&
    input.date_to !== undefined &&
    input.date_from > input.date_to
  ) {
    return invalidInput("date_from cannot be later than date_to.");
  }

  const calendarBounds = {
    ...(input.date_from === undefined ? {} : { from: input.date_from }),
    ...(input.date_to === undefined ? {} : { to: input.date_to }),
  };

  if (input.recency_hours === undefined) {
    return calendarBounds;
  }
  if (
    !Number.isInteger(input.recency_hours) ||
    input.recency_hours < 1 ||
    input.recency_hours > 8_760
  ) {
    return invalidInput("recency_hours must be an integer from 1 to 8760.");
  }

  const recencyStart = new Date(
    now.getTime() - input.recency_hours * 60 * 60 * 1_000,
  );
  const explicitStart =
    input.date_from === undefined
      ? recencyStart
      : startOfUtcDate(input.date_from);
  const explicitEnd =
    input.date_to === undefined ? now : endOfUtcDate(input.date_to);
  const intersectionStart = new Date(
    Math.max(recencyStart.getTime(), explicitStart.getTime()),
  );
  const intersectionEnd = new Date(
    Math.min(now.getTime(), explicitEnd.getTime()),
  );

  if (intersectionStart.getTime() > intersectionEnd.getTime()) {
    return invalidInput("The supplied time constraints do not overlap.");
  }

  return {
    ...calendarBounds,
    fromInstant: intersectionStart.toISOString(),
    toInstant: intersectionEnd.toISOString(),
  };
}
