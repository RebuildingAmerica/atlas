import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Shape of the one argument `App#callServerTool` takes. */
interface CallServerToolParams {
  name: string;
  arguments?: Record<string, unknown>;
}

/**
 * `App#callServerTool`'s real signature, narrowed to a plain call signature
 * (no construct signature). `vi.fn()`'s default generic (`Procedure =
 * (...args: any[]) => any`) is structurally assignable to a construct
 * signature too, purely because of `any` — which makes `mockImplementation`
 * accept a false three-way union including a void-returning overload, and
 * `@typescript-eslint/no-misused-promises` then (correctly, given that
 * inferred type) flags a Promise-returning implementation as a misuse. This
 * explicit, non-`any` signature keeps the mock's inferred type unambiguous.
 */
type FakeCallServerTool = (
  params: CallServerToolParams,
) => Promise<CallToolResult>;

/**
 * Minimal stand-in for the real `App` instance `useApp` would create. Models
 * the members either `useEntityCardData` or `useSearchResultsData` touches:
 * `ontoolresult`/`onerror`/`getHostContext` (both hooks), plus
 * `ontoolinput`/`callServerTool` (pagination, `useSearchResultsData` only).
 */
interface FakeApp {
  ontoolinput?: (params: { arguments?: Record<string, unknown> }) => void;
  ontoolresult?: (result: CallToolResult) => void;
  onerror?: (error: Error) => void;
  getHostContext: ReturnType<typeof vi.fn>;
  callServerTool: ReturnType<typeof vi.fn<FakeCallServerTool>>;
}

function createFakeApp(): FakeApp {
  return {
    getHostContext: vi.fn().mockReturnValue(undefined),
    callServerTool: vi.fn<FakeCallServerTool>(),
  };
}

const { useApp, useHostStyles } = vi.hoisted(() => ({
  useApp: vi.fn(),
  useHostStyles: vi.fn(),
}));

vi.mock("@modelcontextprotocol/ext-apps/react", () => ({
  useApp,
  useHostStyles,
}));

const {
  parseConnectionsData,
  parseEntityCardData,
  parseSearchResultsData,
  useConnectionsData,
  useEntityCardData,
  useSearchResultsData,
} = await import("./app-client");

const FULL_PAYLOAD = {
  id: "e1",
  name: "Jane Doe",
  type: "person",
  description: "A civic organizer.",
  photo_url: "https://example.com/jane.jpg",
  address: { display: "Columbus, OH" },
  trust: { level: "atlas_verified" },
  source_count: 4,
  profile_url: "https://atlas.example.com/profiles/people/jane",
};

const MINIMAL_PAYLOAD = {
  id: "e2",
  name: "Acme Org",
  type: "organization",
  source_count: 0,
};

let fakeApp: FakeApp;

beforeEach(() => {
  vi.clearAllMocks();
  fakeApp = createFakeApp();
  useApp.mockImplementation(
    ({ onAppCreated }: { onAppCreated?: (app: FakeApp) => void }) => {
      onAppCreated?.(fakeApp);
      return { app: fakeApp as unknown as App, isConnected: true, error: null };
    },
  );
});

afterEach(() => {
  cleanup();
});

describe("parseEntityCardData", () => {
  it("narrows a full nested EntityResponse-shaped payload down to EntityCardData", () => {
    expect(parseEntityCardData(FULL_PAYLOAD)).toEqual({
      id: "e1",
      name: "Jane Doe",
      type: "person",
      description: "A civic organizer.",
      photo_url: "https://example.com/jane.jpg",
      place_label: "Columbus, OH",
      trust_level: "atlas_verified",
      source_count: 4,
      profile_url: "https://atlas.example.com/profiles/people/jane",
    });
  });

  it("defaults every optional field when only the required fields are present", () => {
    expect(parseEntityCardData(MINIMAL_PAYLOAD)).toEqual({
      id: "e2",
      name: "Acme Org",
      type: "organization",
      description: null,
      photo_url: null,
      place_label: null,
      trust_level: "unverified",
      source_count: 0,
      profile_url: null,
    });
  });

  it("falls back to unverified when trust.level is present but not a known value", () => {
    const parsed = parseEntityCardData({
      ...MINIMAL_PAYLOAD,
      trust: { level: "bogus" },
    });
    expect(parsed?.trust_level).toBe("unverified");
  });

  it("treats a non-https profile_url as null", () => {
    const parsed = parseEntityCardData({
      ...MINIMAL_PAYLOAD,
      profile_url: "javascript:alert(1)",
    });
    expect(parsed?.profile_url).toBeNull();
  });

  it("returns null for null input", () => {
    expect(parseEntityCardData(null)).toBeNull();
  });

  it("returns null for a non-object input", () => {
    expect(parseEntityCardData("not an object")).toBeNull();
  });

  it("returns null when id is not a string", () => {
    expect(parseEntityCardData({ ...MINIMAL_PAYLOAD, id: 123 })).toBeNull();
  });

  it("returns null when name is not a string", () => {
    expect(parseEntityCardData({ ...MINIMAL_PAYLOAD, name: 123 })).toBeNull();
  });

  it("returns null when type is not a known entity type", () => {
    expect(
      parseEntityCardData({ ...MINIMAL_PAYLOAD, type: "spaceship" }),
    ).toBeNull();
  });

  it("returns null when source_count is not a number", () => {
    expect(
      parseEntityCardData({ ...MINIMAL_PAYLOAD, source_count: "four" }),
    ).toBeNull();
  });
});

