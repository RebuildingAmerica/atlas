import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const CHECK_NAMES = [
  "Runtime key",
  "Charge-enabled account",
  "Stripe Tax",
  "Customer portal",
  "Catalog IDs",
  "Webhook endpoint metadata",
];
const STATUSES = new Set(["pass", "fail", "unverified"]);
const PORTAL_REASONS = new Set([
  "portal_unreadable",
  "portal_configuration_missing",
  "portal_metadata_mismatch",
  "portal_inactive",
  "portal_not_live",
  "portal_invoice_history_disabled",
  "portal_payment_update_disabled",
  "portal_cancellation_disabled",
  "portal_cancellation_mode_wrong",
  "portal_plan_change_enabled",
]);
const WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "refund.created",
  "refund.updated",
];
const WEBHOOK_REASONS = new Set([
  "webhook_public_url_invalid",
  "webhook_signing_secret_missing",
  "webhook_list_incomplete",
  "webhook_missing",
  "webhook_disabled",
  "webhook_metadata_missing",
  "webhook_unreadable",
  ...WEBHOOK_EVENTS.map((event) => `webhook_event_missing:${event}`),
]);
const REASONS_BY_CHECK = new Map([
  ["Customer portal", PORTAL_REASONS],
  ["Webhook endpoint metadata", WEBHOOK_REASONS],
]);

export function runtimeInventoryPasses(payload, expectedRevision) {
  return (
    /^[a-f0-9]{40}$/i.test(expectedRevision) &&
    typeof payload?.revision === "string" &&
    payload.revision.toLowerCase() === expectedRevision.toLowerCase() &&
    Array.isArray(payload.checks) &&
    payload.checks.length === CHECK_NAMES.length &&
    CHECK_NAMES.every(
      (name) =>
        payload.checks.filter(
          (check) => check?.name === name && check.status === "pass",
        ).length === 1,
    )
  );
}

/** Accept only the fixed, redacted inventory schema from the exact release. */
export function renderRuntimeBillingReport(payload, expectedRevision) {
  const lines = [
    "## Deployed Stripe runtime inventory",
    "",
    "| Check | Status | Fixed diagnostic codes |",
    "| --- | --- | --- |",
  ];
  if (
    !/^[a-f0-9]{40}$/i.test(expectedRevision) ||
    typeof payload?.revision !== "string" ||
    payload.revision.toLowerCase() !== expectedRevision.toLowerCase()
  ) {
    lines.push("| Revision mismatch | unverified | — |");
  } else {
    for (const name of CHECK_NAMES) {
      const matches = Array.isArray(payload.checks)
        ? payload.checks.filter((item) => item?.name === name)
        : [];
      const check = matches.length === 1 ? matches[0] : undefined;
      const status = STATUSES.has(check?.status) ? check.status : "unverified";
      const allowedReasons = REASONS_BY_CHECK.get(name);
      const reasons =
        status !== "pass" && Array.isArray(check?.reasonCodes) && allowedReasons
          ? [
              ...new Set(
                check.reasonCodes.filter((code) => allowedReasons.has(code)),
              ),
            ]
          : [];
      lines.push(
        `| ${name} | ${status} | ${reasons.length > 0 ? reasons.join(", ") : "—"} |`,
      );
    }
  }
  lines.push(
    "",
    "This read-only check does not prove catalog amounts, a completed charge, signed webhook delivery, entitlement, cancellation, or refund.",
    "",
  );
  return lines.join("\n");
}

async function main() {
  const origin = process.env.ATLAS_HOSTED_PUBLIC_URL?.trim();
  const secret = process.env.ATLAS_HOSTED_E2E_SECRET?.trim();
  const revision = process.env.ATLAS_ASSESSED_RELEASE_SHA?.trim();
  if (!origin || !secret || !revision) {
    throw new Error(
      "Billing runtime inventory cannot run without its protected release inputs.",
    );
  }
  const headers = { "x-atlas-hosted-e2e-secret": secret };
  const bypass = process.env.ATLAS_HOSTED_VERCEL_BYPASS_SECRET?.trim();
  const oidc = process.env.ATLAS_HOSTED_VERCEL_TRUSTED_OIDC_TOKEN?.trim();
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;
  if (oidc) headers["x-vercel-trusted-oidc-idp-token"] = oidc;

  const response = await fetch(
    new URL("/api/e2e/hosted/billing-inventory", origin),
    {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Protected billing inventory returned HTTP ${response.status}.`,
    );
  }
  const payload = await response.json();
  const report = renderRuntimeBillingReport(payload, revision);
  process.stdout.write(report);
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
  }
  if (!runtimeInventoryPasses(payload, revision)) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => {
    console.error(
      "Protected billing runtime inventory could not complete; no credential values were printed.",
    );
    process.exitCode = 1;
  });
}
