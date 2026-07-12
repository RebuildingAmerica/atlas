// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROUTE_TREE_SENTINEL,
  type CapturedRouterOptions,
  type RouterMockState,
} from "../mocks/bootstrap";

const routerState = vi.hoisted<RouterMockState>(() => ({
  createRouter: vi.fn(),
  lastOptions: null,
}));

vi.mock("@/routeTree.gen", () => ({
  routeTree: ROUTE_TREE_SENTINEL,
}));

vi.mock("@tanstack/react-router", () => ({
  createRouter: routerState.createRouter,
}));

describe("router", () => {
  beforeEach(() => {
    routerState.lastOptions = null;
    routerState.createRouter.mockReset();
    routerState.createRouter.mockImplementation((options: CapturedRouterOptions) => {
      routerState.lastOptions = options;
      return { __atlasRouter: true, options } as const;
    });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("instantiates the TanStack router with the generated route tree and scroll restoration", async () => {
    const { getRouter } = await import("@/router");

    const router = getRouter();

    expect(routerState.createRouter).toHaveBeenCalledTimes(1);
    const options = routerState.lastOptions;
    if (options === null) {
      throw new Error("createRouter was not invoked");
    }
    expect(options.routeTree).toBe(ROUTE_TREE_SENTINEL);
    expect(options.scrollRestoration).toBe(true);
    expect(typeof options.Wrap).toBe("function");
    expect(router).toMatchObject({ __atlasRouter: true });
  });

  it("threads the QueryClient into router context for route loaders", async () => {
    const { getRouter } = await import("@/router");
    const { useQueryClient } = await import("@tanstack/react-query");

    getRouter();
    const options = routerState.lastOptions;
    if (options === null) {
      throw new Error("createRouter was not invoked");
    }

    const routerQueryClient = options.context?.queryClient;
    expect(routerQueryClient).toBeDefined();

    function Probe() {
      const queryClient = useQueryClient();
      return (
        <span data-testid="same-query-client">{String(queryClient === routerQueryClient)}</span>
      );
    }

    render(
      <options.Wrap>
        <Probe />
      </options.Wrap>,
    );

    expect(screen.getByTestId("same-query-client")).toHaveTextContent("true");
  });

  it("createRouter delegates to getRouter so SSR and client share configuration", async () => {
    const routerModule = await import("@/router");

    routerModule.createRouter();

    expect(routerState.createRouter).toHaveBeenCalledTimes(1);
  });

  it("Wrap mounts QueryClient, ToastProvider, and ConfirmDialogProvider for descendants", async () => {
    const { getRouter } = await import("@/router");
    const { useToast } = await import("@/platform/ui/toast");
    const { useConfirmDialog } = await import("@/platform/ui/confirm-dialog");
    const { useQueryClient } = await import("@tanstack/react-query");

    getRouter();
    const options = routerState.lastOptions;
    if (options === null) {
      throw new Error("createRouter was not invoked");
    }
    const { Wrap } = options;

    function Probe() {
      const queryClient = useQueryClient();
      const toast = useToast();
      const confirmDialog = useConfirmDialog();
      return (
        <div>
          <span data-testid="query-default-stale">
            {String(queryClient.getDefaultOptions().queries?.staleTime)}
          </span>
          <span data-testid="query-default-gc">
            {String(queryClient.getDefaultOptions().queries?.gcTime)}
          </span>
          <span data-testid="query-default-retry">
            {String(queryClient.getDefaultOptions().queries?.retry)}
          </span>
          <span data-testid="query-default-focus">
            {String(queryClient.getDefaultOptions().queries?.refetchOnWindowFocus)}
          </span>
          <button
            type="button"
            onClick={() => {
              toast.show("hello");
            }}
          >
            toast
          </button>
          <button
            type="button"
            onClick={() => {
              void confirmDialog.confirm({ title: "ok?", body: "are you sure?" });
            }}
          >
            confirm
          </button>
        </div>
      );
    }

    render(
      <Wrap>
        <Probe />
      </Wrap>,
    );

    expect(screen.getByTestId("query-default-stale")).toHaveTextContent(String(1000 * 60 * 5));
    expect(screen.getByTestId("query-default-gc")).toHaveTextContent(String(1000 * 60 * 30));
    expect(screen.getByTestId("query-default-retry")).toHaveTextContent("1");
    expect(screen.getByTestId("query-default-focus")).toHaveTextContent("false");

    fireEvent.click(screen.getByText("toast"));
    expect(screen.getByText("hello")).toBeInTheDocument();

    fireEvent.click(screen.getByText("confirm"));
    expect(screen.getByText("ok?")).toBeInTheDocument();
  });
});
