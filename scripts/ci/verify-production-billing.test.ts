import assert from "node:assert/strict";
import test from "node:test";
import { assessOfferGate, renderReport } from "./verify-production-billing.js";

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
