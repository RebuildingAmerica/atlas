/**
 * Checks a Stripe catalog snapshot against the products Atlas sells.
 *
 * These are pure comparisons with no network or file access, which is what
 * lets the verify command and its tests share them.
 */

import { hasVercelEnvKey } from "../../lib/vercel-env.js";
import { ATLAS_COUPONS, ATLAS_PRODUCTS } from "../../config/products.js";
import {
  STRIPE_ATLAS_CATALOG_ENV_KEY,
  STRIPE_ENV_KEYS,
  expandStripeCatalogEnv,
} from "./env.js";
import type { StripeBootstrapTarget } from "./env.js";
import type { VercelEnvKey } from "../../lib/vercel.js";
import type {
  AtlasCouponDefinition,
  AtlasPriceDefinition,
  AtlasProductDefinition,
} from "../../config/products.js";
import type {
  StripeCatalogSnapshot,
  StripeCatalogVerificationIssue,
  StripeCatalogVerificationOptions,
  StripePriceSnapshot,
} from "./verify-types.js";
import { issue, sameStringSet } from "./verify-issue.js";
import {
  expectedWebhookUrlForEnv,
  verifyBillingWebhook,
} from "./verify-webhook.js";

interface PriceExpectation {
  price: AtlasPriceDefinition;
  product: AtlasProductDefinition;
}

interface CouponExpectation {
  coupon: AtlasCouponDefinition;
  productIds: readonly string[];
}

