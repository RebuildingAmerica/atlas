import assert from "node:assert/strict";
import test from "node:test";
import type Stripe from "stripe";
import { STRIPE_BILLING_WEBHOOK_EVENTS } from "../../config/products.js";
import { ensureBillingWebhookEndpoint } from "./catalog.js";

const webhookUrl = "https://atlas.rebuildingus.org/api/stripe/webhook";

function listed(data: object[]) {
  return {
    data,
    has_more: false,
    async *[Symbol.asyncIterator]() {
      for (const item of data) {
        yield await Promise.resolve(item);
      }
    },
  };
}

void test("production repair refuses to create a replacement webhook without a known signing secret", async () => {
  let created = false;
  const stripe = {
    webhookEndpoints: {
      list: () => listed([]),
      create: () => {
        created = true;
        return Promise.resolve({ secret: "whsec_unexpected" });
      },
    },
  } as unknown as Stripe;

  await assert.rejects(
    ensureBillingWebhookEndpoint(stripe, webhookUrl, { requireExisting: true }),
    /existing.*webhook/i,
  );
  assert.equal(created, false);
});

void test("production repair updates the existing endpoint and preserves its identity", async () => {
  const endpoint = {
    id: "we_atlas",
    url: webhookUrl,
    status: "enabled",
    livemode: true,
    enabled_events: ["checkout.session.completed"],
    metadata: { owner: "atlas", atlas_webhook: "" },
  };
  let created = false;
  const stripe = {
    webhookEndpoints: {
      list: () => listed([endpoint]),
      update: (id: string, changes: Stripe.WebhookEndpointUpdateParams) => {
        assert.equal(id, endpoint.id);
        endpoint.enabled_events = [...(changes.enabled_events ?? [])];
        endpoint.metadata = { ...endpoint.metadata, ...changes.metadata };
        return Promise.resolve(endpoint);
      },
      create: () => {
        created = true;
        return Promise.resolve({ secret: "whsec_unexpected" });
      },
    },
  } as unknown as Stripe;

  const result = await ensureBillingWebhookEndpoint(stripe, webhookUrl, {
    requireExisting: true,
  });
  assert.equal(result.endpoint.id, "we_atlas");
  assert.equal(result.secret, null);
  assert.deepEqual(endpoint.enabled_events, STRIPE_BILLING_WEBHOOK_EVENTS);
  assert.equal(endpoint.metadata.atlas_webhook, "billing");
  assert.equal(created, false);
});

void test("production repair refuses ambiguous webhook endpoints", async () => {
  const stripe = {
    webhookEndpoints: {
      list: () =>
        listed([
          { id: "we_one", url: webhookUrl, status: "enabled", livemode: true },
          { id: "we_two", url: webhookUrl, status: "enabled", livemode: true },
        ]),
    },
  } as unknown as Stripe;

  await assert.rejects(
    ensureBillingWebhookEndpoint(stripe, webhookUrl, { requireExisting: true }),
    /multiple.*webhook/i,
  );
});

void test("production repair rejects a non-live endpoint before changing it", async () => {
  let updated = false;
  const stripe = {
    webhookEndpoints: {
      list: () =>
        listed([
          {
            id: "we_test",
            url: webhookUrl,
            status: "enabled",
            livemode: false,
            metadata: {},
          },
        ]),
      update: () => {
        updated = true;
        return Promise.resolve({});
      },
    },
  } as unknown as Stripe;

  await assert.rejects(
    ensureBillingWebhookEndpoint(stripe, webhookUrl, {
      requireExisting: true,
      requireLive: true,
    }),
    /live.*webhook/i,
  );
  assert.equal(updated, false);
});
