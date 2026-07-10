import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatStripeMissingApiKeyGuidance,
  formatStripeApiKeyPromptMessage,
  formatStripeWebhookUrlPromptMessage,
  formatHostedStripeEnvStatus,
  stripeLiveRestrictedKeySetupSteps,
  formatStripeAccountPrompt,
  stripeAccountDisplayName,
} from "./bootstrap.js";

void describe("Stripe bootstrap account review", () => {
  void it("uses the clearest Stripe account display name", () => {
    assert.equal(
      stripeAccountDisplayName({
        business_profile: { name: "Atlas Business" },
        id: "acct_123",
        settings: { dashboard: { display_name: "Atlas Dashboard" } },
      }),
      "Atlas Dashboard",
    );
    assert.equal(
      stripeAccountDisplayName({
        business_profile: { name: "Atlas Business" },
        id: "acct_123",
      }),
      "Atlas Business",
    );
    assert.equal(stripeAccountDisplayName({ id: "acct_123" }), "acct_123");
  });

  void it("formats Stripe account details inside the confirmation prompt", () => {
    assert.equal(
      formatStripeAccountPrompt({
        accountId: "acct_123",
        accountName: "Atlas Dashboard",
        mode: "test",
        target: "local",
      }),
      [
        "Use this Stripe account?",
        "",
        "Account: Atlas Dashboard",
        "Stripe ID: acct_123",
        "Mode: test",
        "Target: local",
      ].join("\n"),
    );
  });

  void it("explains when Vercel Preview has Stripe env but Production does not", () => {
    assert.deepEqual(
      formatHostedStripeEnvStatus("prod", [
        { environment: "preview", key: "STRIPE_API_KEY" },
        { environment: "preview", key: "STRIPE_WEBHOOK_SECRET" },
        { environment: "preview", key: "STRIPE_ATLAS_CATALOG" },
      ]),
      [
        "Vercel Production Stripe env is missing STRIPE_API_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_ATLAS_CATALOG.",
        "Vercel Preview Stripe env does not configure Production; run production setup to sync Production explicitly.",
      ],
    );
  });

  void it("walks operators through creating the production Stripe key", () => {
    const steps = stripeLiveRestrictedKeySetupSteps();

    assert.ok(
      steps.some((step) =>
        step.includes(
          "Stripe Dashboard > Developers > API keys > Restricted keys",
        ),
      ),
    );
    assert.ok(
      steps.some((step) =>
        step.includes(
          "Products, Prices, Coupons, Customers, Checkout Sessions",
        ),
      ),
    );
    assert.ok(
      steps.some((step) =>
        step.includes("STRIPE_API_KEY=rk_live_... pnpm setup:prod --yes"),
      ),
    );
  });

  void it("shows production Stripe key setup steps at the point of failure", () => {
    const steps = stripeLiveRestrictedKeySetupSteps();
    const guidance = formatStripeMissingApiKeyGuidance({
      apiKeyResolutionNotes: ["Stripe CLI has a redacted live key."],
      hostedEnvStatus: [
        "Vercel Production Stripe env is missing STRIPE_API_KEY.",
      ],
      target: "prod",
    });

    assert.deepEqual(guidance, [
      "Production Stripe setup needs a live restricted key before bootstrap can change Stripe.",
      ...steps,
      "Stripe CLI has a redacted live key.",
      "Vercel Production Stripe env is missing STRIPE_API_KEY.",
    ]);
  });

  void it("puts live restricted key instructions directly in the production key prompt", () => {
    const message = formatStripeApiKeyPromptMessage("live");

    assert.match(message, /dashboard\.stripe\.com\/apikeys/);
    assert.match(message, /The Rebuilding America Project account/);
    assert.match(
      message,
      /Products, Prices, Coupons, Customers, Checkout Sessions/,
    );
    assert.match(message, /Paste the rk_live_/);
    assert.match(message, /webhook, env files, and Vercel Production env vars/);
  });

  void it("explains the hosted Stripe webhook URL prompt", () => {
    const message = formatStripeWebhookUrlPromptMessage("prod");

    assert.match(message, /Production Atlas app URL/);
    assert.match(message, /Stripe will send webhooks to/);
    assert.match(message, /\/api\/stripe\/webhook/);
    assert.match(message, /Do not include/);
  });
});
