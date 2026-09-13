import path from "node:path";
import type Stripe from "stripe";
import { log, note, password } from "@clack/prompts";
import pc from "picocolors";
import { mergeEnvFile } from "../../lib/env-file.js";
import { detectAndLink, getVercelScope } from "../../lib/vercel.js";
import { fetchExistingKeys, syncEnvVars } from "../../lib/vercel-env.js";
import { logSubline, promptOrExit } from "../../lib/ui.js";
import type { PhaseResult, ReadinessState } from "../../state.js";
import { markPhase } from "../../state.js";
import {
  resolveStripeApiKey,
  stripeApiKeyResolutionNotes,
} from "../stripe-cli-client.js";
import {
  ensureCoupon,
  ensureDefaultProductPrice,
  ensurePrice,
  ensureProduct,
  retireNonCatalogPrices,
} from "./catalog.js";
import {
  buildStripeEnvUpdates,
  buildStripeVercelEnvVars,
  resolveStripeEnvFileTargets,
  resolveStripeMode,
  validateStripeApiKeyMode,
  type StripeBootstrapTarget,
} from "./env.js";
import { ATLAS_COUPONS, ATLAS_PRODUCTS } from "../../config/products.js";
import type { AtlasProductDefinition } from "../../config/products.js";
import {
  confirmStripeAccount,
  printStripeApiKeyGuidance,
} from "./stripe-account.js";
import {
  formatHostedStripeEnvStatus,
  formatStripeAccountVerificationFailure,
  formatStripeApiKeyPromptMessage,
  formatStripeMissingApiKeyGuidance,
  setupCommandForTarget,
  stripeDoctorFollowUp,
} from "./stripe-copy.js";
import { resolveWebhookSecret } from "./stripe-webhook-secret.js";

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
      ? "Production Stripe setup needs a live restricted key before bootstrap can change Stripe."
      : "Set STRIPE_API_KEY in .env or run `stripe login`";
  const apiKeyResolutionNotes = stripeApiKeyResolutionNotes(
    projectRoot,
    live,
    envFileTargets,
  );
  const hostedEnvStatus =
    target === "local" ? [] : hostedStripeEnvStatus(projectRoot, target);

  if (!apiKey) {
    if (doctorMode) {
      log.warn("Stripe API key not found");
      for (const guidanceLine of formatStripeMissingApiKeyGuidance({
        apiKeyResolutionNotes,
        hostedEnvStatus,
        target,
      })) {
        logSubline(guidanceLine);
      }
      markPhase(state, "product", "failed", "Missing Stripe API key");
      return {
        success: false,
        followUpItems:
          target === "prod"
            ? [
                ...apiKeyResolutionNotes,
                ...hostedEnvStatus,
                ...stripeDoctorFollowUp(target, envMode),
              ]
            : [...hostedEnvStatus, missingKeyFollowUp],
      };
    }

    printStripeApiKeyGuidance(envMode);
    const prompted = await promptOrExit(
      password({
        message: formatStripeApiKeyPromptMessage(envMode),
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

  let stripe: Stripe;
  try {
    const confirmed = await confirmStripeAccount({
      apiKey,
      assumeYes,
      doctorMode,
      mode: envMode,
      target,
    });
    if (!confirmed) {
      markPhase(state, "product", "failed", "Stripe account not confirmed");
      return {
        success: false,
        followUpItems: [
          "Confirm the intended Stripe account or provide a different Stripe API key.",
        ],
      };
    }
    apiKey = confirmed.apiKey;
    stripe = confirmed.stripe;
  } catch (error) {
    const failure = formatStripeAccountVerificationFailure(error);
    log.error(failure.summary);
    note(failure.message, failure.title);
    markPhase(state, "product", "failed", failure.summary);
    return {
      success: false,
      followUpItems: [
        failure.summary,
        "Fix Stripe API key and re-run bootstrap",
      ],
    };
  }

  if (doctorMode) {
    followUpItems.push(...stripeDoctorFollowUp(target, envMode));
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
    followUpItems.push(
      `Re-run \`${setupCommandForTarget(target)}\` to retry failed Stripe syncs`,
    );
  }

  return { success: allSucceeded, followUpItems };
}

function hostedStripeEnvStatus(
  projectRoot: string,
  target: Exclude<StripeBootstrapTarget, "local">,
): string[] {
  const appDir = path.join(projectRoot, "app");
  const scope = getVercelScope(appDir);
  if (!scope) {
    return [
      "Vercel project is not linked, so bootstrap cannot check hosted Stripe env metadata.",
    ];
  }
  return formatHostedStripeEnvStatus(
    target,
    fetchExistingKeys(scope, { cwd: appDir }),
  );
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
  await detectAndLink(appDir, { assumeYes });
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
    targetLabel: target === "prod" ? "production" : "preview",
  });
  if (!synced) {
    followUpItems.push(
      `Stripe ${target} env values were not fully synced to Vercel — re-run \`${setupCommandForTarget(target)}\` after checking Vercel CLI output`,
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

  const canonicalPriceIds: string[] = [];
  for (const priceDef of definition.prices) {
    const price = await ensurePrice(stripe, product.id, priceDef);
    envValues.set(priceDef.envKey, price.id);
    canonicalPriceIds.push(price.id);
    logSubline(`${priceDef.id}: ${pc.dim(price.id)}`);
  }
  const [defaultPriceId] = canonicalPriceIds;
  if (defaultPriceId) {
    await ensureDefaultProductPrice(stripe, product, defaultPriceId);
  }
  const retiredPrices = await retireNonCatalogPrices(
    stripe,
    product.id,
    canonicalPriceIds,
  );
  if (retiredPrices.length > 0) {
    logSubline(`retired ${retiredPrices.length} non-catalog price(s)`);
  }
  return product.id;
}
