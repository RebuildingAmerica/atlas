/**
 * Atlas product identifiers that drive capability and limit resolution.
 */
export type AtlasProduct = "atlas_pro" | "atlas_team" | "atlas_research_pass";

/**
 * The full set of feature capability strings Atlas recognizes.
 */
export type AtlasCapability =
  | "research.run"
  | "research.unlimited"
  | "workspace.notes"
  | "workspace.export"
  | "workspace.shared"
  | "api.keys"
  | "api.mcp"
  | "monitoring.watchlists"
  | "integrations.slack"
  | "auth.sso";

/**
 * The full set of numeric limit keys Atlas enforces.
 * A value of null means the limit is unbounded (unlimited).
 */
export type AtlasLimit =
  | "research_runs_per_month"
  | "max_shortlists"
  | "max_shortlist_entries"
  | "max_api_keys"
  | "api_requests_per_day"
  | "public_api_requests_per_hour"
  | "max_members";

/**
 * The resolved capability set and limit map for a given set of active products.
 */
export interface ResolvedCapabilities {
  capabilities: Set<AtlasCapability>;
  limits: Record<AtlasLimit, number | null>;
}

/**
 * JSON-serializable form of ResolvedCapabilities — capabilities are an array
 * rather than a Set, so the shape can cross process/network boundaries.
 */
export interface SerializedResolvedCapabilities {
  capabilities: AtlasCapability[];
  limits: Record<AtlasLimit, number | null>;
}

// ---------------------------------------------------------------------------
// Static product-to-capability mapping
// ---------------------------------------------------------------------------

const PRO_CAPABILITIES: AtlasCapability[] = [
  "research.run",
  "research.unlimited",
  "workspace.notes",
  "workspace.export",
  "api.keys",
  "api.mcp",
];

const TEAM_CAPABILITIES: AtlasCapability[] = [
  ...PRO_CAPABILITIES,
  "workspace.shared",
  "monitoring.watchlists",
  "integrations.slack",
  "auth.sso",
];

export const PRODUCT_CAPABILITIES: Record<AtlasProduct, AtlasCapability[]> = {
  atlas_pro: PRO_CAPABILITIES,
  atlas_team: TEAM_CAPABILITIES,
  atlas_research_pass: PRO_CAPABILITIES,
};

// ---------------------------------------------------------------------------
// Static product-to-limit mapping
// ---------------------------------------------------------------------------

const PRO_LIMITS: Record<AtlasLimit, number | null> = {
  research_runs_per_month: null,
  max_shortlists: null,
  max_shortlist_entries: null,
  max_api_keys: 1,
  api_requests_per_day: 1000,
  public_api_requests_per_hour: null,
  max_members: 1,
};

const TEAM_LIMITS: Record<AtlasLimit, number | null> = {
  research_runs_per_month: null,
  max_shortlists: null,
  max_shortlist_entries: null,
  max_api_keys: null,
  api_requests_per_day: 10000,
  public_api_requests_per_hour: null,
  max_members: 50,
};

export const PRODUCT_LIMITS: Record<AtlasProduct, Record<AtlasLimit, number | null>> = {
  atlas_pro: PRO_LIMITS,
  atlas_team: TEAM_LIMITS,
  atlas_research_pass: PRO_LIMITS,
};

// ---------------------------------------------------------------------------
// Defaults (no active products)
// ---------------------------------------------------------------------------

/**
 * Capabilities granted to every authenticated user regardless of subscription.
 */
export const DEFAULT_CAPABILITIES: Set<AtlasCapability> = new Set<AtlasCapability>([
  "research.run",
]);

/**
 * Limits applied when no paid product is active.
 */
export const DEFAULT_LIMITS: Record<AtlasLimit, number | null> = {
  research_runs_per_month: 2,
  max_shortlists: 1,
  max_shortlist_entries: 25,
  max_api_keys: 0,
  api_requests_per_day: 0,
  public_api_requests_per_hour: 100,
  max_members: 1,
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns the most permissive value between two limit values.
 * null represents "unlimited" and is always preferred over any numeric value.
 */
function mostPermissive(a: number | null, b: number | null): number | null {
  if (a === null || b === null) {
    return null;
  }
  return Math.max(a, b);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves the union of capabilities and the most-permissive limit set for
 * the given array of active product identifiers.
 *
 * When no products are provided the defaults are returned unchanged.
 */
export function resolveCapabilities(activeProducts: AtlasProduct[]): ResolvedCapabilities {
  if (activeProducts.length === 0) {
    return {
      capabilities: new Set(DEFAULT_CAPABILITIES),
      limits: { ...DEFAULT_LIMITS },
    };
  }

  const capabilities = new Set<AtlasCapability>(DEFAULT_CAPABILITIES);
  let limits: Record<AtlasLimit, number | null> = { ...DEFAULT_LIMITS };

  for (const product of activeProducts) {
    for (const cap of PRODUCT_CAPABILITIES[product]) {
      capabilities.add(cap);
    }

    const productLimits = PRODUCT_LIMITS[product];
    const mergedLimits = {} as Record<AtlasLimit, number | null>;
    for (const key of Object.keys(productLimits) as AtlasLimit[]) {
      mergedLimits[key] = mostPermissive(limits[key], productLimits[key]);
    }
    limits = mergedLimits;
  }

  return { capabilities, limits };
}

/**
 * Returns whether the resolved capability set includes the given capability.
 */
export function hasCapability(resolved: ResolvedCapabilities, cap: AtlasCapability): boolean {
  return resolved.capabilities.has(cap);
}

/**
 * Returns the resolved limit value for the given limit key.
 * null means the limit is unbounded.
 */
export function getLimit(resolved: ResolvedCapabilities, limit: AtlasLimit): number | null {
  return resolved.limits[limit];
}

/**
 * Converts a ResolvedCapabilities into its JSON-serializable form.
 */
export function serializeResolvedCapabilities(
  resolved: ResolvedCapabilities,
): SerializedResolvedCapabilities {
  return {
    capabilities: Array.from(resolved.capabilities),
    limits: { ...resolved.limits },
  };
}

/**
 * Reconstructs a ResolvedCapabilities from its serialized form.
 */
export function deserializeResolvedCapabilities(
  serialized: SerializedResolvedCapabilities,
): ResolvedCapabilities {
  return {
    capabilities: new Set(serialized.capabilities),
    limits: { ...serialized.limits },
  };
}

/**
 * Returns whether the serialized capability array includes the given capability.
 */
export function hasSerializedCapability(
  serialized: SerializedResolvedCapabilities,
  cap: AtlasCapability,
): boolean {
  return serialized.capabilities.includes(cap);
}

/**
 * Returns the limit value from the serialized limits map.
 * null means the limit is unbounded.
 */
export function getSerializedLimit(
  serialized: SerializedResolvedCapabilities,
  limit: AtlasLimit,
): number | null {
  return serialized.limits[limit];
}
