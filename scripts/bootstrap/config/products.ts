export interface AtlasPriceDefinition {
  readonly id: string;
  readonly envKey: string;
  readonly unitAmountCents: number;
  readonly currency: "usd";
  readonly recurring?: {
    readonly interval: "month" | "year" | "week";
    readonly usageType?: "metered" | "licensed";
  };
}

export interface AtlasProductDefinition {
  readonly id: string;
  readonly stripeName: string;
  readonly description: string;
  readonly envProductKey: string;
  readonly prices: readonly AtlasPriceDefinition[];
  readonly action: "create" | "keep" | "archive";
  readonly existingProductId?: string;
  readonly perUnit?: boolean;
}

export const ATLAS_PRODUCTS: AtlasProductDefinition[] = [
  {
    id: "research-pass",
    stripeName: "Atlas Research Pass",
    description: "The Atlas plan for people doing a short-term research project that can fit in a month.",
    envProductKey: "STRIPE_PRODUCT_ATLAS_RESEARCH_PASS",
    action: "keep",
    existingProductId: "prod_UMkuPoP6VUIIyT",
    prices: [
      {
        id: "research-pass-once",
        envKey: "STRIPE_PRICE_ATLAS_RESEARCH_PASS_ONCE",
        unitAmountCents: 5000,
        currency: "usd",
      },
      {
        id: "research-pass-weekly",
        envKey: "STRIPE_PRICE_ATLAS_RESEARCH_PASS_WEEKLY",
        unitAmountCents: 1200,
        currency: "usd",
        recurring: { interval: "week" },
      },
    ],
  },
  {
    id: "pro",
    stripeName: "Atlas Pro",
    description: "Professional workspace for individual researchers with unlimited research runs, exports, and API access.",
    envProductKey: "STRIPE_PRODUCT_ATLAS_PRO",
    action: "create",
    prices: [
      {
        id: "pro-monthly",
        envKey: "STRIPE_PRICE_ATLAS_PRO_MONTHLY",
        unitAmountCents: 500,
        currency: "usd",
        recurring: { interval: "month" },
      },
      {
        id: "pro-yearly",
        envKey: "STRIPE_PRICE_ATLAS_PRO_YEARLY",
        unitAmountCents: 4800,
        currency: "usd",
        recurring: { interval: "year" },
      },
    ],
  },
  {
    id: "team-base",
    stripeName: "Atlas Team",
    description: "Shared workspace for newsrooms, nonprofits, and research teams.",
    envProductKey: "STRIPE_PRODUCT_ATLAS_TEAM_BASE",
    action: "create",
    prices: [
      {
        id: "team-base-monthly",
        envKey: "STRIPE_PRICE_ATLAS_TEAM_BASE_MONTHLY",
        unitAmountCents: 2500,
        currency: "usd",
        recurring: { interval: "month" },
      },
      {
        id: "team-base-yearly",
        envKey: "STRIPE_PRICE_ATLAS_TEAM_BASE_YEARLY",
        unitAmountCents: 25000,
        currency: "usd",
        recurring: { interval: "year" },
      },
    ],
  },
  {
    id: "team-seat",
    stripeName: "Atlas Team Seat",
    description: "Per-member seat for Atlas Team workspaces.",
    envProductKey: "STRIPE_PRODUCT_ATLAS_TEAM_SEAT",
    action: "create",
    perUnit: true,
    prices: [
      {
        id: "team-seat-monthly",
        envKey: "STRIPE_PRICE_ATLAS_TEAM_SEAT_MONTHLY",
        unitAmountCents: 800,
        currency: "usd",
        recurring: { interval: "month" },
      },
      {
        id: "team-seat-yearly",
        envKey: "STRIPE_PRICE_ATLAS_TEAM_SEAT_YEARLY",
        unitAmountCents: 8000,
        currency: "usd",
        recurring: { interval: "year" },
      },
    ],
  },
  {
    id: "team-legacy",
    stripeName: "Atlas Team",
    description: "Legacy team product — to be archived.",
    envProductKey: "",
    action: "archive",
    existingProductId: "prod_UMku0d4n2sHTkm",
    prices: [],
  },
];
