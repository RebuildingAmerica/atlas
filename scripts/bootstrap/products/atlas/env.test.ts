import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import {
  STRIPE_ATLAS_CATALOG_ENV_KEY,
  buildStripeEnvUpdates,
  buildStripeVercelEnvVars,
  expandStripeCatalogEnv,
  resolveStripeEnvFileTargets,
  resolveStripeMode,
  stripeWebhookUrlForOrigin,
  validateStripeApiKeyMode,
} from "./env.js";

void describe("Stripe bootstrap environment helpers", () => {
  void it("keeps prod on live mode and non-prod targets on test mode", () => {
    assert.equal(resolveStripeMode("local", false), "test");
    assert.equal(resolveStripeMode("staging", false), "test");
    assert.equal(resolveStripeMode("prod", true), "live");
    assert.throws(() => resolveStripeMode("prod", false), /requires --live/);
    assert.throws(
      () => resolveStripeMode("staging", true),
      /must use Stripe test mode/,
    );
  });

  void it("rejects Stripe keys that do not match the selected mode", () => {
    assert.doesNotThrow(() => {
      validateStripeApiKeyMode("sk_test_123", "test");
    });
    assert.doesNotThrow(() => {
      validateStripeApiKeyMode("rk_test_123", "test");
    });
    assert.doesNotThrow(() => {
      validateStripeApiKeyMode("sk_live_123", "live");
    });
    assert.doesNotThrow(() => {
      validateStripeApiKeyMode("rk_live_123", "live");
    });
    assert.throws(() => {
      validateStripeApiKeyMode("sk_test_123", "live");
    }, /requires a sk_live_ or rk_live_/);
    assert.throws(() => {
      validateStripeApiKeyMode("sk_live_123", "test");
    }, /requires a sk_test_ or rk_test_/);
  });

  void it("writes Stripe IDs to the env files for the requested target", () => {
    const root = path.resolve("/atlas");

    assert.deepEqual(resolveStripeEnvFileTargets(root, "local"), [
      path.join(root, ".env"),
      path.join(root, "app", ".env.local"),
    ]);
    assert.deepEqual(resolveStripeEnvFileTargets(root, "staging"), [
      path.join(root, ".env.staging"),
    ]);
    assert.deepEqual(resolveStripeEnvFileTargets(root, "prod"), [
      path.join(root, ".env.production"),
    ]);
  });

  void it("builds complete Stripe runtime env updates with one generated catalog value", () => {
    const ids = new Map([
      ["STRIPE_PRODUCT_ATLAS_PRO", "prod_pro"],
      ["STRIPE_PRICE_ATLAS_PRO_MONTHLY", "price_pro_month"],
      [
        "STRIPE_PRICE_ATLAS_PRO_STUDENT_FOUR_MONTH",
        "price_pro_student_four_month",
      ],
      ["STRIPE_COUPON_STUDENT", "coupon_student"],
      ["STRIPE_COUPON_JOURNALIST", "coupon_journalist"],
    ]);

    const updates = buildStripeEnvUpdates("sk_test_123", "whsec_123", ids);

    assert.deepEqual(
      [...updates.keys()],
      ["STRIPE_API_KEY", "STRIPE_WEBHOOK_SECRET", STRIPE_ATLAS_CATALOG_ENV_KEY],
    );
    assert.deepEqual(
      expandStripeCatalogEnv(updates).get("STRIPE_PRICE_ATLAS_PRO_MONTHLY"),
      "price_pro_month",
    );
    assert.deepEqual(
      expandStripeCatalogEnv(updates).get("STRIPE_COUPON_STUDENT"),
      "coupon_student",
    );
  });

  void it("syncs hosted Stripe vars to the correct Vercel target only", () => {
    const env = new Map([
      ["STRIPE_API_KEY", "sk_test_123"],
      ["STRIPE_WEBHOOK_SECRET", "whsec_123"],
      [STRIPE_ATLAS_CATALOG_ENV_KEY, "{}"],
    ]);

    assert.deepEqual(
      buildStripeVercelEnvVars(env, "staging").map((item) => item.environments),
      [["preview"], ["preview"], ["preview"]],
    );
    assert.deepEqual(
      buildStripeVercelEnvVars(env, "prod").map((item) => item.environments),
      [["production"], ["production"], ["production"]],
    );
    assert.deepEqual(buildStripeVercelEnvVars(env, "local"), []);
  });

  void it("derives the Stripe webhook URL from the Atlas app origin", () => {
    assert.equal(
      stripeWebhookUrlForOrigin("atlas.rebuildingus.org"),
      "https://atlas.rebuildingus.org/api/stripe/webhook",
    );
    assert.equal(
      stripeWebhookUrlForOrigin("https://atlas-staging.rebuildingus.org/base"),
      "https://atlas-staging.rebuildingus.org/api/stripe/webhook",
    );
  });
});
