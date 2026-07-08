import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";
import {
  ATLAS_MIGRATIONS,
  runAtlasCustomMigrations,
} from "@/domains/access/server/atlas-migrations";
import {
  buildResearchPassCheckoutCompletedEvent,
  readWorkspaceProduct,
} from "../../../../helpers/billing/webhook-handler-test-bed";

const mocks = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  ensureAuthReady: vi.fn(),
  getAuthDatabase: vi.fn<() => Database.Database | null>(),
  getAuthPgPool: vi.fn<() => unknown>(),
  getStripeWebhookSecret: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: mocks.ensureAuthReady,
  getAuthDatabase: mocks.getAuthDatabase,
  getAuthPgPool: mocks.getAuthPgPool,
}));
vi.mock("@/domains/billing/server/stripe-client", () => ({
  getStripeClient: () => ({
    webhooks: {
      constructEvent: mocks.constructEvent,
    },
  }),
  getStripeWebhookSecret: mocks.getStripeWebhookSecret,
}));

describe("handleStripeWebhook", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    runAtlasCustomMigrations(db, ATLAS_MIGRATIONS);
    mocks.constructEvent.mockReset();
    mocks.ensureAuthReady.mockReset();
    mocks.getAuthDatabase.mockReset();
    mocks.getAuthPgPool.mockReset();
    mocks.getStripeWebhookSecret.mockReset();
    mocks.getAuthDatabase.mockReturnValue(db);
    mocks.getAuthPgPool.mockReturnValue(null);
    mocks.getStripeWebhookSecret.mockReturnValue("whsec_test");
  });

  afterEach(() => {
    db.close();
  });

  async function deliverWebhook(event: Stripe.Event): Promise<Response> {
    mocks.constructEvent.mockReturnValue(event);

    const { handleStripeWebhook } = await import("@/domains/billing/server/webhook-handler");
    return handleStripeWebhook(
      new Request("https://atlas.test/api/stripe/webhook", {
        body: "{}",
        headers: { "stripe-signature": "sig_test" },
        method: "POST",
      }),
    );
  }

  it("stores a seven-day expiry for weekly Research Pass checkouts", async () => {
    const created = Date.parse("2026-07-01T00:00:00.000Z") / 1000;

    const response = await deliverWebhook(
      buildResearchPassCheckoutCompletedEvent({ created, interval: "weekly" }),
    );

    expect(response.status).toBe(200);
    expect(readWorkspaceProduct(db)).toEqual({
      expires_at: "2026-07-08T00:00:00.000Z",
      product: "atlas_research_pass",
      status: "active",
      stripe_event_at: "2026-07-01T00:00:00.000Z",
    });
  });

  it("stores a thirty-day expiry for 30-day Research Pass checkouts", async () => {
    const created = Date.parse("2026-07-01T00:00:00.000Z") / 1000;

    const response = await deliverWebhook(
      buildResearchPassCheckoutCompletedEvent({ created, interval: "once" }),
    );

    expect(response.status).toBe(200);
    expect(readWorkspaceProduct(db).expires_at).toBe("2026-07-31T00:00:00.000Z");
  });
});
