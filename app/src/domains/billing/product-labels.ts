import type { AtlasProduct } from "@/domains/access/capabilities";

/**
 * Canonical display labels for Atlas products.
 *
 * Imported by every UI surface that names a product (pricing page, checkout
 * handoff, sign-in heading, post-checkout welcome) so the labels can never
 * drift between surfaces.
 */
export const PRODUCT_LABELS: Record<AtlasProduct, string> = {
  atlas_pro: "Atlas Pro",
  atlas_team: "Atlas Team",
  atlas_research_pass: "Atlas Research Pass",
  atlas_briefing_room: "Atlas Briefing Room",
  atlas_field_intelligence: "Atlas Field Intelligence",
  atlas_civic_operating_layer: "Atlas Civic Operating Layer",
  atlas_coverage_underwriting: "Atlas Coverage Underwriting",
};
