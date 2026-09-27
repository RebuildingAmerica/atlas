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
    "| Check | Status |",
    "| --- | --- |",
  ];
  if (
    !/^[a-f0-9]{40}$/i.test(expectedRevision) ||
    typeof payload?.revision !== "string" ||
    payload.revision.toLowerCase() !== expectedRevision.toLowerCase()
  ) {
    lines.push("| Revision mismatch | unverified |");
  } else {
    for (const name of CHECK_NAMES) {
      const matches = Array.isArray(payload.checks)
        ? payload.checks.filter((item) => item?.name === name)
        : [];
      const check = matches.length === 1 ? matches[0] : undefined;
      lines.push(
        `| ${name} | ${STATUSES.has(check?.status) ? check.status : "unverified"} |`,
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
