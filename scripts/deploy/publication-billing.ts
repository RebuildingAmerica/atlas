#!/usr/bin/env tsx
import { appendFileSync, readFileSync, lstatSync } from "node:fs";
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

export interface BillingDiagnostic {
  stage: "inputs" | "catalog-read" | "catalog-validation" | "portal-read";
  status: "running" | "pass" | "fail";
  failure?:
    | "permission"
    | "authentication"
    | "connection"
    | "rate-limit"
    | "provider"
    | "invalid-request"
    | "unknown"
    | "validation";
}

function billingFailure(error: unknown): BillingDiagnostic["failure"] {
  const type =
    error && typeof error === "object" && "type" in error
      ? error.type
      : undefined;
  switch (type) {
    case "StripePermissionError":
      return "permission";
    case "StripeAuthenticationError":
      return "authentication";
    case "StripeConnectionError":
      return "connection";
    case "StripeRateLimitError":
      return "rate-limit";
    case "StripeAPIError":
      return "provider";
    case "StripeInvalidRequestError":
      return "invalid-request";
    default:
      return "unknown";
  }
}

/** Read-only preflight protects existing purchases before migrations or provider writes. */
export async function verifyPublicationBilling(
  runtime: Record<string, string>,
  stripe: Stripe | (() => Stripe),
  fetchSnapshot = fetchStripeCatalogSnapshot,
  report: (diagnostic: BillingDiagnostic) => void = () => {},
): Promise<void> {
  let stage: BillingDiagnostic["stage"] = "inputs";
  let failure: BillingDiagnostic["failure"];
  const next = (value: BillingDiagnostic["stage"]) => {
    report({ stage, status: "pass" });
    report({ stage: value, status: "running" });
    return value;
  };
  report({ stage, status: "running" });
  try {
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
    const expanded = expandStripeCatalogEnv(env);
    const client = typeof stripe === "function" ? stripe() : stripe;
    stage = next("catalog-read");
    const snapshot = await fetchSnapshot(client, expanded, webhook);
    stage = next("catalog-validation");
    const issues = verifyStripeTargetSnapshot(env, snapshot, "prod");
    if (issues.length)
      throw new Error(
        "Production Stripe catalog or webhook verification failed.",
      );
    stage = next("portal-read");
    const portal = await assessAtlasPortal(
      client,
      runtime.STRIPE_BILLING_PORTAL_CONFIGURATION,
    );
    if (portal.status !== "pass") {
      if (portal.status === "unverified") {
        failure = "provider";
        throw new Error("Production Stripe portal read failed.");
      }
      throw new Error("Production Stripe portal verification failed.");
    }
    report({ stage, status: "pass" });
  } catch (error) {
    // Portal assessment deliberately suppresses provider details itself.
    report({
      stage,
      status: "fail",
      failure:
        failure ??
        (stage === "catalog-read" ? billingFailure(error) : "validation"),
    });
    throw error;
  }
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
    () =>
      new Stripe(runtimeValue(settings, "STRIPE_API_KEY"), {
        apiVersion: "2026-06-24.dahlia",
      }),
    fetchStripeCatalogSnapshot,
    (diagnostic) => {
      const file = process.env.ATLAS_PUBLICATION_BILLING_DIAGNOSTICS_FILE;
      if (file)
        appendFileSync(file, `${JSON.stringify(diagnostic)}\n`, {
          mode: 0o600,
        });
    },
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
