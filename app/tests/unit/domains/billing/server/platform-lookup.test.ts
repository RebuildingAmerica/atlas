import { afterEach, describe, expect, it, vi } from "vitest";
import { createLookupDatabase } from "../../../../helpers/billing/platform-lookup-db";
import { createSqlitePgPool } from "../../../../helpers/sqlite-pg-pool";

const mocks = vi.hoisted(() => ({
  getAuthDatabase: vi.fn(),
  getAuthPgPool: vi.fn(),
}));

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/domains/access/server/auth", () => mocks);

afterEach(() => {
  mocks.getAuthDatabase.mockReset();
  mocks.getAuthPgPool.mockReset();
});

describe("platform account lookup", () => {
  it.each([
    ["SQLite", false],
    ["Postgres", true],
  ])("finds an account by email with each workspace it holds (%s)", async (_label, usePool) => {
    const db = createLookupDatabase();
    mocks.getAuthPgPool.mockReturnValue(usePool ? createSqlitePgPool(db).pool : null);
    mocks.getAuthDatabase.mockReturnValue(usePool ? null : db);
    const { lookupPlatformAccount } = await import("@/domains/billing/server/platform-lookup");

    const result = await lookupPlatformAccount("  dana@EXAMPLE.org ");

    expect(result.account).toEqual({
      created_at: "2026-09-01T12:00:00.000Z",
      email: "Dana@Example.org",
      email_verified: true,
      id: "user_dana",
      name: "Dana",
    });
    expect(result.workspaces).toEqual([
      {
        adjustments: [
          {
            amount: 400,
            created_at: "2026-09-04T12:00:00.000Z",
            currency: "usd",
            kind: "refund",
            reason: "Charged twice",
          },
        ],
        id: "org_team",
        members: [
          { email: "Dana@Example.org", role: "owner" },
          { email: "other@example.org", role: "member" },
        ],
        name: "Reno Tenants",
        products: [
          {
            expires_at: null,
            granted_at: "2026-09-03T12:00:00.000Z",
            product: "atlas_team",
            purchase_intent_id: "pi_1",
            status: "active",
            stripe_subscription_id: "sub_1",
          },
        ],
        purchases: [
          {
            created_at: "2026-09-03T11:00:00.000Z",
            id: "pi_1",
            interval: "month",
            paid_at: "2026-09-03T11:05:00.000Z",
            product: "atlas_team",
            revocation_reason: null,
            revoked_at: null,
            status: "paid",
          },
        ],
        slug: "reno-tenants",
      },
    ]);
  });

  it("finds a workspace by slug, with no single account", async () => {
    const db = createLookupDatabase();
    mocks.getAuthPgPool.mockReturnValue(null);
    mocks.getAuthDatabase.mockReturnValue(db);
    const { lookupPlatformAccount } = await import("@/domains/billing/server/platform-lookup");

    const result = await lookupPlatformAccount("Reno-Tenants");

    expect(result.account).toBeNull();
    expect(result.workspaces.map((workspace) => workspace.slug)).toEqual(["reno-tenants"]);
  });

  it("finds nothing for an unknown email", async () => {
    mocks.getAuthPgPool.mockReturnValue(null);
    mocks.getAuthDatabase.mockReturnValue(createLookupDatabase());
    const { lookupPlatformAccount } = await import("@/domains/billing/server/platform-lookup");

    await expect(lookupPlatformAccount("nobody@example.org")).resolves.toEqual({
      account: null,
      workspaces: [],
    });
  });

  it("refuses to answer with no account database at all", async () => {
    mocks.getAuthPgPool.mockReturnValue(null);
    mocks.getAuthDatabase.mockReturnValue(null);
    const { lookupPlatformAccount } = await import("@/domains/billing/server/platform-lookup");

    await expect(lookupPlatformAccount("dana@example.org")).rejects.toThrow(
      "No account database is configured.",
    );
  });
});
