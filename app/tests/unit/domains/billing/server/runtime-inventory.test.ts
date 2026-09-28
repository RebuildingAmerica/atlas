import { describe, expect, test } from "vitest";
import type Stripe from "stripe";
import { inspectRuntimeBilling } from "@/domains/billing/server/runtime-inventory";
import { createStripeAtlasCatalogFixture } from "../../../../fixtures/billing/stripe-price-envs";

describe("read-only billing inventory in the deployed runtime", () => {
  function provider(
    overrides: {
      chargesEnabled?: boolean;
      taxStatus?: "active" | "pending";
      portalCancel?: boolean;
      portalPlanChange?: boolean;
      wrongPriceParent?: boolean;
      webhookActive?: boolean;
    } = {},
  ): Stripe {
    return {
      accounts: {
        retrieveCurrent: () =>
          Promise.resolve({ charges_enabled: overrides.chargesEnabled ?? true }),
      },
      tax: {
        settings: {
          retrieve: () =>
            Promise.resolve({ livemode: true, status: overrides.taxStatus ?? "active" }),
        },
      },
      billingPortal: {
        configurations: {
          retrieve: () =>
            Promise.resolve({
              id: "bpc_atlas",
              metadata: { atlas_portal: "billing" },
              active: true,
              livemode: true,
              features: {
                invoice_history: { enabled: true },
                payment_method_update: { enabled: true },
                subscription_cancel: {
                  enabled: overrides.portalCancel ?? true,
                  mode: "at_period_end",
                },
                subscription_update: { enabled: overrides.portalPlanChange ?? false },
              },
            }),
        },
      },
      products: {
        retrieve: (id: string) => Promise.resolve({ id, active: true, deleted: false }),
      },
      prices: {
        retrieve: (id: string) =>
          Promise.resolve({
            id,
            active: true,
            currency: "usd",
            product: overrides.wrongPriceParent
              ? "prod_wrong"
              : id.includes("team_seat")
                ? "prod_team_seat"
                : id.includes("team")
                  ? "prod_team_base"
                  : id.includes("pass")
                    ? "prod_research_pass"
                    : "prod_pro",
          }),
      },
      coupons: {
        retrieve: () => Promise.resolve({ valid: true }),
      },
      webhookEndpoints: {
        list: () =>
          Promise.resolve({
            data: [
              {
                url: "https://atlas.example.test/api/stripe/webhook",
                status: overrides.webhookActive === false ? "disabled" : "enabled",
                enabled_events: [
                  "checkout.session.completed",
                  "checkout.session.async_payment_succeeded",
                  "checkout.session.async_payment_failed",
                  "customer.subscription.created",
                  "customer.subscription.updated",
                  "customer.subscription.deleted",
                  "refund.created",
                  "refund.updated",
                ],
                metadata: { atlas_webhook: "billing" },
              },
            ],
          }),
      },
    } as unknown as Stripe;
  }

  const runtime = {
    STRIPE_API_KEY: "rk_live_example_credential", // pragma: allowlist secret
    STRIPE_ATLAS_CATALOG: createStripeAtlasCatalogFixture(),
    STRIPE_WEBHOOK_SECRET: "whsec_example_credential", // pragma: allowlist secret
    STRIPE_BILLING_PORTAL_CONFIGURATION: "bpc_atlas",
    ATLAS_PUBLIC_URL: "https://atlas.example.test",
  };

  test("reports charge, Tax, and portal readiness without leaking credentials", async () => {
    const checks = await inspectRuntimeBilling(provider(), runtime);

    expect(checks).toContainEqual({ name: "Charge-enabled account", status: "pass" });
    expect(checks).toContainEqual({ name: "Stripe Tax", status: "pass" });
    expect(checks).toContainEqual({ name: "Customer portal", status: "pass" });
    expect(checks).toContainEqual({ name: "Catalog IDs", status: "pass" });
    expect(checks).toContainEqual({ name: "Webhook endpoint metadata", status: "pass" });
    expect(JSON.stringify(checks)).not.toContain("rk_live_example_credential");
    expect(JSON.stringify(checks)).not.toContain("whsec_example_credential");
  });

  test("fails closed when the account cannot charge or the portal cannot cancel", async () => {
    const checks = await inspectRuntimeBilling(
      provider({ chargesEnabled: false, portalCancel: false }),
      runtime,
    );

    expect(checks).toContainEqual({ name: "Charge-enabled account", status: "fail" });
    expect(checks).toContainEqual({
      name: "Customer portal",
      status: "fail",
      reasonCodes: ["portal_cancellation_disabled"],
    });
  });

  test("rejects portal plan changes outside Atlas checkout", async () => {
    const checks = await inspectRuntimeBilling(provider({ portalPlanChange: true }), runtime);
    expect(checks).toContainEqual({
      name: "Customer portal",
      status: "fail",
      reasonCodes: ["portal_plan_change_enabled"],
    });
  });

  test("reports every failed portal control and webhook setting without provider values", async () => {
    const stripe = provider();
    stripe.billingPortal.configurations.retrieve = (() =>
      Promise.resolve({
        id: "bpc_atlas",
        metadata: { atlas_portal: "billing" },
        active: false,
        livemode: false,
        features: {
          invoice_history: { enabled: false },
          payment_method_update: { enabled: false },
          subscription_cancel: { enabled: false, mode: "immediately" },
        },
      })) as unknown as typeof stripe.billingPortal.configurations.retrieve;
    stripe.webhookEndpoints.list = (() =>
      Promise.resolve({
        data: [
          {
            url: "https://atlas.example.test/api/stripe/webhook",
            status: "disabled",
            enabled_events: ["checkout.session.completed"],
            metadata: {},
          },
        ],
      })) as typeof stripe.webhookEndpoints.list;

    const checks = await inspectRuntimeBilling(stripe, runtime);

    expect(checks).toContainEqual({
      name: "Customer portal",
      status: "fail",
      reasonCodes: [
        "portal_inactive",
        "portal_not_live",
        "portal_invoice_history_disabled",
        "portal_payment_update_disabled",
        "portal_cancellation_disabled",
        "portal_cancellation_mode_wrong",
      ],
    });
    expect(checks).toContainEqual({
      name: "Webhook endpoint metadata",
      status: "fail",
      reasonCodes: [
        "webhook_disabled",
        "webhook_metadata_missing",
        "webhook_event_missing:checkout.session.async_payment_succeeded",
        "webhook_event_missing:checkout.session.async_payment_failed",
        "webhook_event_missing:customer.subscription.created",
        "webhook_event_missing:customer.subscription.updated",
        "webhook_event_missing:customer.subscription.deleted",
        "webhook_event_missing:refund.created",
        "webhook_event_missing:refund.updated",
      ],
    });
    expect(JSON.stringify(checks)).not.toContain("https://atlas.example.test");
    expect(JSON.stringify(checks)).not.toContain("whsec_example_credential");
  });

  test("identifies missing Atlas portal configuration and billing webhook separately", async () => {
    const stripe = provider();
    stripe.webhookEndpoints.list = (() =>
      Promise.resolve({
        data: [],
        has_more: false,
      })) as unknown as typeof stripe.webhookEndpoints.list;

    const checks = await inspectRuntimeBilling(stripe, {
      ...runtime,
      STRIPE_BILLING_PORTAL_CONFIGURATION: "",
    });

    expect(checks).toContainEqual({
      name: "Customer portal",
      status: "fail",
      reasonCodes: ["portal_configuration_missing"],
    });
    expect(checks).toContainEqual({
      name: "Webhook endpoint metadata",
      status: "fail",
      reasonCodes: ["webhook_missing"],
    });
  });

  test("rejects a portal configuration that belongs to another product", async () => {
    const stripe = provider();
    stripe.billingPortal.configurations.retrieve = (() =>
      Promise.resolve({
        id: "bpc_other",
        metadata: { atlas_portal: "other" },
        active: true,
        livemode: true,
        features: {
          invoice_history: { enabled: true },
          payment_method_update: { enabled: true },
          subscription_cancel: { enabled: true, mode: "at_period_end" },
        },
      })) as unknown as typeof stripe.billingPortal.configurations.retrieve;

    const checks = await inspectRuntimeBilling(stripe, runtime);
    expect(checks).toContainEqual({
      name: "Customer portal",
      status: "fail",
      reasonCodes: ["portal_metadata_mismatch"],
    });
  });

  test("does not mistake an unreadable provider capability for a pass", async () => {
    const stripe = provider();
    stripe.accounts.retrieveCurrent = () => Promise.reject(new Error("secret provider details"));

    const checks = await inspectRuntimeBilling(stripe, runtime);

    expect(checks).toContainEqual({ name: "Charge-enabled account", status: "unverified" });
    expect(JSON.stringify(checks)).not.toContain("secret provider details");
  });

  test("rejects a test-mode or missing runtime key before provider inspection", async () => {
    expect(
      await inspectRuntimeBilling(provider(), { ...runtime, STRIPE_API_KEY: "sk_test_only" }), // pragma: allowlist secret
    ).toEqual([{ name: "Runtime key", status: "fail" }]);
    expect(
      await inspectRuntimeBilling(provider(), { ...runtime, STRIPE_API_KEY: undefined }),
    ).toEqual([{ name: "Runtime key", status: "fail" }]);
  });

  test("distinguishes malformed catalog from provider read failure", async () => {
    const malformed = await inspectRuntimeBilling(provider(), {
      ...runtime,
      STRIPE_ATLAS_CATALOG: undefined,
    });
    expect(malformed).toContainEqual({ name: "Catalog IDs", status: "fail" });

    const stripe = provider();
    stripe.products.retrieve = () => Promise.reject(new Error("private provider failure"));
    const unreadable = await inspectRuntimeBilling(stripe, runtime);
    expect(unreadable).toContainEqual({ name: "Catalog IDs", status: "unverified" });
    expect(JSON.stringify(unreadable)).not.toContain("private provider failure");
  });

  test("accepts expanded Stripe product references on active prices", async () => {
    const stripe = provider();
    const priceProvider = provider();
    stripe.prices.retrieve = (async (id: string) => {
      const price = await priceProvider.prices.retrieve(id);
      const productId = typeof price.product === "string" ? price.product : price.product.id;
      return { ...price, product: { id: productId } };
    }) as unknown as typeof stripe.prices.retrieve;

    const checks = await inspectRuntimeBilling(stripe, runtime);
    expect(checks).toContainEqual({ name: "Catalog IDs", status: "pass" });
  });

  test("does not pass an unreadable or incomplete webhook configuration", async () => {
    const noUrl = await inspectRuntimeBilling(provider(), {
      ...runtime,
      ATLAS_PUBLIC_URL: undefined,
    });
    expect(noUrl).toContainEqual({
      name: "Webhook endpoint metadata",
      status: "fail",
      reasonCodes: ["webhook_public_url_invalid"],
    });

    const noSecret = await inspectRuntimeBilling(provider(), {
      ...runtime,
      STRIPE_WEBHOOK_SECRET: undefined,
    });
    expect(noSecret).toContainEqual({
      name: "Webhook endpoint metadata",
      status: "fail",
      reasonCodes: ["webhook_signing_secret_missing"],
    });

    const stripe = provider();
    stripe.webhookEndpoints.list = () => Promise.resolve({ data: [], has_more: true }) as never;
    const paginated = await inspectRuntimeBilling(stripe, runtime);
    expect(paginated).toContainEqual({
      name: "Webhook endpoint metadata",
      status: "unverified",
      reasonCodes: ["webhook_list_incomplete"],
    });

    stripe.webhookEndpoints.list = (() =>
      Promise.reject(new Error("private webhook failure"))) as typeof stripe.webhookEndpoints.list;
    const unreadable = await inspectRuntimeBilling(stripe, runtime);
    expect(unreadable).toContainEqual({
      name: "Webhook endpoint metadata",
      status: "unverified",
      reasonCodes: ["webhook_unreadable"],
    });
    expect(JSON.stringify(unreadable)).not.toContain("private webhook failure");
  });

  test("does not pass inactive Tax or an unreadable portal", async () => {
    const tax = await inspectRuntimeBilling(provider({ taxStatus: "pending" }), runtime);
    expect(tax).toContainEqual({ name: "Stripe Tax", status: "fail" });

    const stripe = provider();
    stripe.tax.settings.retrieve = () => Promise.reject(new Error("private tax failure"));
    stripe.billingPortal.configurations.retrieve = () =>
      Promise.reject(new Error("private portal failure"));
    const unreadable = await inspectRuntimeBilling(stripe, runtime);
    expect(unreadable).toContainEqual({ name: "Stripe Tax", status: "unverified" });
    expect(unreadable).toContainEqual({
      name: "Customer portal",
      status: "unverified",
      reasonCodes: ["portal_unreadable"],
    });
  });

  test("rejects prices from another product and a disabled webhook", async () => {
    const checks = await inspectRuntimeBilling(
      provider({ wrongPriceParent: true, webhookActive: false }),
      runtime,
    );

    expect(checks).toContainEqual({ name: "Catalog IDs", status: "fail" });
    expect(checks).toContainEqual({
      name: "Webhook endpoint metadata",
      status: "fail",
      reasonCodes: ["webhook_disabled"],
    });
  });
});
