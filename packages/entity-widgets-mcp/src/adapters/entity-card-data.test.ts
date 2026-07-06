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

const { parseEntityCardData, useEntityCardData } = await import(
  "./entity-card-data"
);

let fakeApp: FakeApp;

beforeEach(() => {
  vi.clearAllMocks();
  fakeApp = createFakeApp();
  mockSuccessfulConnection(useApp, fakeApp);
});

afterEach(() => {
  cleanup();
});

describe("parseEntityCardData", () => {
  it("narrows a full nested EntityResponse-shaped payload down to EntityCardData", () => {
    expect(parseEntityCardData(FULL_ENTITY_PAYLOAD)).toEqual({
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
    expect(parseEntityCardData(MINIMAL_ENTITY_PAYLOAD)).toEqual({
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
      ...MINIMAL_ENTITY_PAYLOAD,
      trust: { level: "bogus" },
    });
    expect(parsed?.trust_level).toBe("unverified");
  });

  it("treats a non-https profile_url as null", () => {
    const parsed = parseEntityCardData({
      ...MINIMAL_ENTITY_PAYLOAD,
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
    expect(
      parseEntityCardData({ ...MINIMAL_ENTITY_PAYLOAD, id: 123 }),
    ).toBeNull();
  });

  it("returns null when name is not a string", () => {
    expect(
      parseEntityCardData({ ...MINIMAL_ENTITY_PAYLOAD, name: 123 }),
    ).toBeNull();
  });

  it("returns null when type is not a known entity type", () => {
    expect(
      parseEntityCardData({ ...MINIMAL_ENTITY_PAYLOAD, type: "spaceship" }),
    ).toBeNull();
  });

  it("returns null when source_count is not a number", () => {
    expect(
      parseEntityCardData({ ...MINIMAL_ENTITY_PAYLOAD, source_count: "four" }),
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
        structuredContent: FULL_ENTITY_PAYLOAD,
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
