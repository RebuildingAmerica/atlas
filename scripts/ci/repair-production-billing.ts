#!/usr/bin/env tsx
/** Repair only the existing live Atlas billing endpoint and customer portal. */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import Stripe from "stripe";
import { STRIPE_BILLING_WEBHOOK_EVENTS } from "../bootstrap/config/products.js";
import { ensureBillingWebhookEndpoint } from "../bootstrap/products/atlas/catalog.js";
import {
  parseStripeCatalogEnvValue,
  stripeWebhookUrlForOrigin,
  validateStripeApiKeyMode,
} from "../bootstrap/products/atlas/env.js";
import { ensureBillingPortalConfiguration } from "../bootstrap/products/atlas/portal.js";
import { assessAtlasPortal } from "./verify-production-billing.js";

const PRODUCTION_ORIGIN = "https://atlas.rebuildingus.org";

export function requireProductionBillingTarget(
  apiKey: string,
  publicOrigin: string,
): void {
  validateStripeApiKeyMode(apiKey, "live");
  const origin = new URL(publicOrigin);
  if (origin.origin !== PRODUCTION_ORIGIN || origin.pathname !== "/") {
    throw new Error(
      "Production billing repair is limited to the Atlas public origin.",
    );
  }
}

export async function repairProductionBilling(
  stripe: Stripe,
  publicOrigin: string,
  catalogRaw: string,
  configuredPortalId?: string,
): Promise<{ portalId: string; webhookId: string }> {
  const account = await stripe.accounts.retrieveCurrent();
  if (!account.charges_enabled) {
    throw new Error(
      "The selected live Stripe account cannot currently charge.",
    );
  }
  await requireLiveAtlasCatalog(stripe, catalogRaw);

  const webhook = await ensureBillingWebhookEndpoint(
    stripe,
    stripeWebhookUrlForOrigin(publicOrigin),
    { requireExisting: true, requireLive: true },
  );
  const portal = await ensureBillingPortalConfiguration(
    stripe,
    publicOrigin,
    configuredPortalId,
  );

  await verifyProductionBillingRepair(
    stripe,
    publicOrigin,
    portal.id,
    webhook.endpoint.id,
  );
  return { portalId: portal.id, webhookId: webhook.endpoint.id };
}

async function requireLiveAtlasCatalog(
  stripe: Stripe,
  catalogRaw: string,
): Promise<void> {
  const catalog = parseStripeCatalogEnvValue(catalogRaw);
  const proId = catalog.products.pro?.trim();
  if (!proId) {
    throw new Error("The production Atlas catalog lacks its Pro product.");
  }
  const product = await stripe.products.retrieve(proId);
  if (!product.livemode || product.metadata?.atlas_product_id !== "pro") {
    throw new Error(
      "The selected live Stripe account lacks the catalog's live Atlas Pro product.",
    );
  }
}

export async function verifyProductionBillingRepair(
  stripe: Stripe,
  publicOrigin: string,
  portalId: string,
  webhookId?: string,
): Promise<void> {
  const expectedWebhookUrl = stripeWebhookUrlForOrigin(publicOrigin);
  let selectedWebhookId = webhookId;
  if (!selectedWebhookId) {
    const endpoints: Stripe.WebhookEndpoint[] = [];
    for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
      if (
        endpoint.url === expectedWebhookUrl &&
        endpoint.status !== "disabled"
      ) {
        endpoints.push(endpoint);
      }
    }
    if (endpoints.length !== 1) {
      throw new Error("Exactly one enabled Atlas billing webhook must exist.");
    }
    selectedWebhookId = endpoints[0]?.id;
  }
  if (!selectedWebhookId) {
    throw new Error("The Atlas billing webhook ID is missing.");
  }
  const [webhookReadback, portalCheck] = await Promise.all([
    stripe.webhookEndpoints.retrieve(selectedWebhookId),
    assessAtlasPortal(stripe, portalId),
  ]);
  const actualEvents = new Set(webhookReadback.enabled_events);
  if (
    webhookReadback.status !== "enabled" ||
    !webhookReadback.livemode ||
    webhookReadback.url !== expectedWebhookUrl ||
    webhookReadback.metadata?.atlas_webhook !== "billing" ||
    actualEvents.size !== STRIPE_BILLING_WEBHOOK_EVENTS.length ||
    STRIPE_BILLING_WEBHOOK_EVENTS.some((event) => !actualEvents.has(event))
  ) {
    throw new Error(
      "Stripe did not retain the expected Atlas webhook configuration.",
    );
  }
  if (portalCheck.status !== "pass") {
    throw new Error(
      "Stripe did not retain the required Atlas customer portal controls.",
    );
  }
}

async function main(): Promise<void> {
  const command = process.argv.slice(2).join(" ");
  if (command !== "--apply" && command !== "--verify") {
    throw new Error("Production billing repair requires --apply or --verify.");
  }
  const apiKey = process.env.STRIPE_API_KEY?.trim() ?? "";
  const publicOrigin = process.env.ATLAS_PUBLIC_URL?.trim() ?? "";
  const outputFile = process.env.ATLAS_PORTAL_ID_FILE?.trim() ?? "";
  if (
    (command === "--apply" && !outputFile) ||
    !process.env.STRIPE_WEBHOOK_SECRET?.trim()
  ) {
    throw new Error(
      "Production billing repair requires its protected output and signing-secret settings.",
    );
  }
  requireProductionBillingTarget(apiKey, publicOrigin);
  const stripe = new Stripe(apiKey, { apiVersion: "2026-06-24.dahlia" });
  const catalogRaw = process.env.STRIPE_ATLAS_CATALOG?.trim() ?? "";
  if (command === "--verify") {
    const portalId = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION?.trim();
    if (!portalId) {
      throw new Error("The Atlas portal ID is not set in Vercel Production.");
    }
    await requireLiveAtlasCatalog(stripe, catalogRaw);
    await verifyProductionBillingRepair(stripe, publicOrigin, portalId);
    process.stdout.write(
      "Vercel Production points to the verified live Atlas portal and webhook. This command did not open checkout.\n",
    );
    return;
  }
  const result = await repairProductionBilling(
    stripe,
    publicOrigin,
    catalogRaw,
    process.env.STRIPE_BILLING_PORTAL_CONFIGURATION,
  );
  writeFileSync(outputFile, result.portalId, { mode: 0o600 });
  process.stdout.write(
    "The existing live Atlas webhook and customer portal passed Stripe read-back. This command did not open checkout.\n",
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    const status =
      typeof error === "object" && error !== null && "statusCode" in error
        ? error.statusCode
        : null;
    if (status === 403) {
      console.error(
        "The live Stripe key lacks a required webhook or portal permission.",
      );
    } else if (status === 401) {
      console.error("Stripe rejected the configured live key.");
    } else if (error instanceof Error && !error.name.includes("Stripe")) {
      console.error(error.message);
    } else {
      console.error(
        "Production billing repair failed; inspect Stripe privately.",
      );
    }
    process.exitCode = 1;
  });
}