describe("useEntityCardData", () => {
  it("returns null data and null error before any tool result arrives", () => {
    const { result } = renderHook(() => useEntityCardData());

    expect(result.current).toEqual({ data: null, error: null });
    expect(useApp).toHaveBeenCalledWith(
      expect.objectContaining({
        appInfo: { name: "atlas-entity-card", version: "1.0.0" },
        capabilities: {},
      }),
    );
  });

  it("registers ontoolresult via useApp's onAppCreated and updates data on a valid tool result", () => {
    const { result } = renderHook(() => useEntityCardData());

    act(() => {
      fakeApp.ontoolresult?.({
        structuredContent: FULL_PAYLOAD,
      } as unknown as CallToolResult);
    });

    expect(result.current.data?.id).toBe("e1");
    expect(result.current.error).toBeNull();
  });

  it("warns and leaves data null when the tool result doesn't parse into EntityCardData", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const { result } = renderHook(() => useEntityCardData());

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

    const { result } = renderHook(() => useEntityCardData());

    expect(result.current).toEqual({ data: null, error: connectError });
  });

  it("applies host styles via useHostStyles, passing the app and its current host context", () => {
    const hostContext = { theme: "dark" as const };
    fakeApp.getHostContext.mockReturnValue(hostContext);

    renderHook(() => useEntityCardData());

    expect(useHostStyles).toHaveBeenCalledWith(fakeApp, hostContext);
  });

  it("passes a null app and undefined context to useHostStyles when the connection failed", () => {
    useApp.mockReturnValue({
      app: null,
      isConnected: false,
      error: new Error("nope"),
    });

    renderHook(() => useEntityCardData());

    expect(useHostStyles).toHaveBeenCalledWith(null, undefined);
  });

  it("logs runtime protocol errors reported after a successful connection", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    renderHook(() => useEntityCardData());
    const runtimeError = new Error("transport dropped");

    fakeApp.onerror?.(runtimeError);

    expect(consoleErrorSpy).toHaveBeenCalledWith(runtimeError);
    consoleErrorSpy.mockRestore();
  });
});

const SEARCH_RESULTS_PAYLOAD = {
  items: [FULL_PAYLOAD, MINIMAL_PAYLOAD],
  total: 12,
  next_cursor: "2",
};

