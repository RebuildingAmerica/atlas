import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyMembershipRequest } from "@/domains/access/server/internal-membership";

const mocks = vi.hoisted(() => ({
  getAuthRuntimeConfig: vi.fn(),
  getAuthDatabase: vi.fn(),
  getAuthPgPool: vi.fn(),
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
}));

vi.mock("@/domains/access/server/auth", () => ({
  getAuthDatabase: mocks.getAuthDatabase,
  getAuthPgPool: mocks.getAuthPgPool,
}));

vi.mock("@/domains/access/server/workspace-products", () => ({
  queryActiveProducts: vi.fn().mockResolvedValue([]),
}));

describe("internal-membership", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getAuthRuntimeConfig.mockReset();
    mocks.getAuthDatabase.mockReset();
    mocks.getAuthPgPool.mockReset();

    mocks.getAuthRuntimeConfig.mockReturnValue({
      internalSecret: "test-secret",
    });
    mocks.getAuthDatabase.mockReturnValue(null);
    mocks.getAuthPgPool.mockReturnValue(null);
  });

  it("verifies the internal secret and returns 401 on mismatch", async () => {
    const request = new Request("http://localhost", {
      headers: { "x-atlas-internal-secret": "wrong" },
    });
    const response = await verifyMembershipRequest(request, "org_1", "user_1");

    expect(response.status).toBe(401);
  });

  it("returns 404 if the organization is not found", async () => {
    const request = new Request("http://localhost", {
      headers: { "x-atlas-internal-secret": "test-secret" },
    });
    const response = await verifyMembershipRequest(request, "missing", "user_1");

    expect(response.status).toBe(404);
  });

  it("returns 404 if the user is not a member of the organization", async () => {
    const get = vi.fn().mockReturnValue(null);
    const prepare = vi.fn().mockReturnValue({ get });
    mocks.getAuthDatabase.mockReturnValue({ prepare });

    const request = new Request("http://localhost", {
      headers: { "x-atlas-internal-secret": "test-secret" },
    });
    const response = await verifyMembershipRequest(request, "org_1", "user_1");

    expect(response.status).toBe(404);
  });

  it("returns membership details when confirmed", async () => {
    const get = vi.fn().mockReturnValue({
      metadata: { workspaceType: "team" },
      name: "Atlas",
      role: "admin",
      slug: "atlas",
    });
    const prepare = vi.fn().mockReturnValue({ get });
    mocks.getAuthDatabase.mockReturnValue({ prepare });

    const request = new Request("http://localhost", {
      headers: { "x-atlas-internal-secret": "test-secret" },
    });
    const response = await verifyMembershipRequest(request, "org_1", "user_1");

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      activeProducts: [],
      name: "Atlas",
      role: "admin",
      slug: "atlas",
      verifiedSsoDomains: [],
      workspaceDomain: null,
      workspaceType: "team",
    });
  });

  it("includes workspace domain and verified SSO domains in membership details", async () => {
    const membershipGet = vi.fn().mockReturnValue({
      metadata: { workspaceDomain: "atlas.test", workspaceType: "team" },
      name: "Atlas",
      role: "owner",
      slug: "atlas",
    });
    const providersAll = vi.fn().mockReturnValue([
      {
        domain: "atlas.test, ignored.test",
        domainVerified: 1,
        organizationId: "org_1",
      },
      {
        domain: "pending.test",
        domainVerified: 0,
        organizationId: "org_1",
      },
      {
        domain: "other.test",
        domainVerified: 1,
        organizationId: "other_org",
      },
    ]);
    const prepare = vi.fn((sql: string) => {
      if (sql.includes("ssoProvider")) {
        return { all: providersAll };
      }
      return { get: membershipGet };
    });
    mocks.getAuthDatabase.mockReturnValue({ prepare });

    const request = new Request("http://localhost", {
      headers: { "x-atlas-internal-secret": "test-secret" },
    });
    const response = await verifyMembershipRequest(request, "org_1", "user_1");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      role: "owner",
      verifiedSsoDomains: ["atlas.test", "ignored.test"],
      workspaceDomain: "atlas.test",
    });
  });

  it("parses stored JSON metadata from the membership lookup", async () => {
    const get = vi.fn().mockReturnValue({
      metadata: JSON.stringify({ workspaceType: "individual" }),
      name: "Atlas",
      role: "owner",
      slug: "atlas",
    });
    const prepare = vi.fn().mockReturnValue({ get });
    mocks.getAuthDatabase.mockReturnValue({ prepare });

    const request = new Request("http://localhost", {
      headers: { "x-atlas-internal-secret": "test-secret" },
    });
    const response = await verifyMembershipRequest(request, "org_1", "user_1");

    expect(response.status).toBe(200);
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(get).toHaveBeenCalledWith("org_1", "user_1");
    await expect(response.json()).resolves.toMatchObject({
      role: "owner",
      workspaceType: "individual",
    });
  });

  it("answers from PostgreSQL with the member's role and verified SSO domains", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            metadata: JSON.stringify({ workspaceDomain: "atlas.test", workspaceType: "team" }),
            name: "Atlas",
            role: "admin",
            slug: "atlas",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ domain: "Atlas.test, partner.example " }] });
    mocks.getAuthPgPool.mockReturnValue({ query });

    const response = await verifyMembershipRequest(
      new Request("http://localhost", { headers: { "x-atlas-internal-secret": "test-secret" } }),
      "org_1",
      "user_1",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      name: "Atlas",
      role: "admin",
      slug: "atlas",
      verifiedSsoDomains: ["atlas.test", "partner.example"],
      workspaceDomain: "atlas.test",
      workspaceType: "team",
    });
    expect(query.mock.calls[0]?.[1]).toEqual(["org_1", "user_1"]);
    expect(query.mock.calls[1]?.[1]).toEqual(["org_1"]);
  });

  it("reports a PostgreSQL non-member as not found", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    mocks.getAuthPgPool.mockReturnValue({ query });

    const response = await verifyMembershipRequest(
      new Request("http://localhost", { headers: { "x-atlas-internal-secret": "test-secret" } }),
      "org_1",
      "user_1",
    );

    expect(response.status).toBe(404);
  });

  it("ignores workspace metadata that is not valid JSON rather than failing the check", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ metadata: "{not json", name: "Atlas", role: "member", slug: "atlas" }],
      })
      .mockResolvedValueOnce({ rows: [] });
    mocks.getAuthPgPool.mockReturnValue({ query });

    const response = await verifyMembershipRequest(
      new Request("http://localhost", { headers: { "x-atlas-internal-secret": "test-secret" } }),
      "org_1",
      "user_1",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      role: "member",
      workspaceDomain: null,
      workspaceType: "individual",
    });
  });
});
