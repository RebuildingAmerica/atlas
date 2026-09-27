import assert from "node:assert/strict";
import test from "node:test";
import {
  renderRuntimeBillingReport,
  runtimeInventoryPasses,
} from "./runtime-billing-report.mjs";

const sha = "0123456789abcdef0123456789abcdef01234567"; // pragma: allowlist secret

test("accepts only checks from the exact deployed revision", () => {
  const report = renderRuntimeBillingReport(
    {
      revision: sha,
      checks: [
        { name: "Charge-enabled account", status: "pass" },
        { name: "Stripe Tax", status: "fail" },
      ],
    },
    sha,
  );

  assert.match(report, /Charge-enabled account \| pass/);
  assert.match(report, /Stripe Tax \| fail/);
  assert.doesNotMatch(report, /Revision mismatch/);
});

test("does not attribute a different deployment's Stripe state to the release", () => {
  const report = renderRuntimeBillingReport(
    {
      revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      checks: [{ name: "Charge-enabled account", status: "pass" }],
    },
    sha,
  );

  assert.match(report, /Revision mismatch \| unverified/);
  assert.doesNotMatch(report, /Charge-enabled account \| pass/);
});

test("does not echo unexpected provider text or secrets from a response", () => {
  const report = renderRuntimeBillingReport(
    {
      revision: sha,
      checks: [
        {
          name: "Charge-enabled account",
          status: "pass",
          detail: "rk_live_secret",
        },
        { name: "rk_live_secret", status: "pass" },
      ],
    },
    sha,
  );

  assert.match(report, /Charge-enabled account \| pass/);
  assert.doesNotMatch(report, /rk_live_secret/);
});

test("leaves the billing gate closed until every runtime capability passes", () => {
  const checks = [
    "Runtime key",
    "Charge-enabled account",
    "Stripe Tax",
    "Customer portal",
    "Catalog IDs",
    "Webhook endpoint metadata",
  ].map((name) => ({ name, status: "pass" }));
  assert.equal(runtimeInventoryPasses({ revision: sha, checks }, sha), true);
  assert.equal(
    runtimeInventoryPasses({ revision: sha, checks: checks.slice(1) }, sha),
    false,
  );
  assert.equal(
    runtimeInventoryPasses(
      {
        revision: sha,
        checks: [
          ...checks.slice(0, -1),
          { name: "Webhook endpoint metadata", status: "unverified" },
        ],
      },
      sha,
    ),
    false,
  );
  assert.equal(
    runtimeInventoryPasses({ revision: "unknown", checks }, sha),
    false,
  );
  assert.equal(
    runtimeInventoryPasses(
      {
        revision: sha,
        checks: [...checks, { name: "Runtime key", status: "fail" }],
      },
      sha,
    ),
    false,
  );
});
