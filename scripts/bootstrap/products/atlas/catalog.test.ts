import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type Stripe from "stripe";
import type {
  AtlasCouponDefinition,
  AtlasPriceDefinition,
} from "../../config/products.js";
import {
  ensureCoupon,
  ensureDefaultProductPrice,
  ensurePrice,
  retireNonCatalogPrices,
} from "./catalog.js";

interface CouponRetrieveCall {
  id: string;
  params: Stripe.CouponRetrieveParams | undefined;
}

interface FakeCouponResource {
  create(params: Stripe.CouponCreateParams): Promise<Stripe.Coupon>;
  retrieve(
    id: string,
    params?: Stripe.CouponRetrieveParams,
  ): Promise<Stripe.Coupon>;
  update(id: string, params: Stripe.CouponUpdateParams): Promise<Stripe.Coupon>;
}

interface FakeStripe {
  coupons: FakeCouponResource;
}

interface FakePriceResource {
  create(params: Stripe.PriceCreateParams): Promise<Stripe.Price>;
  list(params: Stripe.PriceListParams): AsyncIterable<Stripe.Price>;
  update(id: string, params: Stripe.PriceUpdateParams): Promise<Stripe.Price>;
}

interface FakeStripeWithPrices {
  prices: FakePriceResource;
}

interface FakeStripeWithProducts {
  products: {
    update(
      id: string,
      params: Stripe.ProductUpdateParams,
    ): Promise<Stripe.Product>;
  };
}

interface StripePriceOverrides {
  active?: boolean;
  id?: string;
  metadata?: Stripe.Metadata;
  recurring?: Stripe.Price.Recurring | null;
  unitAmount?: number;
}

interface PriceUpdateCall {
  id: string;
  params: Stripe.PriceUpdateParams;
}

interface ProductUpdateCall {
  id: string;
  params: Stripe.ProductUpdateParams;
}

const STUDENT_COUPON: AtlasCouponDefinition = {
  id: "atlas-pro-student-20",
  name: "Atlas Student Discount",
  envKey: "STRIPE_COUPON_STUDENT",
  percentOff: 20,
  segment: "student",
  appliesToProductIds: ["pro"],
};

function stripeCoupon(): Stripe.Coupon {
  return {
    amount_off: null,
    applies_to: { products: ["prod_pro"] },
    created: 1,
    currency: null,
    duration: "forever",
    duration_in_months: null,
    id: STUDENT_COUPON.id,
    livemode: false,
    max_redemptions: null,
    metadata: { atlas_discount_segment: "student" },
    name: STUDENT_COUPON.name,
    object: "coupon",
    percent_off: 20,
    redeem_by: null,
    times_redeemed: 0,
    valid: true,
  };
}

const PRO_MONTHLY_PRICE: AtlasPriceDefinition = {
  id: "pro-monthly",
  envKey: "STRIPE_PRICE_ATLAS_PRO_MONTHLY",
  unitAmountCents: 500,
  currency: "usd",
  recurring: { interval: "month" },
};

function stripePrice(overrides: StripePriceOverrides = {}): Stripe.Price {
  return {
    active: overrides.active ?? true,
    billing_scheme: "per_unit",
    created: 1,
    currency: "usd",
    custom_unit_amount: null,
    id: overrides.id ?? "price_existing",
    livemode: false,
    lookup_key: null,
    metadata: overrides.metadata ?? {
      atlas_price_id: PRO_MONTHLY_PRICE.id,
    },
    nickname: null,
    object: "price",
    product: "prod_research",
    recurring: overrides.recurring ?? null,
    tax_behavior: "unspecified",
    tiers_mode: null,
    transform_quantity: null,
    type: overrides.recurring ? "recurring" : "one_time",
    unit_amount: overrides.unitAmount ?? 400,
    unit_amount_decimal: String(overrides.unitAmount ?? 400),
  };
}

function stripeProduct(
  defaultPrice: string | Stripe.Price | null,
): Stripe.Product {
  return {
    active: true,
    attributes: [],
    created: 1,
    default_price: defaultPrice,
    description: "Professional workspace",
    id: "prod_pro",
    images: [],
    livemode: false,
    marketing_features: [],
    metadata: { atlas_product_id: "pro" },
    name: "Atlas Pro",
    object: "product",
    package_dimensions: null,
    shippable: null,
    statement_descriptor: null,
    tax_code: null,
    type: "service",
    unit_label: null,
    updated: 1,
    url: null,
  };
}

async function* stripePriceList(
  prices: Stripe.Price[],
): AsyncIterable<Stripe.Price> {
  await Promise.resolve();
  for (const price of prices) {
    yield price;
  }
}

