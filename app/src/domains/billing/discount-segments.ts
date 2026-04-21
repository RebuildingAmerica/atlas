export type DiscountSegment =
  | "independent_journalist"
  | "grassroots_nonprofit"
  | "civic_tech_worker";

export const DISCOUNT_SEGMENT_LABELS: Record<DiscountSegment, string> = {
  independent_journalist: "Independent Journalist",
  grassroots_nonprofit: "Grassroots Nonprofit (<$2M budget)",
  civic_tech_worker: "Civic Tech Worker",
};

export const DISCOUNT_PERCENTAGES: Record<DiscountSegment, number> = {
  independent_journalist: 0.5, // 50% off
  grassroots_nonprofit: 0.4, // 40% off
  civic_tech_worker: 0.5, // 50% off
};

export const SEGMENT_DESCRIPTIONS: Record<DiscountSegment, string> = {
  independent_journalist: "Solo journalist or freelancer doing civic reporting",
  grassroots_nonprofit:
    "501(c)(3) nonprofit with annual budget under $2M doing frontline civic work",
  civic_tech_worker:
    "Building tools, infrastructure, or platforms for civic engagement and accountability",
};

export type VerificationStatus = "pending" | "verified" | "rejected" | "expired";
