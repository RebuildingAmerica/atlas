import type Stripe from "stripe";
import type {
  AtlasCouponDefinition,
  AtlasPriceDefinition,
  AtlasProductDefinition,
} from "../../config/products.js";
import { STRIPE_BILLING_WEBHOOK_EVENTS } from "../../config/products.js";

export interface StripeWebhookEndpointResult {
  endpoint: Stripe.WebhookEndpoint;
  secret: string | null;
}

/**
 * Find an existing product by its `metadata.atlas_product_id`, or create a new
 * one. This operation is idempotent -- calling it multiple times with the same
 * definition will not create duplicates.
 */
export async function ensureProduct(
  stripe: Stripe,
  definition: AtlasProductDefinition,
): Promise<Stripe.Product> {
  const existing = await stripe.products.search({
    query: `metadata["atlas_product_id"]:"${definition.id}"`,
  });

  const [existingProduct] = existing.data;
  if (existingProduct) {
    return updateProductMetadata(stripe, existingProduct, definition);
  }

  const matchingName = await findActiveProductByName(
    stripe,
    definition.stripeName,
  );
  if (matchingName) {
    return updateProductMetadata(stripe, matchingName, definition);
  }

  const product = await stripe.products.create({
    name: definition.stripeName,
    description: definition.description,
    metadata: {
      atlas_product_id: definition.id,
    },
  });

  return product;
}

async function findActiveProductByName(
  stripe: Stripe,
  name: string,
): Promise<Stripe.Product | null> {
  for await (const product of stripe.products.list({
    active: true,
    limit: 100,
  })) {
    if (product.name === name) {
      return product;
    }
  }
  return null;
}

async function updateProductMetadata(
  stripe: Stripe,
  product: Stripe.Product,
  definition: AtlasProductDefinition,
): Promise<Stripe.Product> {
  if (
    product.metadata?.atlas_product_id === definition.id &&
    product.description === definition.description
  ) {
    return product;
  }

  return stripe.products.update(product.id, {
    description: definition.description,
    metadata: {
      ...product.metadata,
      atlas_product_id: definition.id,
    },
  });
}

/**
 * Find an existing price on the current Stripe product by
 * `metadata.atlas_price_id`, or create a new one attached to the product.
 * Stripe Search is eventually consistent after metadata repair, so this uses
 * the product's price list as the source of truth.
 */
export async function ensurePrice(
  stripe: Stripe,
  productId: string,
  priceDef: AtlasPriceDefinition,
): Promise<Stripe.Price> {
  const existingPrices = await fetchExistingPrices(stripe, productId);
  const catalogPrices = existingPrices.filter(
    (price) => price.metadata.atlas_price_id === priceDef.id,
  );
  const matchingPrices = catalogPrices
    .filter((price) => priceMatchesDefinition(price, priceDef))
    .sort(compareCanonicalPrices);
  const [canonicalPrice] = matchingPrices;

  if (canonicalPrice) {
    const duplicatePrices = catalogPrices.filter(
      (price) => price.id !== canonicalPrice.id,
    );
    await Promise.all(
      duplicatePrices.map((price) => retireCatalogPrice(stripe, price)),
    );
    if (canonicalPrice.active) {
      return canonicalPrice;
    }
    return stripe.prices.update(canonicalPrice.id, { active: true });
  }

  if (catalogPrices.length > 0) {
    await Promise.all(
      catalogPrices.map((price) => retireCatalogPrice(stripe, price)),
    );
  }

  const price = await stripe.prices.create(
    buildPriceCreateParams(productId, priceDef),
  );
  return price;
}

function buildPriceCreateParams(
  productId: string,
  priceDef: AtlasPriceDefinition,
): Stripe.PriceCreateParams {
  const params: Stripe.PriceCreateParams = {
    product: productId,
    unit_amount: priceDef.unitAmountCents,
    currency: priceDef.currency,
    metadata: {
      atlas_price_id: priceDef.id,
    },
  };

  if (priceDef.recurring) {
    params.recurring = {
      interval: priceDef.recurring.interval,
      usage_type: priceDef.recurring.usageType ?? "licensed",
    };
    if (priceDef.recurring.intervalCount !== undefined) {
      params.recurring.interval_count = priceDef.recurring.intervalCount;
    }
  }

  return params;
}

function compareCanonicalPrices(
  left: Stripe.Price,
  right: Stripe.Price,
): number {
  if (left.active !== right.active) {
    return left.active ? -1 : 1;
  }
  return right.created - left.created;
}

