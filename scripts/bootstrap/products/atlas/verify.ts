#!/usr/bin/env tsx
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Stripe from "stripe";
import { parseEnvFile } from "../../lib/env-file.js";
import { ATLAS_COUPONS, ATLAS_PRODUCTS } from "../../config/products.js";
import {
  STRIPE_ATLAS_CATALOG_ENV_KEY,
  STRIPE_ENV_KEYS,
  expandStripeCatalogEnv,
  resolveStripeEnvFileTargets,
  resolveStripeMode,
  validateStripeApiKeyMode,
} from "./env.js";
import type { StripeBootstrapTarget } from "./env.js";
import type {
  AtlasCouponDefinition,
  AtlasPriceDefinition,
  AtlasProductDefinition,
} from "../../config/products.js";

export type StripeCatalogIssueCode =
  | "missing_env"
  | "invalid_catalog"
  | "missing_product"
  | "product_id_mismatch"
  | "product_inactive"
  | "product_metadata_mismatch"
  | "missing_price"
  | "price_id_mismatch"
  | "price_inactive"
  | "price_product_mismatch"
  | "price_amount_mismatch"
  | "price_currency_mismatch"
  | "price_recurring_mismatch"
  | "price_metadata_mismatch"
  | "missing_coupon"
  | "coupon_id_mismatch"
  | "coupon_percent_mismatch"
  | "coupon_duration_mismatch"
  | "coupon_product_scope_mismatch"
  | "coupon_metadata_mismatch";

export interface StripeCatalogVerificationIssue {
  code: StripeCatalogIssueCode;
  envKey: string;
  message: string;
}

export interface StripeProductSnapshot {
  active: boolean;
  envKey: string;
  id: string;
  metadata: Stripe.Metadata;
  name: string;
}

export interface StripePriceSnapshot {
  active: boolean;
  currency: string;
  envKey: string;
  id: string;
  metadata: Stripe.Metadata;
  productId: string;
  recurringInterval: string | null;
  recurringIntervalCount: number | null;
  unitAmount: number | null;
}

export interface StripeCouponSnapshot {
  appliesToProductIds: readonly string[];
  duration: string;
  envKey: string;
  id: string;
  metadata: Stripe.Metadata;
  percentOff: number | null;
}

export interface StripeCatalogSnapshot {
  coupons: Map<string, StripeCouponSnapshot>;
  prices: Map<string, StripePriceSnapshot>;
  products: Map<string, StripeProductSnapshot>;
}

interface VerifyCliArgs {
  live: boolean;
  target: StripeBootstrapTarget;
}

interface PriceExpectation {
  price: AtlasPriceDefinition;
  product: AtlasProductDefinition;
}

interface CouponExpectation {
  coupon: AtlasCouponDefinition;
  productIds: readonly string[];
}

function issue(
  code: StripeCatalogIssueCode,
  envKey: string,
  message: string,
): StripeCatalogVerificationIssue {
  return { code, envKey, message };
}

