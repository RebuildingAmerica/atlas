#!/usr/bin/env tsx
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Stripe from "stripe";
import { parseEnvFile } from "../../lib/env-file.js";
import {
  fetchExistingKeys,
  getVercelScope,
  hasVercelEnvKey,
} from "../../lib/vercel.js";
import { ATLAS_COUPONS, ATLAS_PRODUCTS } from "../../config/products.js";
import {
  STRIPE_ATLAS_CATALOG_ENV_KEY,
  STRIPE_ENV_KEYS,
  expandStripeCatalogEnv,
  resolveStripeEnvFileTargets,
  resolveStripeMode,
  stripeWebhookUrlForOrigin,
  validateStripeApiKeyMode,
} from "./env.js";
import { stripeLiveRestrictedKeySetupSteps } from "./bootstrap.js";
import { STRIPE_BILLING_WEBHOOK_EVENTS } from "../../config/products.js";
import type { StripeBootstrapTarget } from "./env.js";
import type { VercelEnvKey } from "../../lib/vercel.js";
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
  | "coupon_metadata_mismatch"
  | "webhook_url_invalid"
  | "missing_webhook_endpoint"
  | "webhook_disabled"
  | "webhook_events_mismatch"
  | "webhook_metadata_mismatch"
  | "missing_hosted_env"
  | "vercel_project_unlinked";

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

export interface StripeWebhookEndpointSnapshot {
  enabledEvents: readonly string[];
  id: string;
  metadata: Stripe.Metadata;
  status: string;
  url: string;
}

export interface StripeCatalogSnapshot {
  coupons: Map<string, StripeCouponSnapshot>;
  prices: Map<string, StripePriceSnapshot>;
  products: Map<string, StripeProductSnapshot>;
  webhookEndpoints: Map<string, StripeWebhookEndpointSnapshot>;
}

