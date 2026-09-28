import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import { STRIPE_BILLING_WEBHOOK_EVENTS } from "../../config/products.js";
import {
  repairProductionBilling,
  requireProductionBillingTarget,
} from "../../../ci/repair-production-billing.js";

const origin = "https://atlas.rebuildingus.org";
const webhookUrl = `${origin}/api/stripe/webhook`;
const catalog = JSON.stringify({
  products: { pro: "prod_atlas_pro" },
  prices: {},
  coupons: {},
});

void test("live billing repair cannot target a test key or another origin", () => {
  assert.throws(() => {
    requireProductionBillingTarget("sk_test_example", origin);
  }, /live mode/);
  assert.throws(() => {
    requireProductionBillingTarget(
      "rk_live_example",
      "https://atlas-staging.rebuildingus.org",
    );
  }, /Atlas public origin/);
  assert.doesNotThrow(() => {
    requireProductionBillingTarget("rk_live_example", origin);
  });
});

void test("live billing repair updates the existing endpoint and creates a usable Atlas portal", async () => {
  const webhook = {
    id: "we_atlas",
    url: webhookUrl,
    status: "enabled",
    livemode: true,
    enabled_events: ["checkout.session.completed"],
    metadata: { atlas_webhook: "billing" },
  };
  let portal: Record<string, unknown> | undefined;
  let webhookCreations = 0;
  const stripe = {
    accounts: {
      retrieveCurrent: () => Promise.resolve({ charges_enabled: true }),
    },
    products: {
      retrieve: () =>
        Promise.resolve({
          livemode: true,
          metadata: { atlas_product_id: "pro" },
        }),
    },
    webhookEndpoints: {
      list: () => ({
        async *[Symbol.asyncIterator]() {
          yield await Promise.resolve(webhook);
        },
      }),
      update: (_id: string, changes: Stripe.WebhookEndpointUpdateParams) => {
        webhook.enabled_events = [...(changes.enabled_events ?? [])];
        return Promise.resolve(webhook);
      },
      retrieve: () => Promise.resolve(webhook),
      create: () => {
        webhookCreations += 1;
        return Promise.resolve({});
      },
    },
    billingPortal: {
      configurations: {
        list: () => Promise.resolve({ data: [], has_more: false }),
        create: (settings: Record<string, unknown>) => {
          portal = {
            ...settings,
            id: "bpc_atlas",
            active: true,
            livemode: true,
          };
          return Promise.resolve(portal);
        },
        retrieve: () => Promise.resolve(portal),
      },
    },
  } as unknown as Stripe;

  const result = await repairProductionBilling(stripe, origin, catalog);
  assert.deepEqual(result, { portalId: "bpc_atlas", webhookId: "we_atlas" });
  assert.deepEqual(webhook.enabled_events, STRIPE_BILLING_WEBHOOK_EVENTS);
  assert.equal(webhookCreations, 0);
  assert.equal(portal?.id, "bpc_atlas");
});

void test("live billing repair refuses a charge-disabled account before mutating Stripe", async () => {
  let touchedWebhook = false;
  const stripe = {
    accounts: {
      retrieveCurrent: () => Promise.resolve({ charges_enabled: false }),
    },
    webhookEndpoints: {
      list: () => {
        touchedWebhook = true;
        return [];
      },
    },
  } as unknown as Stripe;

  await assert.rejects(
    repairProductionBilling(stripe, origin, catalog),
    /cannot currently charge/,
  );
  assert.equal(touchedWebhook, false);
});

void test("live billing repair refuses a catalog from another Stripe account before touching the webhook", async () => {
  let touchedWebhook = false;
  const stripe = {
    accounts: {
      retrieveCurrent: () => Promise.resolve({ charges_enabled: true }),
    },
    products: {
      retrieve: () =>
        Promise.resolve({
          livemode: false,
          metadata: { atlas_product_id: "pro" },
        }),
    },
    webhookEndpoints: {
      list: () => {
        touchedWebhook = true;
        return [];
      },
    },
  } as unknown as Stripe;

  await assert.rejects(
    repairProductionBilling(stripe, origin, catalog),
    /live Atlas Pro product/,
  );
  assert.equal(touchedWebhook, false);
});
