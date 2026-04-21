import { beforeEach, describe, expect, it, vi } from "vitest";
import { verifyMembershipRequest } from "@/domains/access/server/internal-membership";

const mocks = vi.hoisted(() => ({
  getAuthRuntimeConfig: vi.fn(),
  ensureAuthReady: vi.fn(),
}));

vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: mocks.getAuthRuntimeConfig,
}));

vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: mocks.ensureAuthReady,
}));

describe("internal-membership", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getAuthRuntimeConfig.mockReset();
    mocks.ensureAuthReady.mockReset();

    mocks.getAuthRuntimeConfig.mockReturnValue({
      internalSecret: "test-secret",
    });
  });

  it("verifies the internal secret and returns 401 on mismatch", async () => {
    const request = new Request("http://localhost", {
      headers: { "x-atlas-internal-secret": "wrong" },
    });
    const response = await verifyMembershipRequest(request, "org_1", "user_1");

    expect(response.status).toBe(401);
  });

  it("returns 404 if the organization is not found", async () => {
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        getFullOrganization: vi.fn().mockResolvedValue(null),
      },
    });

    const request = new Request("http://localhost", {
      headers: { "x-atlas-internal-secret": "test-secret" },
    });
    const response = await verifyMembershipRequest(request, "missing", "user_1");

    expect(response.status).toBe(404);
  });

  it("returns 404 if the user is not a member of the organization", async () => {
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        getFullOrganization: vi.fn().mockResolvedValue({
          id: "org_1",
          members: [{ userId: "other" }],
        }),
      },
    });

    const request = new Request("http://localhost", {
      headers: { "x-atlas-internal-secret": "test-secret" },
    });
    const response = await verifyMembershipRequest(request, "org_1", "user_1");

    expect(response.status).toBe(404);
  });

  it("returns membership details when confirmed", async () => {
    mocks.ensureAuthReady.mockResolvedValue({
      api: {
        getFullOrganization: vi.fn().mockResolvedValue({
          id: "org_1",
          name: "Atlas",
          slug: "atlas",
          members: [{ userId: "user_1", role: "admin" }],
          metadata: { workspaceType: "team" },
        }),
      },
    });

    const request = new Request("http://localhost", {
      headers: { "x-atlas-internal-secret": "test-secret" },
    });
    const response = await verifyMembershipRequest(request, "org_1", "user_1");

    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({
      name: "Atlas",
      role: "admin",
      slug: "atlas",
      workspaceType: "team",
    });
  });
});
