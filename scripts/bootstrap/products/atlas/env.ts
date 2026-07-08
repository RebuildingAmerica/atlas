import path from "node:path";
import type { VercelEnvironment, VercelVar } from "../../lib/vercel.js";
import { ATLAS_COUPONS, ATLAS_PRODUCTS } from "../../config/products.js";

export type StripeBootstrapTarget = "local" | "staging" | "prod";
export type StripeRuntimeMode = "test" | "live";

const STRIPE_RUNTIME_ENV_KEYS = [
  "STRIPE_API_KEY",
  "STRIPE_WEBHOOK_SECRET",
] as const;

export const STRIPE_PRODUCT_ENV_KEYS = ATLAS_PRODUCTS.flatMap((product) => [
  product.envProductKey,
  ...product.prices.map((price) => price.envKey),
]);

export const STRIPE_COUPON_ENV_KEYS = ATLAS_COUPONS.map(
  (coupon) => coupon.envKey,
);

export const STRIPE_ENV_KEYS = [
  ...STRIPE_RUNTIME_ENV_KEYS,
  ...STRIPE_PRODUCT_ENV_KEYS,
  ...STRIPE_COUPON_ENV_KEYS,
] as const;

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
  for (const [key, value] of stripeIds) {
    updates.set(key, value);
  }
  return updates;
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
