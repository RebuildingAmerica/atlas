import { expect, it, vi } from "vitest";

const bootstrap = vi.hoisted(() => ({
  loaded: new Set<string>(),
  getRouter: vi.fn(),
  registerIdentity: vi.fn(),
}));

vi.mock("@/router", () => {
  bootstrap.loaded.add("router");
  return { getRouter: bootstrap.getRouter };
});
vi.mock("@/start", () => {
  bootstrap.loaded.add("start");
  return { startInstance: {} };
});
vi.mock("@/domains/access/server/api-request-identity", () => {
  bootstrap.loaded.add("identity");
  return { registerApiRequestIdentity: bootstrap.registerIdentity };
});
vi.mock("@tanstack/react-start/server-entry", () => ({ default: { fetch: vi.fn() } }));

it("loads immutable SSR modules at startup without creating request state", async () => {
  await import("../../../../../server/worker");
  expect(bootstrap.loaded).toEqual(new Set(["router", "start", "identity"]));
  expect(bootstrap.getRouter).not.toHaveBeenCalled();
  expect(bootstrap.registerIdentity).not.toHaveBeenCalled();
});