describe("parseSearchResultsData", () => {
  it("narrows a full EntityCollectionResponse-shaped payload down to SearchResultsData", () => {
    expect(parseSearchResultsData(SEARCH_RESULTS_PAYLOAD)).toEqual({
      items: [
        {
          id: "e1",
          name: "Jane Doe",
          type: "person",
          place_label: "Columbus, OH",
          trust_level: "atlas_verified",
          source_count: 4,
        },
        {
          id: "e2",
          name: "Acme Org",
          type: "organization",
          place_label: null,
          trust_level: "unverified",
          source_count: 0,
        },
      ],
      total: 12,
      next_cursor: "2",
    });
  });

  it("defaults next_cursor to null when it's absent", () => {
    const parsed = parseSearchResultsData({ items: [], total: 0 });
    expect(parsed?.next_cursor).toBeNull();
  });

  it("defaults next_cursor to null when it's present but not a string", () => {
    const parsed = parseSearchResultsData({
      items: [],
      total: 0,
      next_cursor: 2,
    });
    expect(parsed?.next_cursor).toBeNull();
  });

  it("drops an individual malformed item with a console warning, keeping the rest", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const parsed = parseSearchResultsData({
      items: [FULL_PAYLOAD, { nope: true }],
      total: 2,
      next_cursor: null,
    });

    expect(parsed?.items).toHaveLength(1);
    expect(parsed?.items[0]?.id).toBe("e1");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("dropped a list item"),
      { nope: true },
    );
    warnSpy.mockRestore();
  });

  it("returns null for null input", () => {
    expect(parseSearchResultsData(null)).toBeNull();
  });

  it("returns null for a non-object input", () => {
    expect(parseSearchResultsData("not an object")).toBeNull();
  });

  it("returns null when items is not an array", () => {
    expect(
      parseSearchResultsData({ items: "not an array", total: 0 }),
    ).toBeNull();
  });

  it("returns null when total is not a number", () => {
    expect(
      parseSearchResultsData({ items: [], total: "twelve" }),
    ).toBeNull();
  });
});

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
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
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
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
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
          items: [MINIMAL_PAYLOAD],
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
      const warnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
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
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
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

const CONNECTIONS_PAYLOAD = {
  entity_id: "e0",
  items: [
    {
      entity: FULL_PAYLOAD,
      relationships: [
        { type: "shared_place" },
        { type: "shared_issue_area", issue_area_ids: ["housing"] },
      ],
    },
    {
      entity: MINIMAL_PAYLOAD,
      relationships: [{ type: "affiliated_organization" }],
    },
  ],
  total: 8,
  next_cursor: "2",
};

