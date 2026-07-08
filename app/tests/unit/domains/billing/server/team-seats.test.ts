import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STRIPE_ATLAS_CATALOG_ENV_KEY,
  createStripeAtlasCatalogFixture,
} from "../../../../fixtures/billing/stripe-price-envs";

const mocks = vi.hoisted(() => ({
  getStripeClient: vi.fn(),
  ensureAuthReady: vi.fn(),
  queryActiveTeamSubscriptionId: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/domains/billing/server/stripe-client", () => ({
  getStripeClient: mocks.getStripeClient,
}));
vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: mocks.ensureAuthReady,
}));
vi.mock("@/domains/access/server/workspace-products", () => ({
  queryActiveTeamSubscriptionId: mocks.queryActiveTeamSubscriptionId,
}));

describe("syncTeamSeats", () => {
  const BASE_MONTHLY = "price_team_monthly";
  const BASE_YEARLY = "price_team_yearly";
  const SEAT_MONTHLY = "price_team_seat_monthly";
  const SEAT_YEARLY = "price_team_seat_yearly";

  interface StripeItem {
    id: string;
    price: { id: string };
    quantity: number;
  }

  const retrieve = vi.fn();
  const update = vi.fn();
  const create = vi.fn();
  const del = vi.fn();
  const getFullOrganization = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv(STRIPE_ATLAS_CATALOG_ENV_KEY, createStripeAtlasCatalogFixture());
    mocks.getStripeClient.mockReset();
    mocks.ensureAuthReady.mockReset();
    mocks.queryActiveTeamSubscriptionId.mockReset();
    retrieve.mockReset();
    update.mockReset();
    create.mockReset();
    del.mockReset();
    getFullOrganization.mockReset();

    mocks.getStripeClient.mockReturnValue({
      subscriptions: { retrieve },
      subscriptionItems: { update, create, del },
    });
    mocks.ensureAuthReady.mockResolvedValue({ api: { getFullOrganization } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function syncTeamSeats(workspaceId: string): Promise<void> {
    const mod = await import("@/domains/billing/server/team-seats");
    return mod.syncTeamSeats(workspaceId);
  }

  function withSubscription(items: StripeItem[], members: number | null): void {
    retrieve.mockResolvedValue({ items: { data: items } });
    getFullOrganization.mockResolvedValue(
      members === null
        ? null
        : { members: Array.from({ length: members }, (_, i) => ({ id: `m${i}` })) },
    );
  }

  function baseItem(priceId: string): StripeItem {
    return { id: "si_base", price: { id: priceId }, quantity: 1 };
  }

  function seatItem(priceId: string, quantity: number): StripeItem {
    return { id: "si_seat", price: { id: priceId }, quantity };
  }

  it("does nothing when the workspace has no active Team subscription", async () => {
    mocks.queryActiveTeamSubscriptionId.mockResolvedValue(null);

    await syncTeamSeats("org_1");

    expect(mocks.ensureAuthReady).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("updates the seat quantity when membership exceeds the billed seats", async () => {
    mocks.queryActiveTeamSubscriptionId.mockResolvedValue("sub_1");
    withSubscription([baseItem(BASE_MONTHLY), seatItem(SEAT_MONTHLY, 2)], 4);

    await syncTeamSeats("org_1");

    expect(update).toHaveBeenCalledWith("si_seat", {
      quantity: 3,
      proration_behavior: "create_prorations",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("does nothing when the billed seats already match membership", async () => {
    mocks.queryActiveTeamSubscriptionId.mockResolvedValue("sub_1");
    withSubscription([baseItem(BASE_YEARLY), seatItem(SEAT_YEARLY, 2)], 3);

    await syncTeamSeats("org_1");

    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a monthly seat item when none exists yet", async () => {
    mocks.queryActiveTeamSubscriptionId.mockResolvedValue("sub_1");
    withSubscription([baseItem(BASE_MONTHLY)], 3);

    await syncTeamSeats("org_1");

    expect(create).toHaveBeenCalledWith({
      subscription: "sub_1",
      price: SEAT_MONTHLY,
      quantity: 2,
      proration_behavior: "create_prorations",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("creates a yearly seat item for a yearly subscription", async () => {
    mocks.queryActiveTeamSubscriptionId.mockResolvedValue("sub_1");
    withSubscription([baseItem(BASE_YEARLY)], 3);

    await syncTeamSeats("org_1");

    expect(create).toHaveBeenCalledWith({
      subscription: "sub_1",
      price: SEAT_YEARLY,
      quantity: 2,
      proration_behavior: "create_prorations",
    });
  });

  it("does not create a seat item when only the owner remains", async () => {
    mocks.queryActiveTeamSubscriptionId.mockResolvedValue("sub_1");
    withSubscription([baseItem(BASE_MONTHLY)], 1);

    await syncTeamSeats("org_1");

    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("deletes the seat item when the last teammate leaves", async () => {
    mocks.queryActiveTeamSubscriptionId.mockResolvedValue("sub_1");
    withSubscription([baseItem(BASE_MONTHLY), seatItem(SEAT_MONTHLY, 2)], 1);

    await syncTeamSeats("org_1");

    expect(del).toHaveBeenCalledWith("si_seat", { proration_behavior: "create_prorations" });
    expect(update).not.toHaveBeenCalled();
  });

  it("treats a missing organization as zero seats and deletes the existing seat item", async () => {
    mocks.queryActiveTeamSubscriptionId.mockResolvedValue("sub_1");
    withSubscription([baseItem(BASE_MONTHLY), seatItem(SEAT_MONTHLY, 3)], null);

    await syncTeamSeats("org_1");

    expect(del).toHaveBeenCalledWith("si_seat", { proration_behavior: "create_prorations" });
    expect(update).not.toHaveBeenCalled();
  });

  it("treats an organization without a members array as zero seats", async () => {
    mocks.queryActiveTeamSubscriptionId.mockResolvedValue("sub_1");
    retrieve.mockResolvedValue({ items: { data: [baseItem(BASE_MONTHLY)] } });
    getFullOrganization.mockResolvedValue({});

    await syncTeamSeats("org_1");

    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("throws when the seat price is not configured but seats are needed", async () => {
    vi.stubEnv(
      STRIPE_ATLAS_CATALOG_ENV_KEY,
      createStripeAtlasCatalogFixture({
        prices: { "team-seat-monthly": "" },
      }),
    );
    mocks.queryActiveTeamSubscriptionId.mockResolvedValue("sub_1");
    withSubscription([baseItem(BASE_MONTHLY)], 3);

    await expect(syncTeamSeats("org_1")).rejects.toThrow(
      /STRIPE_ATLAS_CATALOG\.prices\.team-seat-monthly/,
    );
  });

  it("falls back to the monthly seat price when no recognized base item is present", async () => {
    mocks.queryActiveTeamSubscriptionId.mockResolvedValue("sub_1");
    withSubscription([{ id: "si_legacy", price: { id: "price_legacy" }, quantity: 1 }], 3);

    await syncTeamSeats("org_1");

    expect(create).toHaveBeenCalledWith({
      subscription: "sub_1",
      price: SEAT_MONTHLY,
      quantity: 2,
      proration_behavior: "create_prorations",
    });
  });
});

describe("resolveActiveTeamBillingInterval", () => {
  const BASE_MONTHLY = "price_team_monthly";
  const BASE_YEARLY = "price_team_yearly";

  const retrieve = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv(STRIPE_ATLAS_CATALOG_ENV_KEY, createStripeAtlasCatalogFixture());
    mocks.getStripeClient.mockReset();
    mocks.queryActiveTeamSubscriptionId.mockReset();
    retrieve.mockReset();
    mocks.getStripeClient.mockReturnValue({ subscriptions: { retrieve } });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function resolveActiveTeamBillingInterval(workspaceId: string): Promise<string> {
    const mod = await import("@/domains/billing/server/team-seats");
    return mod.resolveActiveTeamBillingInterval(workspaceId);
  }

  it("defaults to monthly when there is no active Team subscription", async () => {
    mocks.queryActiveTeamSubscriptionId.mockResolvedValue(null);

    expect(await resolveActiveTeamBillingInterval("org_1")).toBe("monthly");
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("resolves yearly when the base line item is the yearly price", async () => {
    mocks.queryActiveTeamSubscriptionId.mockResolvedValue("sub_1");
    retrieve.mockResolvedValue({
      items: { data: [{ id: "si", price: { id: BASE_YEARLY }, quantity: 1 }] },
    });

    expect(await resolveActiveTeamBillingInterval("org_1")).toBe("yearly");
  });

  it("resolves monthly when the base line item is the monthly price", async () => {
    mocks.queryActiveTeamSubscriptionId.mockResolvedValue("sub_1");
    retrieve.mockResolvedValue({
      items: { data: [{ id: "si", price: { id: BASE_MONTHLY }, quantity: 1 }] },
    });

    expect(await resolveActiveTeamBillingInterval("org_1")).toBe("monthly");
  });

  it("defaults to monthly when no recognized base item is present", async () => {
    mocks.queryActiveTeamSubscriptionId.mockResolvedValue("sub_1");
    retrieve.mockResolvedValue({
      items: { data: [{ id: "si", price: { id: "price_legacy" }, quantity: 1 }] },
    });

    expect(await resolveActiveTeamBillingInterval("org_1")).toBe("monthly");
  });
});
