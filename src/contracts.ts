import { z } from "zod";

export const PROJECT_NAME = "Codex Search Bridge" as const;
export const PROJECT_VERSION = "0.1.0" as const;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const RFC3339_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const LANGUAGE_TAG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

export function isIsoCalendarDate(value: string): boolean {
  const match = ISO_DATE_PATTERN.exec(value);
  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isRfc3339(value: string): boolean {
  return RFC3339_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

export const IsoDateSchema = z
  .string()
  .refine(isIsoCalendarDate, "Expected a valid YYYY-MM-DD calendar date");

export const Rfc3339Schema = z
  .string()
  .refine(isRfc3339, "Expected an RFC 3339 timestamp with timezone");

export const DateOrTimestampSchema = z.union([IsoDateSchema, Rfc3339Schema]);
export const DepthSchema = z.enum(["quick", "standard", "deep"]);
export const VerificationStatusSchema = z.enum([
  "confirmed",
  "partially_confirmed",
  "unconfirmed",
  "conflicting",
]);
export const ConfidenceSchema = z.enum([
  "high",
  "moderate",
  "low",
  "unknown",
]);
export const SourceTypeSchema = z.enum([
  "primary",
  "secondary",
  "social",
  "unknown",
]);
export const OverallVerificationStatusSchema = z.enum([
  "verified",
  "partial",
  "failed",
]);

export const ResearchWebInputSchema = z
  .object({
    question: z.string().trim().min(1).max(8_000),
    recency_hours: z.number().int().min(1).max(8_760).optional(),
    date_from: IsoDateSchema.optional(),
    date_to: IsoDateSchema.optional(),
    language: z
      .string()
      .regex(LANGUAGE_TAG_PATTERN, "Expected a BCP 47-like language tag")
      .optional(),
    max_sources: z.number().int().min(3).max(12).default(6),
    depth: DepthSchema.default("standard"),
  })
  .strict();

export const ResearchQuerySchema = z
  .object({
    question: z.string().min(1).max(8_000),
    depth: DepthSchema,
    max_sources: z.number().int().min(3).max(12),
    recency_hours: z.number().int().min(1).max(8_760).optional(),
    date_from: IsoDateSchema.optional(),
    date_to: IsoDateSchema.optional(),
    language: z.string().regex(LANGUAGE_TAG_PATTERN).optional(),
  })
  .strict();

export const ClaimSchema = z
  .object({
    id: z.string().min(1),
    claim: z.string().min(1),
    status: VerificationStatusSchema,
    confidence: ConfidenceSchema,
    event_date: DateOrTimestampSchema.optional(),
    source_ids: z.array(z.string().min(1)),
    note: z.string().min(1).optional(),
  })
  .strict();

export const SourceSchema = z
  .object({
    id: z.string().min(1),
    url: z.url(),
    title: z.string().min(1),
    publisher: z.string().min(1).optional(),
    published_at: DateOrTimestampSchema.optional(),
    updated_at: DateOrTimestampSchema.optional(),
    retrieved_at: Rfc3339Schema,
    source_type: SourceTypeSchema,
    provenance_verified: z.boolean(),
  })
  .strict();

export const EvidenceSummarySchema = z
  .object({
    status: OverallVerificationStatusSchema,
    web_search_events: z.number().int().nonnegative(),
    opened_page_events: z.number().int().nonnegative(),
    cited_sources_seen_in_events: z.number().int().nonnegative(),
    total_cited_sources: z.number().int().nonnegative(),
  })
  .strict();

export const ResearchResultSchema = z
  .object({
    answer: z.string().min(1),
    as_of: Rfc3339Schema,
    query: ResearchQuerySchema,
    claims: z.array(ClaimSchema),
    sources: z.array(SourceSchema),
    verification: EvidenceSummarySchema,
    limitations: z.array(z.string().min(1)),
  })
  .strict();

export type ResearchWebInput = z.infer<typeof ResearchWebInputSchema>;
export type ResearchQuery = z.infer<typeof ResearchQuerySchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type Source = z.infer<typeof SourceSchema>;
export type ResearchResult = z.infer<typeof ResearchResultSchema>;
export type Depth = z.infer<typeof DepthSchema>;
export type VerificationStatus = z.infer<typeof VerificationStatusSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
