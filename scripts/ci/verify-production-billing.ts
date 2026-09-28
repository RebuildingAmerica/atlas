#!/usr/bin/env tsx
/** Read-only inventory of the Stripe objects used by the deployed Atlas app. */
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import Stripe from "stripe";
import {
  expandStripeCatalogEnv,
  validateStripeApiKeyMode,
} from "../bootstrap/products/atlas/env.js";
import { verifyStripeTargetSnapshot } from "../bootstrap/products/atlas/verify-catalog.js";
import { fetchStripeCatalogSnapshot } from "../bootstrap/products/atlas/verify.js";
import { expectedWebhookUrlForEnv } from "../bootstrap/products/atlas/verify-webhook.js";

type CheckStatus = "pass" | "fail" | "unverified";

interface Check {
  name: string;
  status: CheckStatus;
  detail: string;
}

const offeredPairs = new Set([
  "atlas_pro:monthly",
  "atlas_pro:yearly",
  "atlas_pro:four_month",
  "atlas_team:monthly",
  "atlas_team:yearly",
  "atlas_research_pass:weekly",
  "atlas_research_pass:once",
]);

const runtimeKeys = [
  "STRIPE_API_KEY",
  "STRIPE_ATLAS_CATALOG",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_BILLING_PORTAL_CONFIGURATION",
  "ATLAS_PUBLIC_URL",
  "ATLAS_BILLING_ALLOWED_OFFERS",
] as const;

function runtimeEnv(): Map<string, string> {
  return new Map(
    runtimeKeys.map((key) => [key, process.env[key]?.trim() ?? ""]),
  );
}

function configuredByName(key: string): boolean {
  return process.env[`ATLAS_VERCEL_${key}_PRESENT`] === "true";
}

export function assessUnreadableRuntimeKey(configured: boolean): Check {
  return {
    name: "Runtime key",
    status: configured ? "unverified" : "fail",
    detail: configured
      ? "Configured by name, but the sensitive value is not readable in this CLI job. This does not prove the deployed key is absent or invalid."
      : "STRIPE_API_KEY is not configured for Vercel Production.",
  };
}

function providerFailure(error: unknown): string {
  // Stripe's message can contain customer or object identifiers. Never print it.
  const status =
    typeof error === "object" && error !== null && "statusCode" in error
      ? error.statusCode
      : null;
  if (status === 401) return "Stripe rejected the runtime credential.";
  if (status === 403) return "The runtime credential lacks read permission.";
  if (status === 404) return "A referenced Stripe object was not found.";
  return "The read-only Stripe request failed; inspect the provider privately.";
}

export function assessOfferGate(
  flag: string | undefined,
  rawOffers: string | undefined,
): Check {
  if (flag !== "true") {
    return {
      name: "New-sale gate",
      status: "fail",
      detail:
        "Production checkout is closed. This is the safe current state, not paid readiness.",
    };
  }
  const offers = (rawOffers ?? "")
    .split(",")
    .map((offer) => offer.trim())
    .filter(Boolean);
  if (
    offers.length === 0 ||
    new Set(offers).size !== offers.length ||
    offers.some((offer) => !offeredPairs.has(offer))
  ) {
    return {
      name: "New-sale gate",
      status: "fail",
      detail:
        "The enabled offer allowlist is empty, duplicated, or contains an unknown offer.",
    };
  }
  return {
    name: "New-sale gate",
    status: "unverified",
    detail: `${offers.length} offer(s) configured; each still needs its own payment lifecycle proof.`,
  };
}

