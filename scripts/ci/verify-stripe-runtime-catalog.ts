#!/usr/bin/env tsx
/**
 * Fast, standalone check that the Stripe credentials and catalog CI is about
 * to use actually resolve in Stripe, before spending minutes on Playwright
 * browser setup and a 90+ second checkout redirect timeout.
 *
 * Run directly from the CI job's own env (STRIPE_API_KEY, STRIPE_ATLAS_CATALOG)
 * rather than from a .env.staging file, since CI never checks one out.
 */
import Stripe from "stripe";
import {
  expandStripeCatalogEnv,
  validateStripeApiKeyMode,
} from "../bootstrap/products/atlas/env.js";
import {
  fetchStripeCatalogSnapshot,
  verifyStripeCatalogSnapshot,
} from "../bootstrap/products/atlas/verify.js";

const STRIPE_API_VERSION = "2026-06-24.dahlia";

function envFromProcess(): Map<string, string> {
  const env = new Map<string, string>();
  for (const key of ["STRIPE_API_KEY", "STRIPE_ATLAS_CATALOG"]) {
    const value = process.env[key]?.trim();
    if (value) {
      env.set(key, value);
    }
  }
  return env;
}

async function main(): Promise<void> {
  const env = envFromProcess();
  const apiKey = env.get("STRIPE_API_KEY");
  if (!apiKey) {
    console.log("not ok Stripe runtime catalog");
    console.log("- missing_env STRIPE_API_KEY: STRIPE_API_KEY is missing.");
    process.exitCode = 1;
    return;
  }
  if (!env.get("STRIPE_ATLAS_CATALOG")) {
    console.log("not ok Stripe runtime catalog");
    console.log(
      "- missing_env STRIPE_ATLAS_CATALOG: STRIPE_ATLAS_CATALOG is missing.",
    );
    process.exitCode = 1;
    return;
  }

  validateStripeApiKeyMode(apiKey, "test");

  const expandedEnv = expandStripeCatalogEnv(env);
  const stripe = new Stripe(apiKey, { apiVersion: STRIPE_API_VERSION });
  const snapshot = await fetchStripeCatalogSnapshot(stripe, expandedEnv);
  // The acceptance runner obtains an ephemeral webhook secret from `stripe
  // listen` after this fast catalog preflight. It is not a hosted runtime
  // secret and is intentionally absent here.
  const issues = verifyStripeCatalogSnapshot(env, snapshot, {
    requireWebhookSecret: false,
  });

  if (issues.length === 0) {
    console.log("ok Stripe runtime catalog matches STRIPE_ATLAS_CATALOG");
    return;
  }

  console.log("not ok Stripe runtime catalog");
  for (const catalogIssue of issues) {
    console.log(
      `- ${catalogIssue.code} ${catalogIssue.envKey}: ${catalogIssue.message}`,
    );
  }
  console.log("");
  console.log("Regenerate and re-sync the catalog: pnpm setup:staging");
  process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
