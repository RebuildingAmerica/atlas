import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookupPlatformAccount: vi.fn() }));

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("@/domains/access/server/runtime", () => ({
  getAuthRuntimeConfig: () => ({ callbackSecret: "callback-test-secret" }), // pragma: allowlist secret
}));
vi.mock("@/domains/billing/server/platform-lookup", () => mocks);

describe("the platform lookup callback", () => {
  afterEach(() => {
    mocks.lookupPlatformAccount.mockReset();
  });

  it("answers the API's lookup, never cached", async () => {
    mocks.lookupPlatformAccount.mockResolvedValue({ account: null, workspaces: [] });
    const { handlePlatformLookupRequest } =
      await import("@/domains/billing/server/internal-platform-lookup");

    const response = await handlePlatformLookupRequest(
      new Request("https://atlas.test/api/auth/internal/platform-lookup", {
        body: JSON.stringify({ query: " dana@example.org " }),
        headers: { "X-Atlas-Callback-Secret": "callback-test-secret" }, // pragma: allowlist secret
        method: "POST",
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ account: null, workspaces: [] });
    expect(mocks.lookupPlatformAccount).toHaveBeenCalledWith("dana@example.org");
  });

  it("refuses a caller without the callback secret", async () => {
    const { handlePlatformLookupRequest } =
      await import("@/domains/billing/server/internal-platform-lookup");

    const response = await handlePlatformLookupRequest(
      new Request("https://atlas.test/api/auth/internal/platform-lookup", {
        body: JSON.stringify({ query: "x" }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(401);
    expect(mocks.lookupPlatformAccount).not.toHaveBeenCalled();
  });

  it.each([
    ["a body that is not JSON", "not json"],
    ["an empty query", JSON.stringify({ query: "  " })],
  ])("refuses %s", async (_label, body) => {
    const { handlePlatformLookupRequest } =
      await import("@/domains/billing/server/internal-platform-lookup");

    const response = await handlePlatformLookupRequest(
      new Request("https://atlas.test/api/auth/internal/platform-lookup", {
        body,
        headers: { "X-Atlas-Callback-Secret": "callback-test-secret" }, // pragma: allowlist secret
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
  });
});
