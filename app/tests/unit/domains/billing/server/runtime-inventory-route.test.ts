import { describe, expect, test, vi } from "vitest";
import type Stripe from "stripe";
import { handleRuntimeBillingInventoryRequest } from "@/domains/billing/server/runtime-inventory-route";

describe("protected deployed billing inventory", () => {
  const env = {
    ATLAS_HOSTED_E2E_ENABLED: "1",
    ATLAS_HOSTED_E2E_PRODUCTION_ENABLED: "1",
    ATLAS_HOSTED_E2E_SECRET: "inventory-test-secret", // pragma: allowlist secret
    ATLAS_PUBLIC_URL: "https://atlas.example.test",
    STRIPE_API_KEY: "rk_live_example_credential", // pragma: allowlist secret
    VERCEL_ENV: "production",
    VERCEL_GIT_COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567", // pragma: allowlist secret
  };

  function request(secret?: string): Request {
    return new Request("https://atlas.example.test/api/e2e/hosted/billing-inventory", {
      method: "POST",
      headers: secret ? { "x-atlas-hosted-e2e-secret": secret } : {},
    });
  }

  test("refuses an unauthenticated request before touching Stripe", async () => {
    const getClient = vi.fn(() => {
      throw new Error("must not run");
    });

    const response = await handleRuntimeBillingInventoryRequest(request(), env, getClient);

    expect(response.status).toBe(404);
    expect(getClient).not.toHaveBeenCalled();
  });

  test("returns a redacted, uncached inventory tied to the deployed revision", async () => {
    const stripe = {
      accounts: { retrieveCurrent: () => Promise.resolve({ charges_enabled: true }) },
      tax: { settings: { retrieve: () => Promise.resolve({ livemode: true, status: "active" }) } },
      billingPortal: { configurations: { list: () => Promise.resolve({ data: [] }) } },
      products: { retrieve: () => Promise.reject(new Error("not used by this test")) },
      prices: { retrieve: () => Promise.reject(new Error("not used by this test")) },
      coupons: { retrieve: () => Promise.reject(new Error("not used by this test")) },
      webhookEndpoints: { list: () => Promise.resolve({ data: [] }) },
    } as unknown as Stripe;

    const response = await handleRuntimeBillingInventoryRequest(
      request("inventory-test-secret"),
      env,
      () => stripe,
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(body)).toMatchObject({
      revision: "0123456789abcdef0123456789abcdef01234567", // pragma: allowlist secret
      checks: [
        { name: "Runtime key", status: "pass" },
        { name: "Charge-enabled account", status: "pass" },
        { name: "Stripe Tax", status: "pass" },
        { name: "Customer portal", status: "fail" },
        { name: "Catalog IDs", status: "fail" },
        { name: "Webhook endpoint metadata", status: "fail" },
      ],
    });
    expect(body).not.toContain("rk_live_example_credential");
    expect(body).not.toContain("inventory-test-secret");
  });

  test("uses the explicit release revision and redacts provider failures", async () => {
    const response = await handleRuntimeBillingInventoryRequest(
      request("inventory-test-secret"),
      { ...env, ATLAS_RELEASE_SHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
      () => {
        throw new Error("rk_live_private_provider_message");
      },
    );

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: "Billing inventory unavailable." });
  });

  test("does not claim an unknown deployment revision", async () => {
    const stripe = {
      accounts: { retrieveCurrent: () => Promise.resolve({ charges_enabled: true }) },
      tax: { settings: { retrieve: () => Promise.resolve({ livemode: true, status: "active" }) } },
      billingPortal: { configurations: { list: () => Promise.resolve({ data: [] }) } },
      products: { retrieve: () => Promise.reject(new Error("not configured")) },
      prices: { retrieve: () => Promise.reject(new Error("not configured")) },
      coupons: { retrieve: () => Promise.reject(new Error("not configured")) },
      webhookEndpoints: { list: () => Promise.resolve({ data: [] }) },
    } as unknown as Stripe;
    const response = await handleRuntimeBillingInventoryRequest(
      request("inventory-test-secret"),
      { ...env, ATLAS_RELEASE_SHA: undefined, VERCEL_GIT_COMMIT_SHA: undefined },
      () => stripe,
    );

    expect(await response.json()).toMatchObject({ revision: "unknown" });

    const explicit = await handleRuntimeBillingInventoryRequest(
      request("inventory-test-secret"),
      {
        ...env,
        ATLAS_RELEASE_SHA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        VERCEL_GIT_COMMIT_SHA: "invalid",
      },
      () => stripe,
    );
    expect(await explicit.json()).toMatchObject({
      revision: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
  });
});
