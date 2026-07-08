import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  createFakeApp,
  mockSuccessfulConnection,
  type FakeApp,
} from "./test-support/fake-app";
import {
  FULL_ENTITY_PAYLOAD,
  MINIMAL_ENTITY_PAYLOAD,
} from "./test-support/entity-fixtures";

const { useApp, useHostStyles } = vi.hoisted(() => ({
  useApp: vi.fn(),
  useHostStyles: vi.fn(),
}));

vi.mock("@modelcontextprotocol/ext-apps/react", () => ({
  useApp,
  useHostStyles,
}));

const { useSearchResultsData } = await import("./search-results-data");

let fakeApp: FakeApp;

beforeEach(() => {
  vi.clearAllMocks();
  fakeApp = createFakeApp();
  mockSuccessfulConnection(useApp, fakeApp);
});

afterEach(() => {
  cleanup();
});

const SEARCH_RESULTS_PAYLOAD = {
  items: [FULL_ENTITY_PAYLOAD, MINIMAL_ENTITY_PAYLOAD],
  total: 12,
  next_cursor: "2",
};

describe("useSearchResultsData", () => {
  it("returns null data and null error before any tool result arrives", () => {
    const { result } = renderHook(() => useSearchResultsData());

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoadingMore).toBe(false);
    expect(useApp).toHaveBeenCalledWith(
      expect.objectContaining({
        appInfo: { name: "atlas-search-results", version: "1.0.0" },
        capabilities: {},
      }),
    );
  });

  it("registers ontoolresult via useApp's onAppCreated and updates data on a valid tool result", () => {
    const { result } = renderHook(() => useSearchResultsData());

    act(() => {
      fakeApp.ontoolresult?.({
        structuredContent: SEARCH_RESULTS_PAYLOAD,
      } as unknown as CallToolResult);
    });

    expect(result.current.data?.items).toHaveLength(2);
    expect(result.current.data?.total).toBe(12);
    expect(result.current.error).toBeNull();
  });

  it("warns and leaves data null when the tool result doesn't parse into SearchResultsData", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { result } = renderHook(() => useSearchResultsData());

    act(() => {
      fakeApp.ontoolresult?.({
        structuredContent: { nope: true },
      } as unknown as CallToolResult);
    });

    expect(result.current.data).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("didn't parse"),
      { nope: true },
    );
    warnSpy.mockRestore();
  });

  it("surfaces a connect error reported by useApp instead of hanging silently", () => {
    const connectError = new Error("handshake failed");
    useApp.mockReturnValue({
      app: null,
      isConnected: false,
      error: connectError,
    });

    const { result } = renderHook(() => useSearchResultsData());

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe(connectError);
  });

  it("applies host styles via useHostStyles, passing the app and its current host context", () => {
    const hostContext = { theme: "dark" as const };
    fakeApp.getHostContext.mockReturnValue(hostContext);

    renderHook(() => useSearchResultsData());

    expect(useHostStyles).toHaveBeenCalledWith(fakeApp, hostContext);
  });

  it("logs runtime protocol errors reported after a successful connection", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    renderHook(() => useSearchResultsData());
    const runtimeError = new Error("transport dropped");

    fakeApp.onerror?.(runtimeError);

    expect(consoleErrorSpy).toHaveBeenCalledWith(runtimeError);
    consoleErrorSpy.mockRestore();
  });

  describe("loadMore", () => {
    it("is a no-op when there is no data yet", async () => {
      const { result } = renderHook(() => useSearchResultsData());

      await act(async () => {
        await result.current.loadMore();
      });

      expect(fakeApp.callServerTool).not.toHaveBeenCalled();
    });

    it("is a no-op when there is no further page", async () => {
      const { result } = renderHook(() => useSearchResultsData());

      act(() => {
        fakeApp.ontoolresult?.({
          structuredContent: { ...SEARCH_RESULTS_PAYLOAD, next_cursor: null },
        } as unknown as CallToolResult);
      });

      await act(async () => {
        await result.current.loadMore();
      });

      expect(fakeApp.callServerTool).not.toHaveBeenCalled();
    });

    it("ignores a concurrent loadMore call while one is already in flight", async () => {
      let resolveCallServerTool: ((value: CallToolResult) => void) | undefined;
      fakeApp.callServerTool.mockImplementation(
        () =>
          new Promise((resolve: (value: CallToolResult) => void) => {
            resolveCallServerTool = resolve;
          }),
      );
      const { result } = renderHook(() => useSearchResultsData());

      act(() => {
        fakeApp.ontoolresult?.({
          structuredContent: SEARCH_RESULTS_PAYLOAD,
        } as unknown as CallToolResult);
      });

      let firstCallPromise!: Promise<void>;
      act(() => {
        firstCallPromise = result.current.loadMore();
      });

      expect(result.current.isLoadingMore).toBe(true);

      await act(async () => {
        await result.current.loadMore();
      });

      expect(fakeApp.callServerTool).toHaveBeenCalledTimes(1);

      resolveCallServerTool?.({
        content: [],
        structuredContent: { items: [], total: 12, next_cursor: null },
      });
      await act(async () => {
        await firstCallPromise;
      });

      expect(result.current.isLoadingMore).toBe(false);
    });

    it("resends the original search's arguments plus the next cursor, and appends the new rows", async () => {
      fakeApp.callServerTool.mockResolvedValue({
        content: [],
        structuredContent: {
          items: [MINIMAL_ENTITY_PAYLOAD],
          total: 12,
          next_cursor: null,
        },
      });
      const { result } = renderHook(() => useSearchResultsData());

      act(() => {
        fakeApp.ontoolinput?.({
          arguments: { text: "housing", limit: 2 },
        });
        fakeApp.ontoolresult?.({
          structuredContent: SEARCH_RESULTS_PAYLOAD,
        } as unknown as CallToolResult);
      });

      await act(async () => {
        await result.current.loadMore();
      });

      expect(fakeApp.callServerTool).toHaveBeenCalledWith({
        name: "search_entities",
        arguments: { text: "housing", limit: 2, cursor: "2" },
      });
      expect(result.current.data?.items).toHaveLength(3);
      expect(result.current.data?.next_cursor).toBeNull();
      expect(result.current.isLoadingMore).toBe(false);
    });

    it("resends just the cursor when ontoolinput never fired", async () => {
      fakeApp.callServerTool.mockResolvedValue({
        content: [],
        structuredContent: { items: [], total: 12, next_cursor: null },
      });
      const { result } = renderHook(() => useSearchResultsData());

      act(() => {
        fakeApp.ontoolresult?.({
          structuredContent: SEARCH_RESULTS_PAYLOAD,
        } as unknown as CallToolResult);
      });

      await act(async () => {
        await result.current.loadMore();
      });

      expect(fakeApp.callServerTool).toHaveBeenCalledWith({
        name: "search_entities",
        arguments: { cursor: "2" },
      });
    });

    it("resends just the cursor when ontoolinput fires without an arguments field", async () => {
      fakeApp.callServerTool.mockResolvedValue({
        content: [],
        structuredContent: { items: [], total: 12, next_cursor: null },
      });
      const { result } = renderHook(() => useSearchResultsData());

      act(() => {
        fakeApp.ontoolinput?.({});
        fakeApp.ontoolresult?.({
          structuredContent: SEARCH_RESULTS_PAYLOAD,
        } as unknown as CallToolResult);
      });

      await act(async () => {
        await result.current.loadMore();
      });

      expect(fakeApp.callServerTool).toHaveBeenCalledWith({
        name: "search_entities",
        arguments: { cursor: "2" },
      });
    });

    it("warns and leaves items unchanged when the loadMore result doesn't parse", async () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      fakeApp.callServerTool.mockResolvedValue({
        content: [],
        structuredContent: { nope: true },
      });
      const { result } = renderHook(() => useSearchResultsData());

      act(() => {
        fakeApp.ontoolresult?.({
          structuredContent: SEARCH_RESULTS_PAYLOAD,
        } as unknown as CallToolResult);
      });

      await act(async () => {
        await result.current.loadMore();
      });

      expect(result.current.data?.items).toHaveLength(2);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("loadMore received a tool result"),
        { nope: true },
      );
      warnSpy.mockRestore();
    });

    it("logs and preserves existing data when callServerTool rejects", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const loadMoreError = new Error("transport dropped");
      fakeApp.callServerTool.mockRejectedValue(loadMoreError);
      const { result } = renderHook(() => useSearchResultsData());

      act(() => {
        fakeApp.ontoolresult?.({
          structuredContent: SEARCH_RESULTS_PAYLOAD,
        } as unknown as CallToolResult);
      });

      await act(async () => {
        await result.current.loadMore();
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(loadMoreError);
      expect(result.current.data?.items).toHaveLength(2);
      expect(result.current.isLoadingMore).toBe(false);
      consoleErrorSpy.mockRestore();
    });
  });
});