describe("parseConnectionsData", () => {
  it("narrows a full EntityRelationshipsResponse-shaped payload down to ConnectionsData", () => {
    expect(parseConnectionsData(CONNECTIONS_PAYLOAD)).toEqual({
      entity_id: "e0",
      items: [
        {
          entity: {
            id: "e1",
            name: "Jane Doe",
            type: "person",
            place_label: "Columbus, OH",
            trust_level: "atlas_verified",
            source_count: 4,
          },
          relationships: [
            { type: "shared_place", issue_area_ids: [], source_ids: [] },
            {
              type: "shared_issue_area",
              issue_area_ids: ["housing"],
              source_ids: [],
            },
          ],
        },
        {
          entity: {
            id: "e2",
            name: "Acme Org",
            type: "organization",
            place_label: null,
            trust_level: "unverified",
            source_count: 0,
          },
          relationships: [
            { type: "affiliated_organization", issue_area_ids: [], source_ids: [] },
          ],
        },
      ],
      total: 8,
      next_cursor: "2",
    });
  });

  it("defaults next_cursor to null when it's absent", () => {
    const parsed = parseConnectionsData({ entity_id: "e0", items: [], total: 0 });
    expect(parsed?.next_cursor).toBeNull();
  });

  it("defaults next_cursor to null when it's present but not a string", () => {
    const parsed = parseConnectionsData({
      entity_id: "e0",
      items: [],
      total: 0,
      next_cursor: 2,
    });
    expect(parsed?.next_cursor).toBeNull();
  });

  it("defaults relationships to an empty array when the field is missing", () => {
    const parsed = parseConnectionsData({
      entity_id: "e0",
      items: [{ entity: FULL_PAYLOAD }],
      total: 1,
      next_cursor: null,
    });
    expect(parsed?.items[0]?.relationships).toEqual([]);
  });

  it("drops non-string entries from issue_area_ids and source_ids", () => {
    const parsed = parseConnectionsData({
      entity_id: "e0",
      items: [
        {
          entity: FULL_PAYLOAD,
          relationships: [
            {
              type: "shared_issue_area",
              issue_area_ids: ["housing", 42, null],
              source_ids: ["src-1", false],
            },
          ],
        },
      ],
      total: 1,
      next_cursor: null,
    });
    expect(parsed?.items[0]?.relationships[0]).toEqual({
      type: "shared_issue_area",
      issue_area_ids: ["housing"],
      source_ids: ["src-1"],
    });
  });

  it("drops an individual malformed item with a console warning, keeping the rest", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const parsed = parseConnectionsData({
      entity_id: "e0",
      items: [{ entity: FULL_PAYLOAD, relationships: [] }, { nope: true }],
      total: 2,
      next_cursor: null,
    });

    expect(parsed?.items).toHaveLength(1);
    expect(parsed?.items[0]?.entity.id).toBe("e1");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("dropped a list item"),
      { nope: true },
    );
    warnSpy.mockRestore();
  });

  it("drops a non-object item within items", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const parsed = parseConnectionsData({
      entity_id: "e0",
      items: ["not an object"],
      total: 1,
      next_cursor: null,
    });

    expect(parsed?.items).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("drops an item whose entity doesn't parse into SearchResultRow", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const parsed = parseConnectionsData({
      entity_id: "e0",
      items: [{ entity: { nope: true }, relationships: [] }],
      total: 1,
      next_cursor: null,
    });

    expect(parsed?.items).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("drops a malformed relationship within an item, keeping the rest of that item's relationships", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const parsed = parseConnectionsData({
      entity_id: "e0",
      items: [
        {
          entity: FULL_PAYLOAD,
          relationships: [{ type: "shared_place" }, { nope: true }],
        },
      ],
      total: 1,
      next_cursor: null,
    });

    expect(parsed?.items[0]?.relationships).toHaveLength(1);
    expect(parsed?.items[0]?.relationships[0]?.type).toBe("shared_place");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("dropped a relationship"),
      { nope: true },
    );
    warnSpy.mockRestore();
  });

  it("drops a non-object relationship entry", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const parsed = parseConnectionsData({
      entity_id: "e0",
      items: [{ entity: FULL_PAYLOAD, relationships: ["not an object"] }],
      total: 1,
      next_cursor: null,
    });

    expect(parsed?.items[0]?.relationships).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("drops a relationship whose type is not a string", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    const parsed = parseConnectionsData({
      entity_id: "e0",
      items: [{ entity: FULL_PAYLOAD, relationships: [{ type: 123 }] }],
      total: 1,
      next_cursor: null,
    });

    expect(parsed?.items[0]?.relationships).toHaveLength(0);
    warnSpy.mockRestore();
  });

  it("returns null for null input", () => {
    expect(parseConnectionsData(null)).toBeNull();
  });

  it("returns null for a non-object input", () => {
    expect(parseConnectionsData("not an object")).toBeNull();
  });

  it("returns null when entity_id is not a string", () => {
    expect(
      parseConnectionsData({ entity_id: 123, items: [], total: 0 }),
    ).toBeNull();
  });

  it("returns null when items is not an array", () => {
    expect(
      parseConnectionsData({ entity_id: "e0", items: "not an array", total: 0 }),
    ).toBeNull();
  });

  it("returns null when total is not a number", () => {
    expect(
      parseConnectionsData({ entity_id: "e0", items: [], total: "eight" }),
    ).toBeNull();
  });
});

