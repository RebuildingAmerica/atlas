import path from "node:path";
import type Stripe from "stripe";
import { log, note, password } from "@clack/prompts";
import pc from "picocolors";
import { mergeEnvFile, parseEnvFile } from "../../lib/env-file.js";
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
  resolveStripeEnvFileTargets,
  resolveStripeMode,
  STRIPE_BILLING_PORTAL_CONFIGURATION_ENV_KEY,
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
  formatStripeAccountVerificationFailure,
  formatStripeApiKeyPromptMessage,
  formatStripeMissingApiKeyGuidance,
  setupCommandForTarget,
  stripeDoctorFollowUp,
} from "./stripe-copy.js";
import { resolveWebhookSecret } from "./stripe-webhook-secret.js";
import { ensureBillingPortalConfiguration } from "./portal.js";

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
  if (!apiKey) {
    if (doctorMode) {
      log.warn("Stripe API key not found");
      for (const guidanceLine of formatStripeMissingApiKeyGuidance({
        apiKeyResolutionNotes,
        hostedEnvStatus: [],
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
                ...stripeDoctorFollowUp(target, envMode),
              ]
            : [missingKeyFollowUp],
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

  const targetEnvFile = envFileTargets[0];
  if (!targetEnvFile) throw new Error("Missing Stripe environment target.");
  const targetEnv = parseEnvFile(targetEnvFile);
  const publicOrigin = targetEnv.get("ATLAS_PUBLIC_URL")?.trim();
  let portalConfigurationId: string | null = null;
  try {
    if (!publicOrigin && target !== "local") {
      throw new Error("ATLAS_PUBLIC_URL is required for the customer portal.");
    }
    const portal = await ensureBillingPortalConfiguration(
      stripe,
      publicOrigin || "https://atlas.localhost",
      targetEnv.get(STRIPE_BILLING_PORTAL_CONFIGURATION_ENV_KEY),
    );
    portalConfigurationId = portal.id;
    logSubline(`Atlas billing portal: ${pc.dim(portal.id)}`);
  } catch {
    log.error("Failed to configure the Atlas billing portal.");
    followUpItems.push(
      "Check Stripe portal permissions and the Atlas public URL, then re-run bootstrap.",
    );
    allSucceeded = false;
  }

  const envUpdates = buildStripeEnvUpdates(
    apiKey,
    webhookSecret,
    stripeIds,
    portalConfigurationId,
  );
  for (const envFile of envFileTargets) {
    mergeEnvFile(envFile, envUpdates);
    log.success(
      `Wrote ${envUpdates.size} Stripe values to ${pc.dim(path.relative(projectRoot, envFile))}`,
    );
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