async function retireCatalogPrice(
  stripe: Stripe,
  price: Stripe.Price,
): Promise<void> {
  await stripe.prices.update(price.id, {
    active: false,
    metadata: {
      ...price.metadata,
      atlas_price_id: "",
      atlas_replaced_price_id: price.metadata.atlas_price_id ?? price.id,
    },
  });
}

function priceMatchesDefinition(
  price: Stripe.Price,
  priceDef: AtlasPriceDefinition,
): boolean {
  const recurringInterval = price.recurring?.interval ?? undefined;
  const recurringIntervalCount = price.recurring?.interval_count ?? undefined;
  const expectedIntervalCount = priceDef.recurring
    ? (priceDef.recurring.intervalCount ?? 1)
    : undefined;
  return (
    price.unit_amount === priceDef.unitAmountCents &&
    price.currency === priceDef.currency &&
    recurringInterval === priceDef.recurring?.interval &&
    recurringIntervalCount === expectedIntervalCount
  );
}

/**
 * Find or create the Stripe coupon Atlas uses for verified discount segments.
 */
export async function ensureCoupon(
  stripe: Stripe,
  definition: AtlasCouponDefinition,
  productIds: readonly string[],
): Promise<Stripe.Coupon> {
  try {
    const existing = await stripe.coupons.retrieve(definition.id, {
      expand: ["applies_to"],
    });
    if (existing.deleted) {
      throw new Error(`Stripe coupon ${definition.id} was deleted.`);
    }
    if (
      existing.percent_off !== definition.percentOff ||
      existing.duration !== "forever" ||
      !couponAppliesToProducts(existing, productIds)
    ) {
      throw new Error(
        `Stripe coupon ${definition.id} exists but does not match the Atlas discount catalog.`,
      );
    }
    if (
      existing.name === definition.name &&
      existing.metadata?.atlas_discount_segment === definition.segment
    ) {
      return existing;
    }
    return await stripe.coupons.update(existing.id, {
      name: definition.name,
      metadata: {
        ...existing.metadata,
        atlas_discount_segment: definition.segment,
        atlas_applies_to_products: productIds.join(","),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("No such coupon")) {
      throw error;
    }
  }

  return stripe.coupons.create({
    id: definition.id,
    name: definition.name,
    percent_off: definition.percentOff,
    duration: "forever",
    applies_to: { products: [...productIds] },
    metadata: {
      atlas_discount_segment: definition.segment,
      atlas_applies_to_products: productIds.join(","),
    },
  });
}

function couponAppliesToProducts(
  coupon: Stripe.Coupon,
  productIds: readonly string[],
): boolean {
  const actualProducts = [...(coupon.applies_to?.products ?? [])].sort();
  const expectedProducts = [...productIds].sort();
  return (
    actualProducts.length === expectedProducts.length &&
    actualProducts.every(
      (productId, index) => productId === expectedProducts[index],
    )
  );
}

/**
 * Ensure the hosted Stripe billing webhook endpoint exists for the target app
 * URL. Stripe only returns the signing secret when an endpoint is created.
 */
export async function ensureBillingWebhookEndpoint(
  stripe: Stripe,
  webhookUrl: string,
): Promise<StripeWebhookEndpointResult> {
  const existing = await findWebhookEndpointByUrl(stripe, webhookUrl);
  if (existing) {
    const endpoint = await stripe.webhookEndpoints.update(existing.id, {
      enabled_events: STRIPE_BILLING_WEBHOOK_EVENTS,
      metadata: {
        ...existing.metadata,
        atlas_webhook: "billing",
      },
    });
    return { endpoint, secret: null };
  }

  const endpoint = await stripe.webhookEndpoints.create({
    url: webhookUrl,
    enabled_events: STRIPE_BILLING_WEBHOOK_EVENTS,
    metadata: {
      atlas_webhook: "billing",
    },
  });

  return { endpoint, secret: endpoint.secret ?? null };
}

async function findWebhookEndpointByUrl(
  stripe: Stripe,
  webhookUrl: string,
): Promise<Stripe.WebhookEndpoint | null> {
  for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
    if (endpoint.url === webhookUrl && endpoint.status !== "disabled") {
      return endpoint;
    }
  }
  return null;
}

/**
 * Archive (deactivate) a Stripe product by setting `active` to `false`.
 */
export async function archiveProduct(
  stripe: Stripe,
  productId: string,
): Promise<Stripe.Product> {
  const product = await stripe.products.update(productId, {
    active: false,
  });
  return product;
}

/**
 * Fetch all prices for a given product.
 */
export async function fetchExistingPrices(
  stripe: Stripe,
  productId: string,
): Promise<Stripe.Price[]> {
  const prices: Stripe.Price[] = [];
  for await (const price of stripe.prices.list({ product: productId })) {
    prices.push(price);
  }
  return prices;
}