describe("useConnectionsData", () => {
  it("returns null data and null error before any tool result arrives", () => {
    const { result } = renderHook(() => useConnectionsData());

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.isLoadingMore).toBe(false);
    expect(useApp).toHaveBeenCalledWith(
      expect.objectContaining({
        appInfo: { name: "atlas-connections", version: "1.0.0" },
        capabilities: {},
      }),
    );
  });

  it("registers ontoolresult via useApp's onAppCreated and updates data on a valid tool result", () => {
    const { result } = renderHook(() => useConnectionsData());

    act(() => {
      fakeApp.ontoolresult?.({
        structuredContent: CONNECTIONS_PAYLOAD,
      } as unknown as CallToolResult);
    });

    expect(result.current.data?.items).toHaveLength(2);
    expect(result.current.data?.total).toBe(8);
    expect(result.current.error).toBeNull();
  });

  it("warns and leaves data null when the tool result doesn't parse into ConnectionsData", () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const { result } = renderHook(() => useConnectionsData());

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

    const { result } = renderHook(() => useConnectionsData());

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe(connectError);
  });

  it("applies host styles via useHostStyles, passing the app and its current host context", () => {
    const hostContext = { theme: "dark" as const };
    fakeApp.getHostContext.mockReturnValue(hostContext);

    renderHook(() => useConnectionsData());

    expect(useHostStyles).toHaveBeenCalledWith(fakeApp, hostContext);
  });

  it("logs runtime protocol errors reported after a successful connection", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    renderHook(() => useConnectionsData());
    const runtimeError = new Error("transport dropped");

    fakeApp.onerror?.(runtimeError);

    expect(consoleErrorSpy).toHaveBeenCalledWith(runtimeError);
    consoleErrorSpy.mockRestore();
  });

  describe("loadMore", () => {
    it("is a no-op when there is no data yet", async () => {
      const { result } = renderHook(() => useConnectionsData());

      await act(async () => {
        await result.current.loadMore();
      });

      expect(fakeApp.callServerTool).not.toHaveBeenCalled();
    });

    it("is a no-op when there is no further page", async () => {
      const { result } = renderHook(() => useConnectionsData());

      act(() => {
        fakeApp.ontoolresult?.({
          structuredContent: { ...CONNECTIONS_PAYLOAD, next_cursor: null },
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
      const { result } = renderHook(() => useConnectionsData());

      act(() => {
        fakeApp.ontoolresult?.({
          structuredContent: CONNECTIONS_PAYLOAD,
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
        structuredContent: { entity_id: "e0", items: [], total: 8, next_cursor: null },
      });
      await act(async () => {
        await firstCallPromise;
      });

      expect(result.current.isLoadingMore).toBe(false);
    });

    it("resends the original call's arguments plus the next cursor, and appends the new rows", async () => {
      fakeApp.callServerTool.mockResolvedValue({
        content: [],
        structuredContent: {
          entity_id: "e0",
          items: [{ entity: MINIMAL_PAYLOAD, relationships: [{ type: "shared_place" }] }],
          total: 8,
          next_cursor: null,
        },
      });
      const { result } = renderHook(() => useConnectionsData());

      act(() => {
        fakeApp.ontoolinput?.({
          arguments: { entity_id: "e0", limit: 2 },
        });
        fakeApp.ontoolresult?.({
          structuredContent: CONNECTIONS_PAYLOAD,
        } as unknown as CallToolResult);
      });

      await act(async () => {
        await result.current.loadMore();
      });

      expect(fakeApp.callServerTool).toHaveBeenCalledWith({
        name: "get_related_entities",
        arguments: { entity_id: "e0", limit: 2, cursor: "2" },
      });
      expect(result.current.data?.items).toHaveLength(3);
      expect(result.current.data?.next_cursor).toBeNull();
      expect(result.current.isLoadingMore).toBe(false);
    });

    it("resends just the cursor when ontoolinput never fired", async () => {
      fakeApp.callServerTool.mockResolvedValue({
        content: [],
        structuredContent: { entity_id: "e0", items: [], total: 8, next_cursor: null },
      });
      const { result } = renderHook(() => useConnectionsData());

      act(() => {
        fakeApp.ontoolresult?.({
          structuredContent: CONNECTIONS_PAYLOAD,
        } as unknown as CallToolResult);
      });

      await act(async () => {
        await result.current.loadMore();
      });

      expect(fakeApp.callServerTool).toHaveBeenCalledWith({
        name: "get_related_entities",
        arguments: { cursor: "2" },
      });
    });

    it("resends just the cursor when ontoolinput fires without an arguments field", async () => {
      fakeApp.callServerTool.mockResolvedValue({
        content: [],
        structuredContent: { entity_id: "e0", items: [], total: 8, next_cursor: null },
      });
      const { result } = renderHook(() => useConnectionsData());

      act(() => {
        fakeApp.ontoolinput?.({});
        fakeApp.ontoolresult?.({
          structuredContent: CONNECTIONS_PAYLOAD,
        } as unknown as CallToolResult);
      });

      await act(async () => {
        await result.current.loadMore();
      });

      expect(fakeApp.callServerTool).toHaveBeenCalledWith({
        name: "get_related_entities",
        arguments: { cursor: "2" },
      });
    });

    it("warns and leaves items unchanged when the loadMore result doesn't parse", async () => {
      const warnSpy = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      fakeApp.callServerTool.mockResolvedValue({
        content: [],
        structuredContent: { nope: true },
      });
      const { result } = renderHook(() => useConnectionsData());

      act(() => {
        fakeApp.ontoolresult?.({
          structuredContent: CONNECTIONS_PAYLOAD,
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
      const consoleErrorSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      const loadMoreError = new Error("transport dropped");
      fakeApp.callServerTool.mockRejectedValue(loadMoreError);
      const { result } = renderHook(() => useConnectionsData());

      act(() => {
        fakeApp.ontoolresult?.({
          structuredContent: CONNECTIONS_PAYLOAD,
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
