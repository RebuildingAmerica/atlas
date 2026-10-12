import assert from "node:assert/strict";
import test from "node:test";
import { runtimeInventoryPasses } from "./billing-inventory.mjs";

const sha = "0123456789abcdef0123456789abcdef01234567"; // pragma: allowlist secret

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