void describe("Stripe Atlas catalog helpers", () => {
  void it("expands coupon product scope before verifying existing discounts", async () => {
    const retrieveCalls: CouponRetrieveCall[] = [];
    const fakeStripe: FakeStripe = {
      coupons: {
        create: () =>
          Promise.reject(
            new Error("create should not be called for matching coupon"),
          ),
        retrieve: (id, params) => {
          retrieveCalls.push({ id, params });
          return Promise.resolve(stripeCoupon());
        },
        update: () =>
          Promise.reject(
            new Error("update should not be called for matching coupon"),
          ),
      },
    };

    const coupon = await ensureCoupon(
      fakeStripe as unknown as Stripe,
      STUDENT_COUPON,
      ["prod_pro"],
    );

    assert.equal(coupon.id, STUDENT_COUPON.id);
    assert.deepEqual(retrieveCalls, [
      { id: STUDENT_COUPON.id, params: { expand: ["applies_to"] } },
    ]);
  });

  void it("replaces catalog-tagged prices that no longer match the definition", async () => {
    const existingPrice = stripePrice({ unitAmount: 500 });
    const replacementPrice = stripePrice({
      id: "price_replacement",
      recurring: {
        aggregate_usage: null,
        interval: "month",
        interval_count: 1,
        meter: null,
        trial_period_days: null,
        usage_type: "licensed",
      },
      unitAmount: 500,
    });
    const updateCalls: PriceUpdateCall[] = [];
    const createCalls: Stripe.PriceCreateParams[] = [];
    const fakeStripe: FakeStripeWithPrices = {
      prices: {
        create: (params) => {
          createCalls.push(params);
          return Promise.resolve(replacementPrice);
        },
        list: () => stripePriceList([existingPrice]),
        update: (id, params) => {
          updateCalls.push({ id, params });
          return Promise.resolve(stripePrice({ id, active: false }));
        },
      },
    };

    const price = await ensurePrice(
      fakeStripe as unknown as Stripe,
      "prod_pro",
      PRO_MONTHLY_PRICE,
    );

    assert.equal(price.id, "price_replacement");
    assert.deepEqual(updateCalls, [
      {
        id: "price_existing",
        params: {
          active: false,
          metadata: {
            atlas_price_id: "",
            atlas_replaced_price_id: PRO_MONTHLY_PRICE.id,
          },
        },
      },
    ]);
    assert.deepEqual(createCalls, [
      {
        product: "prod_pro",
        unit_amount: 500,
        currency: "usd",
        metadata: {
          atlas_price_id: PRO_MONTHLY_PRICE.id,
        },
        recurring: {
          interval: "month",
          usage_type: "licensed",
        },
      },
    ]);
  });

  void it("retires active non-catalog prices on canonical products", async () => {
    const canonicalPrice = stripePrice({
      id: "price_canonical",
      metadata: { atlas_price_id: PRO_MONTHLY_PRICE.id },
      recurring: {
        aggregate_usage: null,
        interval: "month",
        interval_count: 1,
        meter: null,
        trial_period_days: null,
        usage_type: "licensed",
      },
      unitAmount: 500,
    });
    const legacyPrice = stripePrice({
      id: "price_legacy",
      metadata: {},
      unitAmount: 10000,
    });
    const inactiveLegacyPrice = stripePrice({
      active: false,
      id: "price_inactive_legacy",
      metadata: {},
      unitAmount: 5000,
    });
    const updateCalls: PriceUpdateCall[] = [];
    const fakeStripe: FakeStripeWithPrices = {
      prices: {
        create: () => Promise.reject(new Error("create should not be called")),
        list: () =>
          stripePriceList([canonicalPrice, legacyPrice, inactiveLegacyPrice]),
        update: (id, params) => {
          updateCalls.push({ id, params });
          return Promise.resolve(stripePrice({ id, active: false }));
        },
      },
    };

    const retiredPrices = await retireNonCatalogPrices(
      fakeStripe as unknown as Stripe,
      "prod_pro",
      ["price_canonical"],
    );

    assert.equal(retiredPrices.length, 1);
    assert.deepEqual(updateCalls, [
      {
        id: "price_legacy",
        params: {
          active: false,
          metadata: {
            atlas_archived_by: "atlas_catalog_sync",
            atlas_archived_reason: "non_catalog_price",
          },
        },
      },
    ]);
  });

  void it("keeps product defaults pointed at the primary canonical price", async () => {
    const updateCalls: ProductUpdateCall[] = [];
    const fakeStripe: FakeStripeWithProducts = {
      products: {
        update: (id, params) => {
          updateCalls.push({ id, params });
          return Promise.resolve(stripeProduct("price_canonical"));
        },
      },
    };

    const updated = await ensureDefaultProductPrice(
      fakeStripe as unknown as Stripe,
      stripeProduct("price_legacy"),
      "price_canonical",
    );

    assert.equal(updated.default_price, "price_canonical");
    assert.deepEqual(updateCalls, [
      {
        id: "prod_pro",
        params: { default_price: "price_canonical" },
      },
    ]);
  });
});
