import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureAuthReady: vi.fn(),
  getStripeClient: vi.fn(),
  normalizeAtlasOrganizationMetadata: vi.fn(),
  mergeAtlasOrganizationMetadata: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: mocks.ensureAuthReady,
}));
vi.mock("@/domains/billing/server/stripe-client", () => ({
  getStripeClient: mocks.getStripeClient,
}));
vi.mock("@/domains/access/organization-metadata", () => ({
  normalizeAtlasOrganizationMetadata: mocks.normalizeAtlasOrganizationMetadata,
  mergeAtlasOrganizationMetadata: mocks.mergeAtlasOrganizationMetadata,
}));

import { ensureStripeCustomerForWorkspace } from "@/domains/billing/server/stripe-customer";

describe("ensureStripeCustomerForWorkspace", () => {
  beforeEach(() => {
    mocks.ensureAuthReady.mockReset();
    mocks.getStripeClient.mockReset();
    mocks.normalizeAtlasOrganizationMetadata.mockReset();
    mocks.mergeAtlasOrganizationMetadata.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns the existing customer ID when the workspace already has one", async () => {
    const getFullOrganization = vi.fn().mockResolvedValue({ metadata: { existing: true } });
    const updateOrganization = vi.fn();
    mocks.ensureAuthReady.mockResolvedValue({
      api: { getFullOrganization, updateOrganization },
    });
    mocks.normalizeAtlasOrganizationMetadata.mockReturnValue({ stripeCustomerId: "cus_existing" });

    const id = await ensureStripeCustomerForWorkspace("org_1", "ops@atlas.test", "Atlas Ops");

    expect(id).toBe("cus_existing");
    expect(mocks.getStripeClient).not.toHaveBeenCalled();
    expect(updateOrganization).not.toHaveBeenCalled();
  });

  it("creates a new Stripe customer and persists the id when none exists", async () => {
    const getFullOrganization = vi.fn().mockResolvedValue({ metadata: { existing: true } });
    const updateOrganization = vi.fn().mockResolvedValue(undefined);
    mocks.ensureAuthReady.mockResolvedValue({
      api: { getFullOrganization, updateOrganization },
    });
    mocks.normalizeAtlasOrganizationMetadata.mockReturnValue({});
    mocks.mergeAtlasOrganizationMetadata.mockReturnValue({ stripeCustomerId: "cus_new" });
    const customers = { create: vi.fn().mockResolvedValue({ id: "cus_new" }) };
    mocks.getStripeClient.mockReturnValue({ customers });

    const id = await ensureStripeCustomerForWorkspace("org_2", "lead@atlas.test", "Atlas Lead");

    expect(id).toBe("cus_new");
    expect(customers.create).toHaveBeenCalledWith({
      email: "lead@atlas.test",
      name: "Atlas Lead",
      metadata: { atlas_workspace_id: "org_2" },
    });
    expect(mocks.mergeAtlasOrganizationMetadata).toHaveBeenCalledWith(
      { existing: true },
      { stripeCustomerId: "cus_new" },
    );
    expect(updateOrganization).toHaveBeenCalledWith({
      body: {
        data: { metadata: { stripeCustomerId: "cus_new" } },
        organizationId: "org_2",
      },
      headers: expect.any(Headers) as Headers,
    });
  });

  it("throws when the workspace does not exist", async () => {
    const getFullOrganization = vi.fn().mockResolvedValue(null);
    mocks.ensureAuthReady.mockResolvedValue({
      api: { getFullOrganization, updateOrganization: vi.fn() },
    });

    await expect(ensureStripeCustomerForWorkspace("org_missing", "x@x.test", "X")).rejects.toThrow(
      /org_missing not found/,
    );
  });
});
