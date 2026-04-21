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
    description:
      "The Atlas plan for people doing a short-term research project that can fit in a month.",
    envProductKey: "STRIPE_PRODUCT_ATLAS_RESEARCH_PASS",
    action: "keep",
    existingProductId: "prod_UMkuPoP6VUIIyT",
    prices: [
      {
        id: "research-pass-once",
        envKey: "STRIPE_PRICE_ATLAS_RESEARCH_PASS_ONCE",
        unitAmountCents: 900,
        currency: "usd",
      },
      {
        id: "research-pass-weekly",
        envKey: "STRIPE_PRICE_ATLAS_RESEARCH_PASS_WEEKLY",
        unitAmountCents: 400,
        currency: "usd",
      },
    ],
  },
  {
    id: "pro",
    stripeName: "Atlas Pro",
    description:
      "Professional workspace for individual researchers with unlimited research runs, exports, and API access.",
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
    description:
      "Shared workspace for newsrooms, nonprofits, and research teams.",
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
  {
    id: "independent-journalist-pro",
    stripeName: "Atlas Pro (Independent Journalist)",
    description: "Discounted Pro tier for independent journalists — 50% off",
    envProductKey: "STRIPE_PRODUCT_INDEPENDENT_JOURNALIST_PRO",
    action: "create",
    prices: [
      {
        id: "independent-journalist-pro-monthly",
        envKey: "STRIPE_PRICE_INDEPENDENT_JOURNALIST_PRO_MONTHLY",
        unitAmountCents: 250, // $2.50 = 50% of $5
        currency: "usd",
        recurring: { interval: "month" },
      },
      {
        id: "independent-journalist-pro-yearly",
        envKey: "STRIPE_PRICE_INDEPENDENT_JOURNALIST_PRO_YEARLY",
        unitAmountCents: 2400, // $24 = 50% of $48
        currency: "usd",
        recurring: { interval: "year" },
      },
    ],
  },
  {
    id: "independent-journalist-team",
    stripeName: "Atlas Team (Independent Journalist)",
    description: "Discounted Team tier for independent journalists — 50% off",
    envProductKey: "STRIPE_PRODUCT_INDEPENDENT_JOURNALIST_TEAM",
    action: "create",
    prices: [
      {
        id: "independent-journalist-team-monthly",
        envKey: "STRIPE_PRICE_INDEPENDENT_JOURNALIST_TEAM_MONTHLY",
        unitAmountCents: 1250, // $12.50 base = 50% of $25
        currency: "usd",
        recurring: { interval: "month" },
      },
      {
        id: "independent-journalist-team-yearly",
        envKey: "STRIPE_PRICE_INDEPENDENT_JOURNALIST_TEAM_YEARLY",
        unitAmountCents: 12500, // $125 base = 50% of $250
        currency: "usd",
        recurring: { interval: "year" },
      },
    ],
  },
  {
    id: "grassroots-nonprofit-team",
    stripeName: "Atlas Team (Grassroots Nonprofit)",
    description: "Discounted Team tier for nonprofits <$2M — 40% off",
    envProductKey: "STRIPE_PRODUCT_GRASSROOTS_NONPROFIT_TEAM",
    action: "create",
    prices: [
      {
        id: "grassroots-nonprofit-team-monthly",
        envKey: "STRIPE_PRICE_GRASSROOTS_NONPROFIT_TEAM_MONTHLY",
        unitAmountCents: 1500, // $15 base = 40% of $25
        currency: "usd",
        recurring: { interval: "month" },
      },
      {
        id: "grassroots-nonprofit-team-yearly",
        envKey: "STRIPE_PRICE_GRASSROOTS_NONPROFIT_TEAM_YEARLY",
        unitAmountCents: 15000, // $150 base = 40% of $250
        currency: "usd",
        recurring: { interval: "year" },
      },
    ],
  },
  {
    id: "civic-tech-pro",
    stripeName: "Atlas Pro (Civic Tech Worker)",
    description: "Discounted Pro tier for civic tech workers — 50% off",
    envProductKey: "STRIPE_PRODUCT_CIVIC_TECH_PRO",
    action: "create",
    prices: [
      {
        id: "civic-tech-pro-monthly",
        envKey: "STRIPE_PRICE_CIVIC_TECH_PRO_MONTHLY",
        unitAmountCents: 250, // $2.50 = 50% of $5
        currency: "usd",
        recurring: { interval: "month" },
      },
      {
        id: "civic-tech-pro-yearly",
        envKey: "STRIPE_PRICE_CIVIC_TECH_PRO_YEARLY",
        unitAmountCents: 2400, // $24 = 50% of $48
        currency: "usd",
        recurring: { interval: "year" },
      },
    ],
  },
  {
    id: "civic-tech-team",
    stripeName: "Atlas Team (Civic Tech Worker)",
    description: "Discounted Team tier for civic tech workers — 50% off",
    envProductKey: "STRIPE_PRODUCT_CIVIC_TECH_TEAM",
    action: "create",
    prices: [
      {
        id: "civic-tech-team-monthly",
        envKey: "STRIPE_PRICE_CIVIC_TECH_TEAM_MONTHLY",
        unitAmountCents: 1250, // $12.50 base = 50% of $25
        currency: "usd",
        recurring: { interval: "month" },
      },
      {
        id: "civic-tech-team-yearly",
        envKey: "STRIPE_PRICE_CIVIC_TECH_TEAM_YEARLY",
        unitAmountCents: 12500, // $125 base = 50% of $250
        currency: "usd",
        recurring: { interval: "year" },
      },
    ],
  },
];
