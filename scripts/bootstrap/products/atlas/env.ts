import path from "node:path";
import type { VercelEnvironment, VercelVar } from "../../lib/vercel.js";
import { ATLAS_COUPONS, ATLAS_PRODUCTS } from "../../config/products.js";

export type StripeBootstrapTarget = "local" | "staging" | "prod";
export type StripeRuntimeMode = "test" | "live";

export const STRIPE_ATLAS_CATALOG_ENV_KEY = "STRIPE_ATLAS_CATALOG";

const STRIPE_RUNTIME_ENV_KEYS = [
  "STRIPE_API_KEY",
  "STRIPE_WEBHOOK_SECRET",
  STRIPE_ATLAS_CATALOG_ENV_KEY,
] as const;

export const STRIPE_PRODUCT_ENV_KEYS = ATLAS_PRODUCTS.flatMap((product) => [
  product.envProductKey,
  ...product.prices.map((price) => price.envKey),
]);

export const STRIPE_COUPON_ENV_KEYS = ATLAS_COUPONS.map(
  (coupon) => coupon.envKey,
);

export const STRIPE_ENV_KEYS = STRIPE_RUNTIME_ENV_KEYS;

export interface StripeAtlasCatalogEnvValue {
  coupons: Record<string, string>;
  prices: Record<string, string>;
  products: Record<string, string>;
}

export function resolveStripeMode(
  target: StripeBootstrapTarget,
  live: boolean,
): StripeRuntimeMode {
  if (target === "prod") {
    if (!live) {
      throw new Error("Stripe production bootstrap requires --live.");
    }
    return "live";
  }

  if (live) {
    throw new Error(
      "Stripe local and staging bootstrap must use Stripe test mode.",
    );
  }
  return "test";
}

export function validateStripeApiKeyMode(
  apiKey: string,
  mode: StripeRuntimeMode,
): void {
  const trimmed = apiKey.trim();
  const allowedPrefixes =
    mode === "live" ? ["sk_live_", "rk_live_"] : ["sk_test_", "rk_test_"];
  if (!allowedPrefixes.some((prefix) => trimmed.startsWith(prefix))) {
    throw new Error(
      `Stripe ${mode} mode requires a ${allowedPrefixes.join(" or ")} API key.`,
    );
  }
}

export function resolveStripeEnvFileTargets(
  projectRoot: string,
  target: StripeBootstrapTarget,
): string[] {
  if (target === "local") {
    return [
      path.join(projectRoot, ".env"),
      path.join(projectRoot, "app", ".env.local"),
    ];
  }
  if (target === "staging") {
    return [path.join(projectRoot, ".env.staging")];
  }
  return [path.join(projectRoot, ".env.production")];
}

export function stripeWebhookUrlForOrigin(origin: string): string {
  const candidate = origin.trim();
  const normalizedCandidate = /^https?:\/\//.test(candidate)
    ? candidate
    : `https://${candidate}`;
  const url = new URL(normalizedCandidate);
  if (url.protocol !== "https:" || !url.hostname) {
    throw new Error("Stripe webhook origins must use https://.");
  }
  return new URL("/api/stripe/webhook", url.origin).toString();
}

export function buildStripeEnvUpdates(
  apiKey: string,
  webhookSecret: string | null,
  stripeIds: Map<string, string>,
): Map<string, string> {
  const updates = new Map<string, string>();
  updates.set("STRIPE_API_KEY", apiKey);
  if (webhookSecret) {
    updates.set("STRIPE_WEBHOOK_SECRET", webhookSecret);
  }
  updates.set(
    STRIPE_ATLAS_CATALOG_ENV_KEY,
    buildStripeCatalogEnvValue(stripeIds),
  );
  return updates;
}

export function buildStripeCatalogEnvValue(
  stripeIds: Map<string, string>,
): string {
  const catalog: StripeAtlasCatalogEnvValue = {
    coupons: {},
    prices: {},
    products: {},
  };

  for (const product of ATLAS_PRODUCTS) {
    const productId = stripeIds.get(product.envProductKey)?.trim();
    if (productId) {
      catalog.products[product.id] = productId;
    }
    for (const price of product.prices) {
      const priceId = stripeIds.get(price.envKey)?.trim();
      if (priceId) {
        catalog.prices[price.id] = priceId;
      }
    }
  }

  for (const coupon of ATLAS_COUPONS) {
    const couponId = stripeIds.get(coupon.envKey)?.trim();
    if (couponId) {
      catalog.coupons[coupon.segment] = couponId;
    }
  }

  return JSON.stringify(catalog);
}

export function parseStripeCatalogEnvValue(
  rawValue: string,
): StripeAtlasCatalogEnvValue {
  const parsed = JSON.parse(rawValue) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${STRIPE_ATLAS_CATALOG_ENV_KEY} must be a JSON object.`);
  }
  return {
    coupons: parseCatalogSection(parsed, "coupons"),
    prices: parseCatalogSection(parsed, "prices"),
    products: parseCatalogSection(parsed, "products"),
  };
}

export function expandStripeCatalogEnv(
  env: Map<string, string>,
): Map<string, string> {
  const expanded = new Map(env);
  const rawValue = env.get(STRIPE_ATLAS_CATALOG_ENV_KEY)?.trim();
  if (!rawValue) {
    return expanded;
  }

  const catalog = parseStripeCatalogEnvValue(rawValue);
  for (const product of ATLAS_PRODUCTS) {
    const productId = catalog.products[product.id]?.trim();
    if (productId) {
      expanded.set(product.envProductKey, productId);
    }
    for (const price of product.prices) {
      const priceId = catalog.prices[price.id]?.trim();
      if (priceId) {
        expanded.set(price.envKey, priceId);
      }
    }
  }
  for (const coupon of ATLAS_COUPONS) {
    const couponId = catalog.coupons[coupon.segment]?.trim();
    if (couponId) {
      expanded.set(coupon.envKey, couponId);
    }
  }
  return expanded;
}

function parseCatalogSection(
  catalog: Record<string, unknown>,
  section: keyof StripeAtlasCatalogEnvValue,
): Record<string, string> {
  const value = catalog[section];
  if (!isRecord(value)) {
    throw new Error(
      `${STRIPE_ATLAS_CATALOG_ENV_KEY}.${section} must be a JSON object.`,
    );
  }

  const entries: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new Error(
        `${STRIPE_ATLAS_CATALOG_ENV_KEY}.${section}.${key} must be a string.`,
      );
    }
    entries[key] = item.trim();
  }
  return entries;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function buildStripeVercelEnvVars(
  env: Map<string, string>,
  target: StripeBootstrapTarget,
): VercelVar[] {
  if (target === "local") {
    return [];
  }

  const environments: VercelEnvironment[] =
    target === "prod" ? ["production"] : ["preview"];
  const vars: VercelVar[] = [];
  for (const key of STRIPE_ENV_KEYS) {
    const value = env.get(key)?.trim();
    if (value) {
      vars.push({ key, value, environments });
    }
  }
  return vars;
}