export function verifyStripeCatalogSnapshot(
  env: Map<string, string>,
  snapshot: StripeCatalogSnapshot,
  options: StripeCatalogVerificationOptions = {},
): StripeCatalogVerificationIssue[] {
  const issues: StripeCatalogVerificationIssue[] = [];
  const missingEnvKeys = new Set<string>();
  let expandedEnv: Map<string, string>;

  for (const key of STRIPE_ENV_KEYS) {
    if (
      key === "STRIPE_WEBHOOK_SECRET" &&
      options.requireWebhookSecret === false
    ) {
      continue;
    }
    if (!env.get(key)?.trim()) {
      missingEnvKeys.add(key);
      issues.push(issue("missing_env", key, `${key} is missing.`));
    }
  }

  try {
    expandedEnv = expandStripeCatalogEnv(env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push(
      issue("invalid_catalog", STRIPE_ATLAS_CATALOG_ENV_KEY, message),
    );
    return issues;
  }

  if (missingEnvKeys.has(STRIPE_ATLAS_CATALOG_ENV_KEY)) {
    return issues;
  }

  collectMissingCatalogEntries(expandedEnv, missingEnvKeys, issues);
  verifyProducts(expandedEnv, snapshot, missingEnvKeys, issues);
  verifyPrices(expandedEnv, snapshot, missingEnvKeys, issues);
  verifyCoupons(expandedEnv, snapshot, missingEnvKeys, issues);
  verifyBillingWebhook(snapshot, options.expectedWebhookUrl, issues);
  return issues;
}

export function verifyStripeTargetSnapshot(
  env: Map<string, string>,
  snapshot: StripeCatalogSnapshot,
  target: StripeBootstrapTarget,
): StripeCatalogVerificationIssue[] {
  const issues: StripeCatalogVerificationIssue[] = [];
  const expectedWebhookUrl = expectedWebhookUrlForEnv(env, target, issues);
  issues.push(
    ...verifyStripeCatalogSnapshot(env, snapshot, { expectedWebhookUrl }),
  );
  return issues;
}

export function verifyHostedStripeEnvKeys(
  target: Exclude<StripeBootstrapTarget, "local">,
  existingKeys: readonly VercelEnvKey[],
): StripeCatalogVerificationIssue[] {
  const environment = target === "prod" ? "production" : "preview";
  return STRIPE_ENV_KEYS.flatMap((envKey) => {
    if (hasVercelEnvKey(existingKeys, envKey, environment)) {
      return [];
    }
    return [
      issue(
        "missing_hosted_env",
        envKey,
        `Vercel ${environment} is missing ${envKey}.`,
      ),
    ];
  });
}

function collectMissingCatalogEntries(
  env: Map<string, string>,
  missingEnvKeys: Set<string>,
  issues: StripeCatalogVerificationIssue[],
): void {
  for (const product of ATLAS_PRODUCTS) {
    if (!env.get(product.envProductKey)?.trim()) {
      missingEnvKeys.add(product.envProductKey);
      issues.push(
        issue(
          "missing_env",
          STRIPE_ATLAS_CATALOG_ENV_KEY,
          `${STRIPE_ATLAS_CATALOG_ENV_KEY}.products.${product.id} is missing.`,
        ),
      );
    }
    for (const price of product.prices) {
      if (!env.get(price.envKey)?.trim()) {
        missingEnvKeys.add(price.envKey);
        issues.push(
          issue(
            "missing_env",
            STRIPE_ATLAS_CATALOG_ENV_KEY,
            `${STRIPE_ATLAS_CATALOG_ENV_KEY}.prices.${price.id} is missing.`,
          ),
        );
      }
    }
  }

  for (const coupon of ATLAS_COUPONS) {
    if (!env.get(coupon.envKey)?.trim()) {
      missingEnvKeys.add(coupon.envKey);
      issues.push(
        issue(
          "missing_env",
          STRIPE_ATLAS_CATALOG_ENV_KEY,
          `${STRIPE_ATLAS_CATALOG_ENV_KEY}.coupons.${coupon.segment} is missing.`,
        ),
      );
    }
  }
}

function verifyProducts(
  env: Map<string, string>,
  snapshot: StripeCatalogSnapshot,
  missingEnvKeys: Set<string>,
  issues: StripeCatalogVerificationIssue[],
): void {
  for (const product of ATLAS_PRODUCTS) {
    const envKey = product.envProductKey;
    if (missingEnvKeys.has(envKey)) {
      continue;
    }
    const productId = env.get(envKey)?.trim() ?? "";
    const actual = snapshot.products.get(envKey);
    if (!actual) {
      issues.push(
        issue(
          "missing_product",
          envKey,
          `${envKey} did not resolve to a Stripe product.`,
        ),
      );
      continue;
    }
    if (actual.id !== productId) {
      issues.push(
        issue(
          "product_id_mismatch",
          envKey,
          `${envKey} resolved to ${actual.id}, not ${productId}.`,
        ),
      );
    }
    if (!actual.active) {
      issues.push(
        issue(
          "product_inactive",
          envKey,
          `${envKey} points at an inactive Stripe product.`,
        ),
      );
    }
    if (actual.metadata.atlas_product_id !== product.id) {
      issues.push(
        issue(
          "product_metadata_mismatch",
          envKey,
          `${envKey} is missing atlas_product_id=${product.id}.`,
        ),
      );
    }
  }
}

function verifyPrices(
  env: Map<string, string>,
  snapshot: StripeCatalogSnapshot,
  missingEnvKeys: Set<string>,
  issues: StripeCatalogVerificationIssue[],
): void {
  for (const expectation of priceExpectations()) {
    const { price, product } = expectation;
    if (missingEnvKeys.has(price.envKey)) {
      continue;
    }
    const priceId = env.get(price.envKey)?.trim() ?? "";
    const productId = env.get(product.envProductKey)?.trim() ?? "";
    const actual = snapshot.prices.get(price.envKey);
    if (!actual) {
      issues.push(
        issue(
          "missing_price",
          price.envKey,
          `${price.envKey} did not resolve to a Stripe price.`,
        ),
      );
      continue;
    }
    if (actual.id !== priceId) {
      issues.push(
        issue(
          "price_id_mismatch",
          price.envKey,
          `${price.envKey} resolved to ${actual.id}, not ${priceId}.`,
        ),
      );
    }
    if (!actual.active) {
      issues.push(
        issue(
          "price_inactive",
          price.envKey,
          `${price.envKey} points at an inactive Stripe price.`,
        ),
      );
    }
    if (actual.productId !== productId) {
      issues.push(
        issue(
          "price_product_mismatch",
          price.envKey,
          `${price.envKey} is attached to ${actual.productId}, not ${productId}.`,
        ),
      );
    }
    if (actual.unitAmount !== price.unitAmountCents) {
      issues.push(
        issue(
          "price_amount_mismatch",
          price.envKey,
          `${price.envKey} is ${actual.unitAmount} cents, not ${price.unitAmountCents}.`,
        ),
      );
    }
    if (actual.currency !== price.currency) {
      issues.push(
        issue(
          "price_currency_mismatch",
          price.envKey,
          `${price.envKey} is ${actual.currency}, not ${price.currency}.`,
        ),
      );
    }
    if (!priceRecurringMatches(actual, price)) {
      issues.push(
        issue(
          "price_recurring_mismatch",
          price.envKey,
          `${price.envKey} has the wrong recurring interval.`,
        ),
      );
    }
    if (actual.metadata.atlas_price_id !== price.id) {
      issues.push(
        issue(
          "price_metadata_mismatch",
          price.envKey,
          `${price.envKey} is missing atlas_price_id=${price.id}.`,
        ),
      );
    }
  }
}

function verifyCoupons(
  env: Map<string, string>,
  snapshot: StripeCatalogSnapshot,
  missingEnvKeys: Set<string>,
  issues: StripeCatalogVerificationIssue[],
): void {
  for (const expectation of couponExpectations(env)) {
    const { coupon, productIds } = expectation;
    if (missingEnvKeys.has(coupon.envKey)) {
      continue;
    }
    const couponId = env.get(coupon.envKey)?.trim() ?? "";
    const actual = snapshot.coupons.get(coupon.envKey);
    if (!actual) {
      issues.push(
        issue(
          "missing_coupon",
          coupon.envKey,
          `${coupon.envKey} did not resolve to a Stripe coupon.`,
        ),
      );
      continue;
    }
    if (actual.id !== couponId) {
      issues.push(
        issue(
          "coupon_id_mismatch",
          coupon.envKey,
          `${coupon.envKey} resolved to ${actual.id}, not ${couponId}.`,
        ),
      );
    }
    if (actual.percentOff !== coupon.percentOff) {
      issues.push(
        issue(
          "coupon_percent_mismatch",
          coupon.envKey,
          `${coupon.envKey} is ${actual.percentOff}% off, not ${coupon.percentOff}%.`,
        ),
      );
    }
    if (actual.duration !== "forever") {
      issues.push(
        issue(
          "coupon_duration_mismatch",
          coupon.envKey,
          `${coupon.envKey} duration is ${actual.duration}, not forever.`,
        ),
      );
    }
    if (!sameStringSet(actual.appliesToProductIds, productIds)) {
      issues.push(
        issue(
          "coupon_product_scope_mismatch",
          coupon.envKey,
          `${coupon.envKey} must apply only to ${productIds.join(", ")}.`,
        ),
      );
    }
    if (actual.metadata.atlas_discount_segment !== coupon.segment) {
      issues.push(
        issue(
          "coupon_metadata_mismatch",
          coupon.envKey,
          `${coupon.envKey} is missing atlas_discount_segment=${coupon.segment}.`,
        ),
      );
    }
  }
}

function priceExpectations(): PriceExpectation[] {
  return ATLAS_PRODUCTS.flatMap((product) =>
    product.prices.map((price) => ({ price, product })),
  );
}

function couponExpectations(env: Map<string, string>): CouponExpectation[] {
  return ATLAS_COUPONS.map((coupon) => ({
    coupon,
    productIds: coupon.appliesToProductIds.map((productId) => {
      const product = ATLAS_PRODUCTS.find(
        (candidate) => candidate.id === productId,
      );
      if (!product) {
        throw new Error(`Unknown Atlas product ${productId}.`);
      }
      return env.get(product.envProductKey)?.trim() ?? "";
    }),
  }));
}

function priceRecurringMatches(
  actual: StripePriceSnapshot,
  expected: AtlasPriceDefinition,
): boolean {
  const expectedInterval = expected.recurring?.interval ?? null;
  const expectedIntervalCount = expected.recurring
    ? (expected.recurring.intervalCount ?? 1)
    : null;
  return (
    actual.recurringInterval === expectedInterval &&
    actual.recurringIntervalCount === expectedIntervalCount
  );
}
