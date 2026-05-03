import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { START_HANDLER_SENTINEL, type ServerEntryMockState } from "../mocks/bootstrap";

const serverState = vi.hoisted<ServerEntryMockState>(() => ({
  createRouter: vi.fn(),
  createStartHandler: vi.fn(),
}));

vi.mock("@tanstack/react-start/server", () => ({
  createStartHandler: serverState.createStartHandler,
}));

vi.mock("@/router", () => ({
  createRouter: serverState.createRouter,
}));

describe("entry.server", () => {
  beforeEach(() => {
    serverState.createStartHandler.mockReset();
    serverState.createStartHandler.mockReturnValue(START_HANDLER_SENTINEL);
    serverState.createRouter.mockReset();
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("exports the start handler built from the shared createRouter factory", async () => {
    const entryServer = await import("@/entry.server");

    expect(serverState.createStartHandler).toHaveBeenCalledTimes(1);
    const call = serverState.createStartHandler.mock.calls[0] as [unknown] | undefined;
    if (!call) {
      throw new Error("createStartHandler was not called");
    }
    const [options] = call;
    expect(options).toEqual({ createRouter: serverState.createRouter });
    expect(entryServer.default).toBe(START_HANDLER_SENTINEL);
  });
});
