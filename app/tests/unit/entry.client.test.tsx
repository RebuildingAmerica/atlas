// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ROUTER_SENTINEL, type StartClientElement } from "../mocks/bootstrap";

const clientState = vi.hoisted(() => ({
  createRouter: vi.fn(),
  hydrateRoot: vi.fn(),
  startClient: vi.fn(),
}));

vi.mock("react-dom/client", () => ({
  hydrateRoot: clientState.hydrateRoot,
}));

vi.mock("@tanstack/react-start/client", () => ({
  StartClient: clientState.startClient,
}));

vi.mock("@/router", () => ({
  createRouter: clientState.createRouter,
}));

describe("entry.client", () => {
  beforeEach(() => {
    clientState.hydrateRoot.mockReset();
    clientState.startClient.mockReset();
    clientState.startClient.mockImplementation(() => null);
    clientState.createRouter.mockReset();
    clientState.createRouter.mockReturnValue(ROUTER_SENTINEL);
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("hydrates the document with a StartClient bound to the constructed router", async () => {
    await import("@/entry.client");

    expect(clientState.createRouter).toHaveBeenCalledTimes(1);
    expect(clientState.hydrateRoot).toHaveBeenCalledTimes(1);

    const call = clientState.hydrateRoot.mock.calls[0] as [unknown, unknown] | undefined;
    if (!call) {
      throw new Error("hydrateRoot was not called");
    }
    const [container, element] = call;
    expect(container).toBe(document);
    const startClientElement = element as StartClientElement;
    expect(startClientElement.type).toBe(clientState.startClient);
    expect(startClientElement.props.router).toBe(ROUTER_SENTINEL);
  });
});