export function renderReport(
  checks: readonly Check[],
  revision: string,
  tag = "unknown",
): string {
  const decision = checks.every((check) => check.status === "pass")
    ? "PASS"
    : "NO-GO";
  const safeRevision = /^[a-f0-9]{7,40}$/i.test(revision)
    ? revision
    : "unknown";
  const safeTag = /^v\d{4}\.\d{2}\.\d{2}-\d+$/.test(tag) ? tag : "unknown";
  const lines = [
    "# Atlas production billing inventory",
    "",
    `Release under review: \`${safeTag}\` (\`${safeRevision}\`)`,
    `Checked at: ${new Date().toISOString()}`,
    `Paid-launch decision: **${decision}**`,
    "",
    "| Check | Status | Evidence or remaining proof |",
    "| --- | --- | --- |",
    ...checks.map(
      (check) => `| ${check.name} | ${check.status} | ${check.detail} |`,
    ),
    "",
    "This is a read-only configuration inventory. It does not make a charge, deliver a signed webhook, or prove entitlement, cancellation, renewal, or refund.",
  ];
  return `${lines.join("\n")}\n`;
}

function appendManualProof(checks: Check[]): Check[] {
  checks.push(
    {
      name: "Signed webhook delivery",
      status: "unverified",
      detail:
        "Endpoint metadata cannot prove signing-secret match or delivered events.",
    },
    {
      name: "Live purchase lifecycle",
      status: "unverified",
      detail:
        "Requires a genuine buyer payment, returning access, cancellation or expiry, and refund observation.",
    },
    {
      name: "Runtime write permissions",
      status: "unverified",
      detail:
        "Read-only inspection cannot prove Checkout, portal-session, seat-change, or refund permissions.",
    },
  );
  return checks;
}

function appendUnreadableRuntimeChecks(checks: Check[]): Check[] {
  for (const name of [
    "Charge-enabled account",
    "Catalog and webhook configuration",
    "Stripe Tax settings",
    "Atlas customer portal",
  ]) {
    checks.push({
      name,
      status: "unverified",
      detail:
        "The runtime key was not readable in this CLI job; inspect inside an authorized runtime.",
    });
  }
  return appendManualProof(checks);
}

async function inspect(): Promise<Check[]> {
  const env = runtimeEnv();
  const checks: Check[] = [
    assessOfferGate(
      process.env.ATLAS_PRODUCTION_CHECKOUT_FLAG,
      env.get("ATLAS_BILLING_ALLOWED_OFFERS"),
    ),
  ];
  const readableOffers = env.get("ATLAS_BILLING_ALLOWED_OFFERS");
  checks.push({
    name: "Offer allowlist setting",
    status: readableOffers
      ? "pass"
      : configuredByName("ATLAS_BILLING_ALLOWED_OFFERS")
        ? "unverified"
        : "fail",
    detail: readableOffers
      ? "A Production value is readable; only accepted offers may be enabled."
      : configuredByName("ATLAS_BILLING_ALLOWED_OFFERS")
        ? "Configured by name, but its sensitive value is not readable in this CLI job."
        : "ATLAS_BILLING_ALLOWED_OFFERS is not configured for Vercel Production.",
  });
  const apiKey = env.get("STRIPE_API_KEY");
  if (!apiKey) {
    checks.push(assessUnreadableRuntimeKey(configuredByName("STRIPE_API_KEY")));
    return appendUnreadableRuntimeChecks(checks);
  }
  try {
    validateStripeApiKeyMode(apiKey, "live");
    checks.push({
      name: "Runtime key",
      status: "pass",
      detail: "A live-mode key is configured.",
    });
  } catch {
    checks.push({
      name: "Runtime key",
      status: "fail",
      detail: "The configured key is not live-mode.",
    });
    return appendUnreadableRuntimeChecks(checks);
  }

  const stripe = new Stripe(apiKey, { apiVersion: "2026-06-24.dahlia" });
  try {
    const account = await stripe.accounts.retrieveCurrent();
    checks.push({
      name: "Charge-enabled account",
      status: account.charges_enabled ? "pass" : "fail",
      detail: `Account ending ${account.id.slice(-4)}; charges ${account.charges_enabled ? "enabled" : "disabled"}. Confirm its legal identity in Stripe Dashboard.`,
    });
  } catch (error) {
    checks.push({
      name: "Charge-enabled account",
      status: "unverified",
      detail: providerFailure(error),
    });
  }

  if (
    !env.get("STRIPE_ATLAS_CATALOG") ||
    !env.get("STRIPE_WEBHOOK_SECRET") ||
    !env.get("ATLAS_PUBLIC_URL")
  ) {
    const catalogNamesPresent = [
      "STRIPE_ATLAS_CATALOG",
      "STRIPE_WEBHOOK_SECRET",
    ].every(configuredByName);
    checks.push({
      name: "Catalog and webhook configuration",
      status: catalogNamesPresent ? "unverified" : "fail",
      detail: catalogNamesPresent
        ? "Catalog and webhook secret are configured by name, but values are not readable here."
        : "A required Production catalog or webhook-secret setting is not configured by name.",
    });
  } else {
    try {
      const snapshot = await fetchStripeCatalogSnapshot(
        stripe,
        expandStripeCatalogEnv(env),
        expectedWebhookUrlForEnv(env, "prod"),
      );
      const issues = verifyStripeTargetSnapshot(env, snapshot, "prod");
      const safeIssueNames = issues.map(
        (issue) =>
          `${issue.code.replace(/[^a-z_]/g, "")}:${issue.envKey.replace(/[^A-Z0-9_]/g, "")}`,
      );
      checks.push({
        name: "Catalog and webhook configuration",
        status: issues.length === 0 ? "pass" : "fail",
        detail:
          issues.length === 0
            ? "Canonical products, prices, coupons, and endpoint metadata match the live account."
            : `${issues.length} catalog or endpoint issue(s): ${safeIssueNames.join(", ")}.`,
      });
    } catch (error) {
      checks.push({
        name: "Catalog and webhook configuration",
        status: "unverified",
        detail: providerFailure(error),
      });
    }
  }

  try {
    const settings = await stripe.tax.settings.retrieve();
    checks.push({
      name: "Stripe Tax settings",
      status:
        settings.livemode && settings.status === "active" ? "pass" : "fail",
      detail:
        settings.livemode && settings.status === "active"
          ? "Live Tax settings are active; registrations still require human review."
          : "Live Tax settings are not active.",
    });
  } catch (error) {
    checks.push({
      name: "Stripe Tax settings",
      status: "unverified",
      detail: providerFailure(error),
    });
  }

  checks.push(
    await assessAtlasPortal(
      stripe,
      env.get("STRIPE_BILLING_PORTAL_CONFIGURATION"),
    ),
  );

  return appendManualProof(checks);
}

