import assert from "node:assert/strict";
import test from "node:test";
import { productionBillingNames } from "./read-vercel-billing-presence.js";

void test("only Production names are reported, without encrypted values", () => {
  const metadata = {
    envs: [
      {
        key: "STRIPE_API_KEY",
        target: ["production"],
        value: "rk_live_DO_NOT_PRINT",
      },
      {
        key: "STRIPE_ATLAS_CATALOG",
        target: ["preview"],
        value: "SECRET_CATALOG",
      },
    ],
  };
  const result = productionBillingNames(metadata);
  assert.equal(
    result.find((item) => item.name === "STRIPE_API_KEY")?.present,
    true,
  );
  assert.equal(
    result.find((item) => item.name === "STRIPE_ATLAS_CATALOG")?.present,
    false,
  );
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_PRINT|SECRET_CATALOG/);
});

void test("malformed provider metadata fails rather than implying settings are absent", () => {
  assert.throws(() => productionBillingNames({ envs: null }));
});