export function verifyStripeCatalogSnapshot(
  env: Map<string, string>,
  snapshot: StripeCatalogSnapshot,
): StripeCatalogVerificationIssue[] {
  const issues: StripeCatalogVerificationIssue[] = [];
  const missingEnvKeys = new Set<string>();
  let expandedEnv: Map<string, string>;

  for (const key of STRIPE_ENV_KEYS) {
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
  return issues;
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

function sameStringSet(
  actualItems: readonly string[],
  expectedItems: readonly string[],
): boolean {
  const actual = [...actualItems].sort();
  const expected = [...expectedItems].sort();
  return (
    actual.length === expected.length &&
    actual.every((item, index) => item === expected[index])
  );
}

async function fetchStripeCatalogSnapshot(
  stripe: Stripe,
  env: Map<string, string>,
): Promise<StripeCatalogSnapshot> {
  const products = new Map<string, StripeProductSnapshot>();
  const prices = new Map<string, StripePriceSnapshot>();
  const coupons = new Map<string, StripeCouponSnapshot>();

  for (const product of ATLAS_PRODUCTS) {
    const productId = env.get(product.envProductKey)?.trim();
    if (productId) {
      const stripeProduct = await stripe.products.retrieve(productId);
      if (!stripeProduct.deleted) {
        products.set(product.envProductKey, {
          active: stripeProduct.active,
          envKey: product.envProductKey,
          id: stripeProduct.id,
          metadata: stripeProduct.metadata,
          name: stripeProduct.name,
        });
      }
    }

    for (const price of product.prices) {
      const priceId = env.get(price.envKey)?.trim();
      if (!priceId) {
        continue;
      }
      const stripePrice = await stripe.prices.retrieve(priceId);
      prices.set(price.envKey, {
        active: stripePrice.active,
        currency: stripePrice.currency,
        envKey: price.envKey,
        id: stripePrice.id,
        metadata: stripePrice.metadata,
        productId:
          typeof stripePrice.product === "string"
            ? stripePrice.product
            : stripePrice.product.id,
        recurringInterval: stripePrice.recurring?.interval ?? null,
        recurringIntervalCount: stripePrice.recurring?.interval_count ?? null,
        unitAmount: stripePrice.unit_amount,
      });
    }
  }

  for (const coupon of ATLAS_COUPONS) {
    const couponId = env.get(coupon.envKey)?.trim();
    if (!couponId) {
      continue;
    }
    const stripeCoupon = await stripe.coupons.retrieve(couponId, {
      expand: ["applies_to"],
    });
    if (stripeCoupon.deleted) {
      continue;
    }
    coupons.set(coupon.envKey, {
      appliesToProductIds: stripeCoupon.applies_to?.products ?? [],
      duration: stripeCoupon.duration,
      envKey: coupon.envKey,
      id: stripeCoupon.id,
      metadata: stripeCoupon.metadata,
      percentOff: stripeCoupon.percent_off,
    });
  }

  return { coupons, prices, products };
}

function parseArgs(argv: string[]): VerifyCliArgs {
  const targetIndex = argv.indexOf("--target");
  const targetValue = targetIndex >= 0 ? argv[targetIndex + 1] : "local";
  if (
    targetValue !== "local" &&
    targetValue !== "staging" &&
    targetValue !== "prod"
  ) {
    throw new Error("Use --target local, --target staging, or --target prod.");
  }
  return { live: argv.includes("--live"), target: targetValue };
}

async function verifyEnvFile(
  envFile: string,
  target: StripeBootstrapTarget,
  live: boolean,
): Promise<StripeCatalogVerificationIssue[]> {
  const env = parseEnvFile(envFile);
  const explicitApiKey = process.env.STRIPE_API_KEY?.trim();
  if (explicitApiKey) {
    env.set("STRIPE_API_KEY", explicitApiKey);
  }
  const mode = resolveStripeMode(target, live);
  const apiKey = env.get("STRIPE_API_KEY")?.trim();
  const envOnlyIssues = verifyStripeCatalogSnapshot(env, {
    coupons: new Map(),
    prices: new Map(),
    products: new Map(),
  }).filter((verificationIssue) => verificationIssue.code === "missing_env");
  if (!apiKey) {
    return envOnlyIssues;
  }
  validateStripeApiKeyMode(apiKey, mode);
  const stripe = new Stripe(apiKey, { apiVersion: "2026-06-24.dahlia" });
  const snapshot = await fetchStripeCatalogSnapshot(
    stripe,
    expandStripeCatalogEnv(env),
  );
  return verifyStripeCatalogSnapshot(env, snapshot);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../..",
  );
  const envFiles = resolveStripeEnvFileTargets(projectRoot, args.target);
  let hasIssues = false;

  for (const envFile of envFiles) {
    const issues = await verifyEnvFile(envFile, args.target, args.live);
    if (issues.length === 0) {
      console.log(`ok ${path.relative(projectRoot, envFile)} Stripe catalog`);
      continue;
    }
    hasIssues = true;
    console.log(`not ok ${path.relative(projectRoot, envFile)} Stripe catalog`);
    for (const verificationIssue of issues) {
      console.log(
        `- ${verificationIssue.code} ${verificationIssue.envKey}: ${verificationIssue.message}`,
      );
    }
  }

  if (hasIssues) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
