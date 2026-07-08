export type DiscountSegment =
  "student" | "independent_journalist" | "grassroots_nonprofit" | "civic_tech_worker";

export const DISCOUNT_SEGMENTS: readonly DiscountSegment[] = [
  "student",
  "independent_journalist",
  "grassroots_nonprofit",
  "civic_tech_worker",
];

export const DISCOUNT_SEGMENT_LABELS: Record<DiscountSegment, string> = {
  student: "Student",
  independent_journalist: "Independent Creator or Journalist",
  grassroots_nonprofit: "Grassroots Nonprofit (<$2M budget)",
  civic_tech_worker: "Civic Tech Worker",
};

export const DISCOUNT_PERCENTAGES: Record<DiscountSegment, number> = {
  student: 0.2, // 20% off the four-month Pro rate
  independent_journalist: 0.5, // 50% off individual Pro
  grassroots_nonprofit: 0.4, // 40% off
  civic_tech_worker: 0.5, // 50% off
};

export const SEGMENT_DESCRIPTIONS: Record<DiscountSegment, string> = {
  student: "Current student using Atlas for coursework, campus reporting, or civic research",
  independent_journalist: "Independent creator or journalist doing civic reporting",
  grassroots_nonprofit:
    "501(c)(3) nonprofit with annual budget under $2M doing frontline civic work",
  civic_tech_worker:
    "Building tools, infrastructure, or platforms for civic engagement and accountability",
};

export type VerificationStatus = "pending" | "verified" | "rejected" | "expired";
