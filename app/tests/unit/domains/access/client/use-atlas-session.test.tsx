// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  getAtlasSession: vi.fn(),
  getAuthConfig: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
}));

vi.mock("@/domains/access/config", () => ({
  getAuthConfig: mocks.getAuthConfig,
}));

vi.mock("@/domains/access/session.functions", () => ({
  getAtlasSession: mocks.getAtlasSession,
}));

describe("useAtlasSession", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getAtlasSession.mockReset();
    mocks.getAuthConfig.mockReset();
    mocks.useQuery.mockReset();
    mocks.useQuery.mockReturnValue({ data: null, isPending: false });
  });

  it("uses a finite stale time when auth is enabled", async () => {
    mocks.getAuthConfig.mockReturnValue({
      localMode: false,
    });

    const mod = await import("@/domains/access/client/use-atlas-session");
    const { result } = renderHook(() => mod.useAtlasSession());

    expect(result.current).toEqual({ data: null, isPending: false });
    expect(mocks.useQuery).toHaveBeenCalledWith({
      queryFn: mocks.getAtlasSession,
      queryKey: ["auth", "session", false],
      staleTime: 30_000,
    });
  });

  it("uses an infinite stale time in local mode", async () => {
    mocks.getAuthConfig.mockReturnValue({
      localMode: true,
    });

    const mod = await import("@/domains/access/client/use-atlas-session");
    renderHook(() => mod.useAtlasSession());

    expect(mocks.useQuery).toHaveBeenCalledWith({
      queryFn: mocks.getAtlasSession,
      queryKey: ["auth", "session", true],
      staleTime: Infinity,
    });
  });
});
