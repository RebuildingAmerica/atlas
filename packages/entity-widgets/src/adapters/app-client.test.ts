import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type {
  McpUiHostContext,
  McpUiStyles,
} from "@modelcontextprotocol/ext-apps";

/**
 * `McpUiStyles` is a `Record` over ~75 specific CSS variable keys, so a real
 * host always sends the full set. Our fixtures only need to prove that a
 * couple of keys are forwarded correctly, so this cast stands in for the
 * other ~73 the host would normally include.
 */
function partialStyles(variables: Record<string, string>): McpUiStyles {
  return variables as McpUiStyles;
}

const { FakeApp, applyDocumentTheme, applyHostStyleVariables, applyHostFonts } =
  vi.hoisted(() => {
    class FakeApp {
      static instances: FakeApp[] = [];
      ontoolresult: ((result: unknown) => void) | undefined;
      onhostcontextchanged: ((context: unknown) => void) | undefined;
      onerror: ((error: Error) => void) | undefined;
      connect = vi.fn().mockResolvedValue(undefined);
      getHostContext = vi.fn().mockReturnValue(undefined);

      constructor(public info: { name: string; version: string }) {
        FakeApp.instances.push(this);
      }
    }

    return {
      FakeApp,
      applyDocumentTheme: vi.fn(),
      applyHostStyleVariables: vi.fn(),
      applyHostFonts: vi.fn(),
    };
  });

vi.mock("@modelcontextprotocol/ext-apps", () => ({
  App: FakeApp,
  applyDocumentTheme,
  applyHostStyleVariables,
  applyHostFonts,
}));

const { applyHostContext, parseEntityCardData, useEntityCardData } =
  await import("./app-client");

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

beforeEach(() => {
  vi.clearAllMocks();
  FakeApp.instances.length = 0;
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

describe("applyHostContext", () => {
  it("applies theme, style variables, and fonts when all are present", () => {
    const context: McpUiHostContext = {
      theme: "dark",
      styles: {
        variables: partialStyles({ "--color-background-primary": "#000000" }),
        css: { fonts: "@font-face { font-family: Test; }" },
      },
    };

    applyHostContext(context);

    expect(applyDocumentTheme).toHaveBeenCalledWith("dark");
    expect(applyHostStyleVariables).toHaveBeenCalledWith({
      "--color-background-primary": "#000000",
    });
    expect(applyHostFonts).toHaveBeenCalledWith(
      "@font-face { font-family: Test; }",
    );
  });

  it("does nothing when the context has no theme, styles, or fonts", () => {
    applyHostContext({});

    expect(applyDocumentTheme).not.toHaveBeenCalled();
    expect(applyHostStyleVariables).not.toHaveBeenCalled();
    expect(applyHostFonts).not.toHaveBeenCalled();
  });

  it("applies only style variables when fonts are absent", () => {
    applyHostContext({
      styles: {
        variables: partialStyles({ "--color-text-primary": "#ffffff" }),
      },
    });

    expect(applyHostStyleVariables).toHaveBeenCalled();
    expect(applyHostFonts).not.toHaveBeenCalled();
  });
});

describe("useEntityCardData", () => {
  it("returns null and connects to the host on mount", async () => {
    const { result } = renderHook(() => useEntityCardData());

    expect(result.current).toBeNull();
    const app = FakeApp.instances.at(-1);
    expect(app).toBeDefined();
    await waitFor(() => {
      expect(app?.connect).toHaveBeenCalledTimes(1);
    });
  });

  it("updates the returned data when a valid tool result arrives", async () => {
    const { result } = renderHook(() => useEntityCardData());
    const app = FakeApp.instances.at(-1);
    await waitFor(() => {
      expect(app?.connect).toHaveBeenCalled();
    });

    act(() => {
      app?.ontoolresult?.({ structuredContent: FULL_PAYLOAD });
    });

    await waitFor(() => {
      expect(result.current?.id).toBe("e1");
    });
  });

  it("ignores a tool result that doesn't parse into EntityCardData", async () => {
    const { result } = renderHook(() => useEntityCardData());
    const app = FakeApp.instances.at(-1);
    await waitFor(() => {
      expect(app?.connect).toHaveBeenCalled();
    });

    act(() => {
      app?.ontoolresult?.({ structuredContent: { nope: true } });
    });

    expect(result.current).toBeNull();
  });

  it("applies the host's initial context when it's already available right after connect", async () => {
    renderHook(() => useEntityCardData());
    const app = FakeApp.instances.at(-1);
    app?.getHostContext.mockReturnValue({ theme: "dark" });

    await waitFor(() => {
      expect(applyDocumentTheme).toHaveBeenCalledWith("dark");
    });
  });

  it("applies host context updates as they arrive", async () => {
    renderHook(() => useEntityCardData());
    const app = FakeApp.instances.at(-1);
    await waitFor(() => {
      expect(app?.connect).toHaveBeenCalled();
    });

    act(() => {
      app?.onhostcontextchanged?.({ theme: "light" });
    });

    expect(applyDocumentTheme).toHaveBeenCalledWith("light");
  });

  it("logs errors reported by the host connection", () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    renderHook(() => useEntityCardData());
    const app = FakeApp.instances.at(-1);
    const error = new Error("connection lost");

    app?.onerror?.(error);

    expect(consoleErrorSpy).toHaveBeenCalledWith(error);
    consoleErrorSpy.mockRestore();
  });
});
