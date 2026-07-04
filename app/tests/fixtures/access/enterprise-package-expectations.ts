import type { AtlasCapability, AtlasProduct } from "@/domains/access/capabilities";

export interface EnterprisePackageExpectation {
  excludedCapabilities: AtlasCapability[];
  includedCapabilities: AtlasCapability[];
  maxMembers: number | null;
  product: AtlasProduct;
}

export const ENTERPRISE_PACKAGE_EXPECTATIONS: EnterprisePackageExpectation[] = [
  {
    product: "atlas_briefing_room",
    includedCapabilities: [
      "workspace.export",
      "workspace.shared",
      "monitoring.watchlists",
      "api.keys",
      "api.mcp",
    ],
    excludedCapabilities: ["auth.sso", "coverage.underwriting"],
    maxMembers: 10,
  },
  {
    product: "atlas_field_intelligence",
    includedCapabilities: [
      "workspace.export",
      "workspace.shared",
      "monitoring.watchlists",
      "coverage.targets",
      "integrations.slack",
    ],
    excludedCapabilities: ["auth.sso", "coverage.underwriting"],
    maxMembers: 25,
  },
  {
    product: "atlas_civic_operating_layer",
    includedCapabilities: [
      "workspace.export",
      "workspace.shared",
      "monitoring.watchlists",
      "coverage.targets",
      "public.directories",
      "api.keys",
      "api.mcp",
      "auth.sso",
    ],
    excludedCapabilities: ["coverage.underwriting"],
    maxMembers: 75,
  },
  {
    product: "atlas_coverage_underwriting",
    includedCapabilities: [
      "workspace.export",
      "workspace.shared",
      "coverage.targets",
      "public.directories",
      "coverage.underwriting",
    ],
    excludedCapabilities: ["auth.sso"],
    maxMembers: 10,
  },
];
