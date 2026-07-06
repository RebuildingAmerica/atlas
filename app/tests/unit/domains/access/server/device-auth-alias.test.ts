import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authHandler: vi.fn((request: Request) =>
    Promise.resolve(new Response(`handled:${new URL(request.url).pathname}:${request.method}`)),
  ),
  ensureAuthReady: vi.fn(),
}));

vi.mock("@/domains/access/server/auth", () => ({
  ensureAuthReady: mocks.ensureAuthReady,
}));

describe("handleDeviceAuthAlias", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.authHandler.mockClear();
    mocks.ensureAuthReady.mockReset();
    mocks.ensureAuthReady.mockResolvedValue({ handler: mocks.authHandler });
  });

  it("rewrites the public device token endpoint to Better Auth's internal route", async () => {
    const { handleDeviceAuthAlias } = await import("@/domains/access/server/device-auth-alias");
    const response = await handleDeviceAuthAlias(
      new Request("https://atlas.test/device/token?poll=1", {
        body: JSON.stringify({ device_code: "device-code" }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
      "token",
    );

    const forwardedRequest = mocks.authHandler.mock.calls.at(0)?.[0];
    if (!forwardedRequest) throw new Error("Expected a forwarded auth request.");

    const forwardedUrl = new URL(forwardedRequest.url);
    expect(forwardedUrl.pathname).toBe("/api/auth/device/token");
    expect(forwardedUrl.search).toBe("?poll=1");
    expect(forwardedRequest.method).toBe("POST");
    expect(forwardedRequest.headers.get("Content-Type")).toBe("application/json");
    expect(await response.text()).toBe("handled:/api/auth/device/token:POST");
  });

  it("accepts OAuth form-encoded device code requests at the public route", async () => {
    const { handleDeviceAuthAlias } = await import("@/domains/access/server/device-auth-alias");
    await handleDeviceAuthAlias(
      new Request("https://atlas.test/device/code", {
        body: new URLSearchParams({
          client_id: "atlas-scout-cli",
          scope: "atlas:read",
        }),
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        method: "POST",
      }),
      "code",
    );

    const forwardedRequest = mocks.authHandler.mock.calls.at(0)?.[0];
    if (!forwardedRequest) throw new Error("Expected a forwarded auth request.");

    const forwardedUrl = new URL(forwardedRequest.url);
    expect(forwardedUrl.pathname).toBe("/api/auth/device/code");
    expect(forwardedRequest.headers.get("Content-Type")).toBe("application/json");
    expect(await forwardedRequest.json()).toEqual({
      client_id: "atlas-scout-cli",
      scope: "atlas:read",
    });
  });
});
