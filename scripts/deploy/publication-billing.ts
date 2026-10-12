#!/usr/bin/env tsx
import { readFileSync, lstatSync } from "node:fs";
import { pathToFileURL } from "node:url";
import Stripe from "stripe";
import {
  expandStripeCatalogEnv,
  validateStripeApiKeyMode,
} from "../bootstrap/products/atlas/env.js";
import { fetchStripeCatalogSnapshot } from "../bootstrap/products/atlas/verify.js";
import { verifyStripeTargetSnapshot } from "../bootstrap/products/atlas/verify-catalog.js";
import { assessAtlasPortal } from "../ci/verify-production-billing.js";

function runtimeValue(runtime: Record<string, string>, key: string): string {
  const value = runtime[key];
  if (!value?.trim())
    throw new Error(`Production billing setting missing: ${key}.`);
  return value;
}

/** Read-only preflight protects existing purchases before migrations or provider writes. */
export async function verifyPublicationBilling(
  runtime: Record<string, string>,
  stripe: Stripe,
  fetchSnapshot = fetchStripeCatalogSnapshot,
): Promise<void> {
  for (const key of [
    "STRIPE_API_KEY",
    "STRIPE_ATLAS_CATALOG",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_BILLING_PORTAL_CONFIGURATION",
  ])
    if (!runtime[key]?.trim())
      throw new Error(`Production billing setting missing: ${key}.`);
  // Closing new sales must not prevent existing customers from retaining billing access.
  // An empty allowlist is accepted only with an explicit closed-checkout setting;
  // the live catalog, webhook and customer portal checks still run below.
  if (
    !runtime.ATLAS_BILLING_ALLOWED_OFFERS?.trim() &&
    runtime.ATLAS_BILLING_CHECKOUT_ENABLED?.trim().toLowerCase() !== "false"
  )
    throw new Error(
      "Production billing setting missing: ATLAS_BILLING_ALLOWED_OFFERS.",
    );
  const env = new Map(Object.entries(runtime));
  const apiKey = runtimeValue(runtime, "STRIPE_API_KEY");
  validateStripeApiKeyMode(apiKey, "live");
  // Preserve customer billing access without granting the application account-wide access.
  if (!apiKey.trim().startsWith("rk_live_"))
    throw new Error("Production billing requires a restricted live key.");
  const webhook = new URL(
    "/api/stripe/webhook",
    runtimeValue(runtime, "ATLAS_PUBLIC_URL"),
  ).href;
  const snapshot = await fetchSnapshot(
    stripe,
    expandStripeCatalogEnv(env),
    webhook,
  );
  const issues = verifyStripeTargetSnapshot(env, snapshot, "prod");
  if (issues.length)
    throw new Error(
      "Production Stripe catalog or webhook verification failed.",
    );
  const portal = await assessAtlasPortal(
    stripe,
    runtime.STRIPE_BILLING_PORTAL_CONFIGURATION,
  );
  if (portal.status !== "pass")
    throw new Error("Production Stripe portal verification failed.");
}
async function main(): Promise<void> {
  const file = process.env.ATLAS_WEB_RUNTIME_FILE;
  if (!file) throw new Error("Private runtime file required.");
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
    throw new Error("Owner-only runtime file required.");
  const runtime: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (
    !runtime ||
    typeof runtime !== "object" ||
    Array.isArray(runtime) ||
    Object.values(runtime).some((value) => typeof value !== "string")
  )
    throw new Error("Runtime configuration strings required.");
  const settings = runtime as Record<string, string>;
  await verifyPublicationBilling(
    settings,
    new Stripe(runtimeValue(settings, "STRIPE_API_KEY"), {
      apiVersion: "2026-06-24.dahlia",
    }),
  );
  console.log(
    "Production billing settings, catalog, webhook and portal preflight passed.",
  );
}
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href)
  main().catch((error: unknown) => {
    // Provider errors can include customer/configuration values. Never print them.
    const message = error instanceof Error ? error.message : "";
    console.error(
      /^Production billing setting missing: [A-Z_]+\.$/.test(message)
        ? message
        : "Production billing preflight failed; private diagnostics suppressed.",
    );
    process.exitCode = 1;
  });
