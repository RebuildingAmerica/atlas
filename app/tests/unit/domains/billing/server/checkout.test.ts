import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStripeClient: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/domains/billing/server/stripe-client", () => ({
  getStripeClient: mocks.getStripeClient,
}));

import { createCheckoutSession } from "@/domains/billing/server/checkout";

describe("createCheckoutSession", () => {
  interface SessionParams {
    mode: string;
    line_items: { price: string; quantity: number }[];
    customer?: string;
    customer_email?: string;
    discounts?: { coupon: string }[];
    subscription_data?: { metadata: Record<string, string> };
    metadata: Record<string, string>;
  }

  const create = vi.fn();

  beforeEach(() => {
    mocks.getStripeClient.mockReset();
    create.mockReset();
    mocks.getStripeClient.mockReturnValue({ checkout: { sessions: { create } } });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  function sessionParams(): SessionParams {
    return create.mock.calls[0]?.[0] as SessionParams;
  }

  it("adds a seat line item for a Team subscription with seats and existing customer", async () => {
    create.mockResolvedValue({ url: "https://checkout.stripe.test/c/team" });

    const result = await createCheckoutSession({
      workspaceId: "org_team",
      product: "atlas_team",
      priceId: "price_team_base",
      seatPriceId: "price_team_seat",
      seatQuantity: 2,
      successUrl: "https://atlas.test/checkout-complete?product=atlas_team",
      cancelUrl: "https://atlas.test/pricing",
      customerEmail: "owner@atlas.test",
      stripeCustomerId: "cus_123",
      discountCouponId: "coupon_team",
    });

    expect(result).toEqual({ url: "https://checkout.stripe.test/c/team" });
    const params = sessionParams();
    expect(params.mode).toBe("subscription");
    expect(params.line_items).toEqual([
      { price: "price_team_base", quantity: 1 },
      { price: "price_team_seat", quantity: 2 },
    ]);
    expect(params.customer).toBe("cus_123");
    expect(params.customer_email).toBeUndefined();
    expect(params.discounts).toEqual([{ coupon: "coupon_team" }]);
    expect(params.subscription_data).toEqual({
      metadata: { workspace_id: "org_team", product: "atlas_team" },
    });
  });

  it("creates a payment-mode session with a single line item and customer email", async () => {
    create.mockResolvedValue({ url: "https://checkout.stripe.test/c/pass" });

    const result = await createCheckoutSession({
      workspaceId: "org_solo",
      product: "atlas_research_pass",
      priceId: "price_pass_once",
      successUrl: "https://atlas.test/checkout-complete?product=atlas_research_pass",
      cancelUrl: "https://atlas.test/pricing",
      customerEmail: "solo@atlas.test",
    });

    expect(result).toEqual({ url: "https://checkout.stripe.test/c/pass" });
    const params = sessionParams();
    expect(params.mode).toBe("payment");
    expect(params.line_items).toEqual([{ price: "price_pass_once", quantity: 1 }]);
    expect(params.customer).toBeUndefined();
    expect(params.customer_email).toBe("solo@atlas.test");
    expect(params.discounts).toBeUndefined();
    expect(params.subscription_data).toBeUndefined();
  });

  it("omits the seat line item when the seat quantity is zero", async () => {
    create.mockResolvedValue({ url: "https://checkout.stripe.test/c/base" });

    await createCheckoutSession({
      workspaceId: "org_team",
      product: "atlas_team",
      priceId: "price_team_base",
      seatPriceId: "price_team_seat",
      seatQuantity: 0,
      successUrl: "https://atlas.test/checkout-complete?product=atlas_team",
      cancelUrl: "https://atlas.test/pricing",
      customerEmail: "owner@atlas.test",
      stripeCustomerId: "cus_123",
    });

    expect(sessionParams().line_items).toEqual([{ price: "price_team_base", quantity: 1 }]);
  });
});
