import { afterEach, describe, expect, it, vi } from "vitest";

const stripeMocks = vi.hoisted(() => ({
  StripeCtor: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("stripe", () => ({
  default: stripeMocks.StripeCtor,
}));

describe("getStripeClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    stripeMocks.StripeCtor.mockReset();
  });

  it("constructs and memoises a Stripe client when STRIPE_API_KEY is set", async () => {
    const fakeClient = { id: "stripe-singleton" };
    stripeMocks.StripeCtor.mockImplementation(function StripeCtor(this: object) {
      Object.assign(this, fakeClient);
    });
    vi.stubEnv("STRIPE_API_KEY", "sk_test_123");

    const { getStripeClient } = await import("@/domains/billing/server/stripe-client");
    const first = getStripeClient();
    const second = getStripeClient();

    expect(first).toBe(second);
    expect(first).toMatchObject(fakeClient);
    expect(stripeMocks.StripeCtor).toHaveBeenCalledTimes(1);
    expect(stripeMocks.StripeCtor).toHaveBeenCalledWith("sk_test_123", {
      apiVersion: "2025-08-27.basil",
    });
  });

  it("throws when STRIPE_API_KEY is missing", async () => {
    vi.stubEnv("STRIPE_API_KEY", "");
    const { getStripeClient } = await import("@/domains/billing/server/stripe-client");

    expect(() => getStripeClient()).toThrow(/STRIPE_API_KEY/);
  });
});

describe("getStripeWebhookSecret", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("returns the trimmed STRIPE_WEBHOOK_SECRET when set", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "  whsec_abc  ");
    const { getStripeWebhookSecret } = await import("@/domains/billing/server/stripe-client");
    expect(getStripeWebhookSecret()).toBe("whsec_abc");
  });

  it("throws when STRIPE_WEBHOOK_SECRET is missing", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const { getStripeWebhookSecret } = await import("@/domains/billing/server/stripe-client");
    expect(() => getStripeWebhookSecret()).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });
});
