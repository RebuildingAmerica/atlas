import { expect, it, vi } from "vitest";

const backendLoaded = vi.hoisted(() => vi.fn());
vi.mock("@/domains/access/server/auth", () => {
  backendLoaded();
  return {
    ensureAuthReady: () => {
      throw new Error("Authentication backend unavailable");
    },
  };
});

it("loads the authentication backend only when serving a device request", async () => {
  const route = await import("@/domains/access/server/device-auth-alias");
  expect(backendLoaded).not.toHaveBeenCalled();
  await expect(
    route.handleDeviceAuthAlias(new Request("https://atlas.test/device/token"), "token"),
  ).rejects.toThrow("Authentication backend unavailable");
  expect(backendLoaded).toHaveBeenCalledOnce();
});
