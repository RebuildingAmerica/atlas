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
      workspaceType: "team",
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
    expect(prepare).toHaveBeenCalledOnce();
    expect(get).toHaveBeenCalledWith("org_1", "user_1");
    await expect(response.json()).resolves.toMatchObject({
      role: "owner",
      workspaceType: "individual",
    });
  });
});
