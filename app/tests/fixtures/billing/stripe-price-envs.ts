export interface StripeAtlasCatalogFixture {
  coupons: {
    civic_tech_worker: string;
    grassroots_nonprofit: string;
    independent_journalist: string;
    student: string;
  };
  prices: {
    "pro-monthly": string;
    "pro-student-four-month": string;
    "pro-yearly": string;
    "research-pass-once": string;
    "research-pass-weekly": string;
    "team-base-monthly": string;
    "team-base-yearly": string;
    "team-seat-monthly": string;
    "team-seat-yearly": string;
  };
  products: {
    pro: string;
    "research-pass": string;
    "team-base": string;
    "team-seat": string;
  };
}

export interface StripeAtlasCatalogFixtureOverrides {
  coupons?: Partial<StripeAtlasCatalogFixture["coupons"]>;
  prices?: Partial<StripeAtlasCatalogFixture["prices"]>;
  products?: Partial<StripeAtlasCatalogFixture["products"]>;
}

export const STRIPE_ATLAS_CATALOG_ENV_KEY = "STRIPE_ATLAS_CATALOG";

export const STRIPE_ATLAS_CATALOG_FIXTURE: StripeAtlasCatalogFixture = {
  coupons: {
    civic_tech_worker: "coupon_civic_tech",
    grassroots_nonprofit: "coupon_nonprofit",
    independent_journalist: "coupon_journalist",
    student: "coupon_student",
  },
  prices: {
    "pro-monthly": "price_pro_monthly",
    "pro-student-four-month": "price_pro_student_four_month",
    "pro-yearly": "price_pro_yearly",
    "research-pass-once": "price_pass_once",
    "research-pass-weekly": "price_pass_weekly",
    "team-base-monthly": "price_team_monthly",
    "team-base-yearly": "price_team_yearly",
    "team-seat-monthly": "price_team_seat_monthly",
    "team-seat-yearly": "price_team_seat_yearly",
  },
  products: {
    pro: "prod_pro",
    "research-pass": "prod_research_pass",
    "team-base": "prod_team_base",
    "team-seat": "prod_team_seat",
  },
};

export function createStripeAtlasCatalogFixture(
  overrides: StripeAtlasCatalogFixtureOverrides = {},
): string {
  return JSON.stringify({
    coupons: {
      ...STRIPE_ATLAS_CATALOG_FIXTURE.coupons,
      ...overrides.coupons,
    },
    prices: {
      ...STRIPE_ATLAS_CATALOG_FIXTURE.prices,
      ...overrides.prices,
    },
    products: {
      ...STRIPE_ATLAS_CATALOG_FIXTURE.products,
      ...overrides.products,
    },
  });
}
