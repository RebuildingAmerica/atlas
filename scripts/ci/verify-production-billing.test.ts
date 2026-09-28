import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import {
  assessAtlasPortal,
  assessOfferGate,
  assessUnreadableRuntimeKey,
  renderReport,
} from "./verify-production-billing.js";

void test("portal inventory checks the exact Atlas configuration used by sessions", async () => {
  const requested: string[] = [];
  let planChangesEnabled = false;
  const stripe = {
    billingPortal: {
      configurations: {
        retrieve: async (id: string) => {
          requested.push(id);
          return {
            id,
            active: true,
            livemode: true,
            metadata: { atlas_portal: "billing" },
            features: {
              invoice_history: { enabled: true },
              payment_method_update: { enabled: true },
              subscription_cancel: { enabled: true, mode: "at_period_end" },
              subscription_update: { enabled: planChangesEnabled },
            },
          };
        },
      },
    },
  } as unknown as Stripe;

  const check = await assessAtlasPortal(stripe, "bpc_atlas");
  assert.deepEqual(requested, ["bpc_atlas"]);
  assert.equal(check.status, "pass");
  planChangesEnabled = true;
  assert.equal((await assessAtlasPortal(stripe, "bpc_atlas")).status, "fail");
  assert.equal((await assessAtlasPortal(stripe, "")).status, "fail");
});

void test("the inventory keeps new sales closed until an exact offer allowlist exists", () => {
  assert.equal(assessOfferGate("false", "atlas_pro:monthly").status, "fail");
  assert.equal(assessOfferGate("true", "").status, "fail");
  assert.equal(
    assessOfferGate("true", "atlas_pro:monthly,atlas_pro:monthly").status,
    "fail",
  );
  assert.equal(assessOfferGate("true", "atlas_team:weekly").status, "fail");
  assert.equal(
    assessOfferGate("true", "atlas_pro:monthly,atlas_team:yearly").status,
    "unverified",
  );
});

void test("a sensitive key present by name is unverified, not declared absent", () => {
  const check = assessUnreadableRuntimeKey(true);
  assert.equal(check.status, "unverified");
  assert.match(check.detail, /does not prove the deployed key is absent/);
  assert.equal(assessUnreadableRuntimeKey(false).status, "fail");
});

void test("the public report marks unresolved payment proof as no-go without echoing a revision payload", () => {
  const report = renderReport(
    [
      {
        name: "Live purchase lifecycle",
        status: "unverified",
        detail: "Requires a genuine buyer payment.",
      },
    ],
    "e7b51762` SECRET_VALUE",
    "v2026.09.27-5` SECRET_VALUE",
  );
  assert.match(report, /Paid-launch decision: \*\*NO-GO\*\*/);
  assert.match(report, /Release under review: `unknown` \(`unknown`\)/);
  assert.doesNotMatch(report, /SECRET_VALUE/);
});
