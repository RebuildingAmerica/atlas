import type { VerificationRecordResponseSegment } from "@/generated/platform-schemas";

/**
 * How each discount segment reads to an operator. The wording matches what the
 * applicant chose in the Atlas app (app/src/domains/billing/discount-segments.ts).
 */
export const DISCOUNT_SEGMENT_LABELS: Record<
  VerificationRecordResponseSegment,
  string
> = {
  civic_tech_worker: "Civic Tech Worker",
  grassroots_nonprofit: "Grassroots Nonprofit (<$2M budget)",
  independent_journalist: "Independent Creator or Journalist",
  student: "Student",
};