interface StripeCatalogVerificationOptions {
  expectedWebhookUrl?: string;
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
  options: StripeCatalogVerificationOptions = {},
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

function verifyBillingWebhook(
  snapshot: StripeCatalogSnapshot,
  expectedWebhookUrl: string | undefined,
  issues: StripeCatalogVerificationIssue[],
): void {
  if (!expectedWebhookUrl) {
    return;
  }

  const actual = snapshot.webhookEndpoints.get(expectedWebhookUrl);
  if (!actual) {
    issues.push(
      issue(
        "missing_webhook_endpoint",
        "STRIPE_WEBHOOK_SECRET",
        `No enabled Stripe billing webhook endpoint exists for ${expectedWebhookUrl}.`,
      ),
    );
    return;
  }

  if (actual.status === "disabled") {
    issues.push(
      issue(
        "webhook_disabled",
        "STRIPE_WEBHOOK_SECRET",
        `Stripe webhook endpoint ${actual.id} is disabled.`,
      ),
    );
  }

  if (!sameStringSet(actual.enabledEvents, STRIPE_BILLING_WEBHOOK_EVENTS)) {
    issues.push(
      issue(
        "webhook_events_mismatch",
        "STRIPE_WEBHOOK_SECRET",
        `Stripe webhook endpoint ${actual.id} must listen for ${STRIPE_BILLING_WEBHOOK_EVENTS.join(", ")}.`,
      ),
    );
  }

  if (actual.metadata.atlas_webhook !== "billing") {
    issues.push(
      issue(
        "webhook_metadata_mismatch",
        "STRIPE_WEBHOOK_SECRET",
        `Stripe webhook endpoint ${actual.id} is missing atlas_webhook=billing.`,
      ),
    );
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
  expectedWebhookUrl?: string,
): Promise<StripeCatalogSnapshot> {
  const products = new Map<string, StripeProductSnapshot>();
  const prices = new Map<string, StripePriceSnapshot>();
  const coupons = new Map<string, StripeCouponSnapshot>();
  const webhookEndpoints = new Map<string, StripeWebhookEndpointSnapshot>();

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

  if (expectedWebhookUrl) {
    for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
      if (endpoint.url !== expectedWebhookUrl) {
        continue;
      }
      webhookEndpoints.set(endpoint.url, {
        enabledEvents: endpoint.enabled_events,
        id: endpoint.id,
        metadata: endpoint.metadata,
        status: endpoint.status,
        url: endpoint.url,
      });
      break;
    }
  }

  return { coupons, prices, products, webhookEndpoints };
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

export function formatStripeVerificationFollowUp(
  target: StripeBootstrapTarget,
  issues: readonly StripeCatalogVerificationIssue[],
): string[] {
  if (issues.length === 0) {
    return [];
  }

  if (target === "prod") {
    return [
      "Production Stripe setup is incomplete.",
      "Run the guided bootstrap flow: pnpm bootstrap",
      ...stripeLiveRestrictedKeySetupSteps(),
      "Verify again: pnpm stripe:verify:prod",
    ];
  }

  if (target === "staging") {
    return [
      "Staging Stripe setup is incomplete.",
      "Run the guided staging flow: pnpm bootstrap --target staging",
      "To rerun staging noninteractively: pnpm setup:staging --yes",
      "Verify again: pnpm stripe:verify:staging",
    ];
  }

  return [
    "Local Stripe setup is incomplete.",
    "Run the guided local flow: pnpm bootstrap --local-only",
    "Local shortcut: pnpm setup:local",
    "Run webhook forwarding while testing Checkout: pnpm stripe:listen",
    "Verify again: pnpm stripe:verify:local",
  ];
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
  const emptySnapshot: StripeCatalogSnapshot = {
    coupons: new Map(),
    prices: new Map(),
    products: new Map(),
    webhookEndpoints: new Map(),
  };
  const envOnlyIssues = verifyStripeTargetSnapshot(
    env,
    emptySnapshot,
    target,
  ).filter((verificationIssue) => verificationIssue.code === "missing_env");
  if (!apiKey) {
    return envOnlyIssues;
  }
  validateStripeApiKeyMode(apiKey, mode);
  const expectedWebhookUrl = expectedWebhookUrlForEnv(env, target);
  const stripe = new Stripe(apiKey, { apiVersion: "2026-06-24.dahlia" });
  const snapshot = await fetchStripeCatalogSnapshot(
    stripe,
    expandStripeCatalogEnv(env),
    expectedWebhookUrl,
  );
  return verifyStripeTargetSnapshot(env, snapshot, target);
}

function expectedWebhookUrlForEnv(
  env: Map<string, string>,
  target: StripeBootstrapTarget,
  issues?: StripeCatalogVerificationIssue[],
): string | undefined {
  if (target === "local") {
    return undefined;
  }
  const origin = env.get("ATLAS_PUBLIC_URL")?.trim();
  if (!origin) {
    issues?.push(
      issue(
        "missing_env",
        "ATLAS_PUBLIC_URL",
        "ATLAS_PUBLIC_URL is required to verify the hosted Stripe webhook endpoint.",
      ),
    );
    return undefined;
  }
  try {
    return stripeWebhookUrlForOrigin(origin);
  } catch (error) {
    issues?.push(
      issue(
        "webhook_url_invalid",
        "ATLAS_PUBLIC_URL",
        error instanceof Error ? error.message : String(error),
      ),
    );
    return undefined;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../..",
  );
  const envFiles = resolveStripeEnvFileTargets(projectRoot, args.target);
  let hasIssues = false;
  const allIssues: StripeCatalogVerificationIssue[] = [];

  for (const envFile of envFiles) {
    const issues = await verifyEnvFile(envFile, args.target, args.live);
    if (issues.length === 0) {
      console.log(`ok ${path.relative(projectRoot, envFile)} Stripe catalog`);
      continue;
    }
    hasIssues = true;
    allIssues.push(...issues);
    console.log(`not ok ${path.relative(projectRoot, envFile)} Stripe catalog`);
    for (const verificationIssue of issues) {
      console.log(
        `- ${verificationIssue.code} ${verificationIssue.envKey}: ${verificationIssue.message}`,
      );
    }
  }

  if (args.target !== "local") {
    const hostedIssues = verifyHostedStripeEnvForProject(
      projectRoot,
      args.target,
    );
    if (hostedIssues.length > 0) {
      hasIssues = true;
      allIssues.push(...hostedIssues);
      console.log(
        `not ok Vercel ${args.target === "prod" ? "Production" : "Preview"} Stripe env`,
      );
      for (const verificationIssue of hostedIssues) {
        console.log(
          `- ${verificationIssue.code} ${verificationIssue.envKey}: ${verificationIssue.message}`,
        );
      }
    } else {
      console.log(
        `ok Vercel ${args.target === "prod" ? "Production" : "Preview"} Stripe env`,
      );
    }
  }

  if (hasIssues) {
    const followUp = formatStripeVerificationFollowUp(args.target, allIssues);
    if (followUp.length > 0) {
      console.log("");
      for (const line of followUp) {
        console.log(line);
      }
    }
    process.exitCode = 1;
  }
}

function verifyHostedStripeEnvForProject(
  projectRoot: string,
  target: Exclude<StripeBootstrapTarget, "local">,
): StripeCatalogVerificationIssue[] {
  const appDir = path.join(projectRoot, "app");
  const scope = getVercelScope(appDir);
  if (!scope) {
    return [
      issue(
        "vercel_project_unlinked",
        "VERCEL_PROJECT",
        "app/ is not linked to a Vercel project, so hosted Stripe env metadata cannot be verified.",
      ),
    ];
  }
  return verifyHostedStripeEnvKeys(
    target,
    fetchExistingKeys(scope, { cwd: appDir }),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  });
}
