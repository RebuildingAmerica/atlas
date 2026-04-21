import path from "node:path";
import Stripe from "stripe";
import { log, spinner, password } from "@clack/prompts";
import pc from "picocolors";
import type { PhaseResult } from "../../lib/types.js";
import { mergeEnvFile } from "../../lib/env-file.js";
import { logSubline, promptOrExit } from "../../lib/ui.js";
import type { ReadinessState } from "../../state.js";
import { markPhase } from "../../state.js";
import {
  resolveStripeApiKey,
  isStripeCliAuthenticated,
  runStripeCli,
} from "../stripe-cli-client.js";
import {
  ensureProduct,
  ensurePrice,
  archiveProduct,
  fetchExistingPrices,
} from "./catalog.js";
import { ATLAS_PRODUCTS } from "../../config/products.js";
import type { AtlasProductDefinition } from "../../config/products.js";

/**
 * Phase 6: Stripe product sync orchestrator.
 *
 * Ensures all Atlas products and prices exist in Stripe and writes the
 * resulting IDs into the project env files.
 */
export async function runProductPhase(
  projectRoot: string,
  state: ReadinessState,
  doctorMode: boolean,
  live: boolean,
): Promise<PhaseResult> {
  const followUpItems: string[] = [];
  const envMode = live ? "live" : "test";

  // Step 1: Resolve Stripe API key
  let apiKey = resolveStripeApiKey(projectRoot, live);

  if (!apiKey) {
    if (doctorMode) {
      log.warn("Stripe API key not found");
      logSubline(
        "Set STRIPE_API_KEY in .env or authenticate via: stripe login",
      );
      markPhase(state, "product", "failed", "Missing Stripe API key");
      return {
        success: false,
        followUpItems: [
          "Set STRIPE_API_KEY in .env or run `stripe login`",
        ],
      };
    }

    // Prompt the user for the key
    const prompted = await promptOrExit(
      password({
        message: `Stripe ${envMode} mode secret key (sk_${envMode}_...)`,
      }),
    );

    if (typeof prompted !== "string" || !prompted.trim()) {
      log.warn("Stripe API key not provided -- skipping product sync");
      markPhase(state, "product", "skipped", "No API key provided");
      return {
        success: false,
        followUpItems: [
          "Set STRIPE_API_KEY in .env or run `stripe login`, then re-run bootstrap",
        ],
      };
    }

    apiKey = prompted.trim();
  }

  // Step 2: Initialize Stripe SDK client
  const stripe = new Stripe(apiKey, {
    apiVersion: "2025-03-31.basil",
  });

  // Step 3: Display account context
  const s = spinner();
  s.start("Verifying Stripe account...");

  let accountName: string;
  try {
    const account = await stripe.accounts.retrieve();
    accountName =
      account.settings?.dashboard?.display_name ??
      account.business_profile?.name ??
      account.id;
    s.stop(`Stripe account: ${pc.cyan(accountName)} (${envMode} mode)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    s.stop("Failed to verify Stripe account");
    log.error(message);
    markPhase(state, "product", "failed", message);
    return {
      success: false,
      followUpItems: ["Fix Stripe API key and re-run bootstrap"],
    };
  }

  // Step 4: Process each product definition
  const envValues = new Map<string, string>();
  let allSucceeded = true;

  for (const definition of ATLAS_PRODUCTS) {
    try {
      switch (definition.action) {
        case "keep": {
          await processKeepProduct(stripe, definition, envValues);
          break;
        }
        case "create": {
          await processCreateProduct(stripe, definition, envValues);
          break;
        }
        case "archive": {
          await processArchiveProduct(stripe, definition);
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(
        `Failed to process product "${definition.stripeName}": ${message}`,
      );
      followUpItems.push(
        `Manually sync Stripe product "${definition.stripeName}" (${definition.id})`,
      );
      allSucceeded = false;
    }
  }

  // Step 5 & 6: Write env var values to env files
  if (envValues.size > 0) {
    const productionEnvPath = path.join(projectRoot, ".env.production");
    const appEnvLocalPath = path.join(projectRoot, "app", ".env.local");

    mergeEnvFile(productionEnvPath, envValues);
    log.success(
      `Wrote ${envValues.size} Stripe IDs to ${pc.dim(".env.production")}`,
    );

    mergeEnvFile(appEnvLocalPath, envValues);
    log.success(
      `Wrote ${envValues.size} Stripe IDs to ${pc.dim("app/.env.local")}`,
    );
  }

  // Step 7: Mark phase and return
  const status = allSucceeded ? "complete" : "partial";
  markPhase(state, "product", status, `${envValues.size} env vars written`);

  if (!allSucceeded) {
    followUpItems.push(
      "Re-run product bootstrap to retry failed product syncs",
    );
  }

  return { success: allSucceeded, followUpItems };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function processKeepProduct(
  stripe: Stripe,
  definition: AtlasProductDefinition,
  envValues: Map<string, string>,
): Promise<void> {
  const productId = definition.existingProductId;
  if (!productId) {
    throw new Error(
      `Product "${definition.id}" has action "keep" but no existingProductId`,
    );
  }

  // Verify the product exists in Stripe
  const product = await stripe.products.retrieve(productId);
  log.success(
    `${pc.bold(definition.stripeName)} -- verified (${pc.dim(productId)})`,
  );

  envValues.set(definition.envProductKey, productId);

  // Fetch existing prices and record their IDs
  const existingPrices = await fetchExistingPrices(stripe, productId);

  for (const priceDef of definition.prices) {
    // Try to match by metadata first, fall back to searching all existing prices
    const matchedPrice = existingPrices.find(
      (p) => p.metadata?.atlas_price_id === priceDef.id,
    );

    if (matchedPrice) {
      envValues.set(priceDef.envKey, matchedPrice.id);
      logSubline(
        `${priceDef.id}: ${pc.dim(matchedPrice.id)} (existing)`,
      );
    } else {
      // Create the price if it doesn't exist yet
      const newPrice = await ensurePrice(stripe, productId, priceDef);
      envValues.set(priceDef.envKey, newPrice.id);
      logSubline(`${priceDef.id}: ${pc.dim(newPrice.id)} (created)`);
    }
  }
}

async function processCreateProduct(
  stripe: Stripe,
  definition: AtlasProductDefinition,
  envValues: Map<string, string>,
): Promise<void> {
  const product = await ensureProduct(stripe, definition);
  const isNew = !definition.existingProductId;
  const label = isNew ? "created" : "existing";

  log.success(
    `${pc.bold(definition.stripeName)} -- ${label} (${pc.dim(product.id)})`,
  );
  envValues.set(definition.envProductKey, product.id);

  // Ensure each price exists
  for (const priceDef of definition.prices) {
    const price = await ensurePrice(stripe, product.id, priceDef);
    envValues.set(priceDef.envKey, price.id);
    logSubline(`${priceDef.id}: ${pc.dim(price.id)}`);
  }
}

async function processArchiveProduct(
  stripe: Stripe,
  definition: AtlasProductDefinition,
): Promise<void> {
  const productId = definition.existingProductId;
  if (!productId) {
    throw new Error(
      `Product "${definition.id}" has action "archive" but no existingProductId`,
    );
  }

  try {
    const product = await stripe.products.retrieve(productId);
    if (product.active) {
      await archiveProduct(stripe, productId);
      log.success(
        `${pc.bold(definition.stripeName)} -- archived (${pc.dim(productId)})`,
      );
    } else {
      logSubline(
        `${definition.stripeName}: already archived (${pc.dim(productId)})`,
      );
    }
  } catch (err) {
    // Product may not exist (e.g. different environment) -- that's fine
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("No such product")) {
      logSubline(
        `${definition.stripeName}: not found, nothing to archive`,
      );
    } else {
      throw err;
    }
  }
}
