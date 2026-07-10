import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatStripeMissingApiKeyGuidance,
  formatStripeApiKeyPromptMessage,
  formatStripeApiKeyGuidanceNote,
  formatStripeWebhookUrlPromptMessage,
  formatHostedStripeEnvStatus,
  stripeLiveRestrictedKeySetupSteps,
  formatStripeAccountPrompt,
  formatStripeAccountVerificationFailure,
  formatStripeVerificationRetryPrompt,
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

  void it("keeps the live key input prompt short and moves setup guidance to a note", () => {
    const message = formatStripeApiKeyPromptMessage("live");
    const guidance = formatStripeApiKeyGuidanceNote("live");

    assert.equal(message, "Paste the Stripe live mode API key");
    assert.match(guidance.title, /Stripe live mode API key/);
    assert.match(guidance.message, /dashboard\.stripe\.com\/apikeys/);
    assert.match(guidance.message, /The Rebuilding America Project account/);
    assert.match(guidance.message, /Powering an integration you built/);
    assert.match(guidance.message, /website and app code/);
    assert.match(guidance.message, /Atlas Production Billing/);
    assert.doesNotMatch(message, /Do not/);
    assert.doesNotMatch(guidance.message, /third-party/);
    assert.doesNotMatch(guidance.message, /AI agent/);
    assert.match(
      guidance.message,
      /Products, Prices, Coupons, Customers, Checkout Sessions/,
    );
    assert.match(guidance.message, /rk_live_/);
    assert.match(
      guidance.message,
      /webhook,\nenv files, and Vercel Production env vars/,
    );
    assert.ok(
      guidance.message.split("\n").every((line) => line.length <= 88),
      "Stripe guidance should stay readable in narrow terminals",
    );
  });

  void it("turns Stripe account permission errors into actionable guidance", () => {
    const failure = formatStripeAccountVerificationFailure(
      new Error(
        [
          "Permission denied.",
          'Enabling "Basic Business Contact Information Read"',
          "('accounts_kyc_basic_read') permissions on this key would allow this request to continue.",
          "You can edit permissions at https://dashboard.stripe.com/b/acct_123/apikeys/rk_123/edit",
        ].join(" "),
      ),
    );

    assert.equal(
      failure.summary,
      "Stripe key cannot verify the Stripe account.",
    );
    assert.equal(failure.title, "Stripe key permissions");
    assert.match(failure.message, /Basic Business Contact Information Read/);
    assert.match(failure.message, /accounts_kyc_basic_read/);
    assert.match(
      failure.message,
      /Open the restricted key in Stripe and add the missing read permission./,
    );
    assert.match(failure.message, /https:\/\/dashboard\.stripe\.com/);
    assert.doesNotMatch(failure.message, /rk_live_/);
  });

  void it("offers an in-phase retry after Stripe account verification fails", () => {
    const prompt = formatStripeVerificationRetryPrompt();

    assert.match(prompt, /Paste an updated Stripe API key now/);
    assert.match(prompt, /same Stripe phase/);
  });

  void it("explains the hosted Stripe webhook URL prompt", () => {
    const message = formatStripeWebhookUrlPromptMessage("prod");

    assert.match(message, /Production Atlas app URL/);
    assert.match(message, /Stripe will send webhooks to/);
    assert.match(message, /\/api\/stripe\/webhook/);
    assert.match(message, /Do not include/);
  });
});
