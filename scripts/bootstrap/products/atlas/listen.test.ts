import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildStripeListenArgs,
  formatStripeListenCommand,
  resolveLocalStripeWebhookUrl,
} from "./listen.js";

void describe("Stripe local webhook listener", () => {
  void it("uses the default local Atlas webhook URL", () => {
    assert.equal(
      resolveLocalStripeWebhookUrl(new Map()),
      "https://atlas.localhost/api/stripe/webhook",
    );
  });

  void it("uses ATLAS_PUBLIC_URL when local development overrides the app origin", () => {
    assert.equal(
      resolveLocalStripeWebhookUrl(
        new Map([["ATLAS_PUBLIC_URL", "https://atlas.dev.test/base"]]),
      ),
      "https://atlas.dev.test/api/stripe/webhook",
    );
  });

  void it("builds the listen command from the canonical billing webhook events", () => {
    const args = buildStripeListenArgs(
      "https://atlas.localhost/api/stripe/webhook",
    );

    assert.deepEqual(args, [
      "listen",
      "--skip-verify",
      "--events",
      "checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted",
      "--forward-to",
      "https://atlas.localhost/api/stripe/webhook",
    ]);
    assert.equal(
      formatStripeListenCommand(args),
      "stripe listen --skip-verify --events checkout.session.completed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted --forward-to https://atlas.localhost/api/stripe/webhook",
    );
  });
});
