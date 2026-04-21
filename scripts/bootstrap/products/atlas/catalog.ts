import type Stripe from "stripe";
import type {
  AtlasPriceDefinition,
  AtlasProductDefinition,
} from "../../config/products.js";

/**
 * Find an existing product by its `metadata.atlas_product_id`, or create a new
 * one. This operation is idempotent -- calling it multiple times with the same
 * definition will not create duplicates.
 */
export async function ensureProduct(
  stripe: Stripe,
  definition: AtlasProductDefinition,
): Promise<Stripe.Product> {
  // Search for existing product by metadata
  const existing = await stripe.products.search({
    query: `metadata["atlas_product_id"]:"${definition.id}"`,
  });

  if (existing.data.length > 0) {
    return existing.data[0];
  }

  // Create new product
  const product = await stripe.products.create({
    name: definition.stripeName,
    description: definition.description,
    metadata: {
      atlas_product_id: definition.id,
    },
  });

  return product;
}

/**
 * Find an existing price by its `metadata.atlas_price_id`, or create a new one
 * attached to the given product. Idempotent -- calling multiple times with the
 * same price definition will not create duplicates.
 */
export async function ensurePrice(
  stripe: Stripe,
  productId: string,
  priceDef: AtlasPriceDefinition,
): Promise<Stripe.Price> {
  // Search for existing price by metadata
  const existing = await stripe.prices.search({
    query: `metadata["atlas_price_id"]:"${priceDef.id}"`,
  });

  if (existing.data.length > 0) {
    return existing.data[0];
  }

  // Build the price creation params
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
  }

  const price = await stripe.prices.create(params);
  return price;
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
