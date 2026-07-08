import path from "node:path";
import Stripe from "stripe";
import { log, note, password, spinner, text } from "@clack/prompts";
import pc from "picocolors";
import { mergeEnvFile, parseEnvFile } from "../../lib/env-file.js";
import {
  detectAndLink,
  getVercelScope,
  syncEnvVars,
} from "../../lib/vercel.js";
import { logSubline, promptOrExit } from "../../lib/ui.js";
import type { PhaseResult, ReadinessState } from "../../state.js";
import { markPhase } from "../../state.js";
import { resolveStripeApiKey, runStripeCli } from "../stripe-cli-client.js";
import {
  ensureBillingWebhookEndpoint,
  ensureCoupon,
  ensurePrice,
  ensureProduct,
} from "./catalog.js";
import {
  buildStripeEnvUpdates,
  buildStripeVercelEnvVars,
  resolveStripeEnvFileTargets,
  resolveStripeMode,
  stripeWebhookUrlForOrigin,
  validateStripeApiKeyMode,
  type StripeBootstrapTarget,
} from "./env.js";
import { ATLAS_COUPONS, ATLAS_PRODUCTS } from "../../config/products.js";
import type { AtlasProductDefinition } from "../../config/products.js";

/**
 * Phase 6: Stripe product sync orchestrator.
 *
 * Ensures all Atlas products, prices, coupons, and billing webhook endpoints
 * exist in the requested Stripe mode and writes the runtime IDs into the
 * correct target env files.
 */
