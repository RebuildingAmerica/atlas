// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  getAtlasSession: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
}));

vi.mock("@/domains/access/session.functions", () => ({
  getAtlasSession: mocks.getAtlasSession,
}));

describe("useAtlasSession", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getAtlasSession.mockReset();
    mocks.useQuery.mockReset();
    mocks.useQuery.mockReturnValue({ data: null, isPending: false });
  });

  it("configures the session query against the Atlas server function", async () => {
    const mod = await import("@/domains/access/client/use-atlas-session");
    const { result } = renderHook(() => mod.useAtlasSession());

    expect(result.current).toEqual({ data: null, isPending: false });
    expect(mocks.useQuery).toHaveBeenCalledWith({
      queryFn: mocks.getAtlasSession,
      queryKey: ["auth", "session"],
      staleTime: 30_000,
    });
  });
});
