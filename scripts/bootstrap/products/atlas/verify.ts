#!/usr/bin/env tsx
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import Stripe from "stripe";
import { parseEnvFile } from "../../lib/env-file.js";
import { getVercelScope } from "../../lib/vercel.js";
import { fetchExistingKeys } from "../../lib/vercel-env.js";
import { ATLAS_COUPONS, ATLAS_PRODUCTS } from "../../config/products.js";
import {
  expandStripeCatalogEnv,
  resolveStripeEnvFileTargets,
  resolveStripeMode,
  validateStripeApiKeyMode,
} from "./env.js";
import { stripeLiveRestrictedKeySetupSteps } from "./stripe-copy.js";
import type { StripeBootstrapTarget } from "./env.js";
import type {
  StripeCatalogSnapshot,
  StripeCatalogVerificationIssue,
  StripeCouponSnapshot,
  StripePriceSnapshot,
  StripeProductSnapshot,
  StripeWebhookEndpointSnapshot,
} from "./verify-types.js";
import {
  verifyHostedStripeEnvKeys,
  verifyStripeTargetSnapshot,
} from "./verify-catalog.js";
import { issue } from "./verify-issue.js";
import { expectedWebhookUrlForEnv } from "./verify-webhook.js";

interface VerifyCliArgs {
  live: boolean;
  target: StripeBootstrapTarget;
}

export async function fetchStripeCatalogSnapshot(
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