export async function assessAtlasPortal(
  stripe: Stripe,
  configurationId?: string,
): Promise<Check> {
  if (!configurationId?.trim()) {
    return {
      name: "Atlas customer portal",
      status: "fail",
      detail:
        "The Atlas portal configuration ID is missing from the runtime settings.",
    };
  }
  try {
    const portal = await stripe.billingPortal.configurations.retrieve(
      configurationId.trim(),
    );
    const usable =
      portal.id === configurationId.trim() &&
      portal.metadata?.atlas_portal === "billing" &&
      portal.active &&
      portal.livemode &&
      portal.features.invoice_history.enabled &&
      portal.features.payment_method_update.enabled &&
      portal.features.subscription_cancel.enabled &&
      portal.features.subscription_cancel.mode === "at_period_end" &&
      !portal.features.subscription_update?.enabled;
    return {
      name: "Atlas customer portal",
      status: usable ? "pass" : "fail",
      detail: usable
        ? "The live Atlas portal permits invoices, payment-method changes, and end-of-term cancellation."
        : "The Atlas portal lacks a required customer exit or account-management control.",
    };
  } catch (error) {
    return {
      name: "Atlas customer portal",
      status: "unverified",
      detail: providerFailure(error),
    };
  }
}

async function main(): Promise<void> {
  const checks = await inspect();
  const report = renderReport(
    checks,
    process.env.ATLAS_ASSESSED_RELEASE_SHA ?? "unknown",
    process.env.ATLAS_ASSESSED_RELEASE_TAG ?? "unknown",
  );
  process.stdout.write(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  }
  if (checks.some((check) => check.status !== "pass")) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    console.error(
      "Production billing inventory could not complete. No secret values were printed.",
    );
    process.exitCode = 1;
  });
}
