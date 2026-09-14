import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ registerApiRequestIdentity: vi.fn() }));

vi.mock("@/domains/access/server/api-request-identity", () => ({
  registerApiRequestIdentity: mocks.registerApiRequestIdentity,
}));

import {
  atlasApiErrorAdapter,
  userFacingErrorAdapter,
} from "@/platform/errors/error-serialization";
import { isServerFunctionRequest, startInstance } from "@/start";

describe("startInstance", () => {
  it("keeps visitor-facing and Atlas API errors recognizable after a server function", async () => {
    const options = await startInstance.getOptions();

    expect(options.serializationAdapters).toEqual([userFacingErrorAdapter, atlasApiErrorAdapter]);
  });

  it("checks CSRF only on server function calls, as the default middleware does", () => {
    expect(isServerFunctionRequest({ handlerType: "serverFn" })).toBe(true);
    expect(isServerFunctionRequest({ handlerType: "router" })).toBe(false);
  });

  it("keeps CSRF protection and names the visitor before a request continues", async () => {
    const options = await startInstance.getOptions();
    const [csrf, identity] = options.requestMiddleware ?? [];
    const server = identity?.options.server;
    const next = vi.fn().mockResolvedValue("continued");
    if (!server) {
      throw new TypeError("Expected the visitor identity middleware to run on the server.");
    }
    const request = {
      context: {},
      handlerType: "router",
      next,
      pathname: "/browse",
      request: new Request("https://atlas.test/browse"),
    } as unknown as Parameters<typeof server>[0];

    expect(csrf).toBeDefined();
    await expect(server(request)).resolves.toBe("continued");
    expect(mocks.registerApiRequestIdentity).toHaveBeenCalledOnce();
    expect(next).toHaveBeenCalledOnce();
  });
});