export async function runProductPhase(
  projectRoot: string,
  state: ReadinessState,
  doctorMode: boolean,
  live: boolean,
  target: StripeBootstrapTarget,
  assumeYes = false,
): Promise<PhaseResult> {
  const followUpItems: string[] = [];
  let envMode: ReturnType<typeof resolveStripeMode>;

  try {
    envMode = resolveStripeMode(target, live);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(message);
    markPhase(state, "product", "failed", message);
    return { success: false, followUpItems: [message] };
  }

  const envFileTargets = resolveStripeEnvFileTargets(projectRoot, target);
  let apiKey = resolveStripeApiKey(projectRoot, live, envFileTargets);
  const missingKeyFollowUp =
    target === "prod"
      ? "Set STRIPE_API_KEY in .env.production or run `STRIPE_API_KEY=sk_live_... pnpm bootstrap:stripe:prod` with a Dashboard-created live key"
      : "Set STRIPE_API_KEY in .env or run `stripe login`";

  if (!apiKey) {
    if (doctorMode) {
      log.warn("Stripe API key not found");
      logSubline(missingKeyFollowUp);
      markPhase(state, "product", "failed", "Missing Stripe API key");
      return {
        success: false,
        followUpItems: [missingKeyFollowUp],
      };
    }

    const prompted = await promptOrExit(
      password({
        message: `Stripe ${envMode} mode secret key (${envMode === "live" ? "sk_live" : "sk_test"}_...)`,
      }),
    );

    if (typeof prompted !== "string" || !prompted.trim()) {
      log.warn("Stripe API key not provided -- skipping product sync");
      markPhase(state, "product", "skipped", "No API key provided");
      return {
        success: false,
        followUpItems: [`${missingKeyFollowUp}, then re-run bootstrap`],
      };
    }

    apiKey = prompted.trim();
  }

  try {
    validateStripeApiKeyMode(apiKey, envMode);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error(message);
    markPhase(state, "product", "failed", message);
    return { success: false, followUpItems: [message] };
  }

  const stripe = new Stripe(apiKey, {
    apiVersion: "2026-06-24.dahlia",
  });

  const s = spinner();
  s.start("Verifying Stripe account...");

  try {
    const account = await stripe.accounts.retrieveCurrent();
    const accountName =
      account.settings?.dashboard?.display_name ??
      account.business_profile?.name ??
      account.id;
    s.stop(
      `Stripe account: ${pc.cyan(accountName)} (${envMode} mode, target=${target})`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    s.stop("Failed to verify Stripe account");
    log.error(message);
    markPhase(state, "product", "failed", message);
    return {
      success: false,
      followUpItems: ["Fix Stripe API key and re-run bootstrap"],
    };
  }

  if (doctorMode) {
    followUpItems.push(
      `Run \`pnpm bootstrap:stripe:${target}\` to converge Stripe ${envMode} products, coupons, and webhooks.`,
    );
    markPhase(state, "product", "partial", "Doctor mode did not mutate Stripe");
    return { success: false, followUpItems };
  }

  const stripeIds = new Map<string, string>();
  const productIds = new Map<AtlasProductDefinition["id"], string>();
  let allSucceeded = true;

  for (const definition of ATLAS_PRODUCTS) {
    try {
      const productId = await processProduct(stripe, definition, stripeIds);
      productIds.set(definition.id, productId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(
        `Failed to process product "${definition.stripeName}": ${message}`,
      );
      followUpItems.push(
        `Manually sync Stripe product "${definition.stripeName}" (${definition.id})`,
      );
      allSucceeded = false;
    }
  }

  for (const definition of ATLAS_COUPONS) {
    try {
      const couponProductIds = definition.appliesToProductIds.map(
        (productId) => {
          const stripeProductId = productIds.get(productId);
          if (!stripeProductId) {
            throw new Error(
              `Missing Stripe product for coupon target "${productId}".`,
            );
          }
          return stripeProductId;
        },
      );
      const coupon = await ensureCoupon(stripe, definition, couponProductIds);
      stripeIds.set(definition.envKey, coupon.id);
      logSubline(`${definition.segment}: ${pc.dim(coupon.id)} coupon`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Failed to process coupon "${definition.name}": ${message}`);
      followUpItems.push(`Manually sync Stripe coupon "${definition.name}"`);
      allSucceeded = false;
    }
  }

  const webhookSecret = await resolveWebhookSecret({
    apiKey,
    followUpItems,
    projectRoot,
    stripe,
    target,
  });
  if (!webhookSecret) {
    allSucceeded = false;
  }

  const envUpdates = buildStripeEnvUpdates(apiKey, webhookSecret, stripeIds);
  for (const envFile of envFileTargets) {
    mergeEnvFile(envFile, envUpdates);
    log.success(
      `Wrote ${envUpdates.size} Stripe values to ${pc.dim(path.relative(projectRoot, envFile))}`,
    );
  }

  if (target !== "local") {
    const synced = await syncHostedStripeEnv(
      projectRoot,
      target,
      envUpdates,
      followUpItems,
      assumeYes,
    );
    if (!synced) {
      allSucceeded = false;
    }
  }

  const status = allSucceeded ? "complete" : "partial";
  markPhase(
    state,
    "product",
    status,
    `${envUpdates.size} env vars written for ${target}`,
  );

  if (!allSucceeded) {
    followUpItems.push("Re-run product bootstrap to retry failed Stripe syncs");
  }

  return { success: allSucceeded, followUpItems };
}

interface ResolveWebhookSecretParams {
  apiKey: string;
  followUpItems: string[];
  projectRoot: string;
  stripe: Stripe;
  target: StripeBootstrapTarget;
}

async function resolveWebhookSecret(
  params: ResolveWebhookSecretParams,
): Promise<string | null> {
  const { apiKey, followUpItems, projectRoot, stripe, target } = params;
  const existingSecret = readExistingWebhookSecret(projectRoot, target);
  if (target === "local") {
    const localUrl = resolveLocalWebhookUrl(projectRoot);
    const result = runStripeCli(
      [
        "listen",
        "--print-secret",
        "--forward-to",
        localUrl,
        "--skip-verify",
        "--api-key",
        apiKey,
      ],
      false,
    );
    const secret = /whsec_[A-Za-z0-9]+/.exec(result.stdout)?.[0] ?? null;
    if (result.ok && secret) {
      logSubline(`Local Stripe webhook: ${pc.dim(localUrl)}`);
      return secret;
    }
    followUpItems.push(
      `Run \`pnpm stripe:listen\` and copy the printed whsec_ value into STRIPE_WEBHOOK_SECRET.`,
    );
    return existingSecret;
  }

  const webhookUrl = await resolveHostedWebhookUrl(projectRoot, target);
  const result = await ensureBillingWebhookEndpoint(stripe, webhookUrl);
  logSubline(`Stripe webhook endpoint: ${pc.dim(result.endpoint.url)}`);
  if (result.secret) {
    return result.secret;
  }
  if (existingSecret) {
    return existingSecret;
  }
  followUpItems.push(
    `Stripe webhook ${result.endpoint.id} already existed. Copy its signing secret into ${target === "prod" ? ".env.production" : ".env.staging"} as STRIPE_WEBHOOK_SECRET, or rotate the endpoint secret in Stripe and re-run bootstrap.`,
  );
  return null;
}

function readExistingWebhookSecret(
  projectRoot: string,
  target: StripeBootstrapTarget,
): string | null {
  for (const envFile of resolveStripeEnvFileTargets(projectRoot, target)) {
    const value = parseEnvFile(envFile).get("STRIPE_WEBHOOK_SECRET")?.trim();
    if (value) {
      return value;
    }
  }
  return null;
}

function resolveLocalWebhookUrl(projectRoot: string): string {
  const rootEnv = parseEnvFile(path.join(projectRoot, ".env"));
  const origin =
    rootEnv.get("ATLAS_PUBLIC_URL")?.trim() || "https://atlas.localhost";
  return stripeWebhookUrlForOrigin(origin);
}

async function resolveHostedWebhookUrl(
  projectRoot: string,
  target: Exclude<StripeBootstrapTarget, "local">,
): Promise<string> {
  const envFile = resolveStripeEnvFileTargets(projectRoot, target)[0];
  const env = parseEnvFile(envFile);
  const current = env.get("ATLAS_PUBLIC_URL")?.trim();
  if (current) {
    return stripeWebhookUrlForOrigin(current);
  }

  note(
    "Stripe needs the deployed Atlas app URL because webhooks are delivered to the app route at /api/stripe/webhook.",
    target === "prod" ? "Production Stripe webhook" : "Staging Stripe webhook",
  );
  const value = await promptOrExit(
    text({
      message: target === "prod" ? "Production Atlas URL" : "Staging Atlas URL",
      placeholder:
        target === "prod"
          ? "https://atlas.rebuildingus.org"
          : "https://atlas-staging.rebuildingus.org",
      validate: (input) => {
        const candidate = input ?? "";
        if (!candidate.trim()) {
          return "Atlas URL is required.";
        }
        try {
          stripeWebhookUrlForOrigin(candidate);
        } catch (error) {
          return error instanceof Error
            ? error.message
            : "Enter a valid HTTPS URL.";
        }
      },
    }),
  );
  const origin = String(value);
  mergeEnvFile(
    envFile,
    new Map([
      ["ATLAS_PUBLIC_URL", new URL(stripeWebhookUrlForOrigin(origin)).origin],
    ]),
  );
  return stripeWebhookUrlForOrigin(origin);
}

async function syncHostedStripeEnv(
  projectRoot: string,
  target: Exclude<StripeBootstrapTarget, "local">,
  envUpdates: Map<string, string>,
  followUpItems: string[],
  assumeYes: boolean,
): Promise<boolean> {
  const varsToSync = buildStripeVercelEnvVars(envUpdates, target);
  if (varsToSync.length === 0) {
    return true;
  }

  const appDir = path.join(projectRoot, "app");
  await detectAndLink(appDir);
  const scope = getVercelScope(appDir);
  if (!scope) {
    followUpItems.push(
      "Vercel project not linked — run `vercel link` in app/ then re-run Stripe bootstrap",
    );
    return false;
  }

  const synced = await syncEnvVars(varsToSync, scope, {
    assumeYes,
    cwd: appDir,
  });
  if (!synced) {
    followUpItems.push(
      `Stripe ${target} env values were not fully synced to Vercel — re-run \`pnpm bootstrap:stripe:${target}\` after checking Vercel CLI output`,
    );
  }
  return synced;
}

async function processProduct(
  stripe: Stripe,
  definition: AtlasProductDefinition,
  envValues: Map<string, string>,
): Promise<string> {
  const product = await ensureProduct(stripe, definition);
  log.success(
    `${pc.bold(definition.stripeName)} -- ready (${pc.dim(product.id)})`,
  );
  envValues.set(definition.envProductKey, product.id);

  for (const priceDef of definition.prices) {
    const price = await ensurePrice(stripe, product.id, priceDef);
    envValues.set(priceDef.envKey, price.id);
    logSubline(`${priceDef.id}: ${pc.dim(price.id)}`);
  }
  return product.id;
}
