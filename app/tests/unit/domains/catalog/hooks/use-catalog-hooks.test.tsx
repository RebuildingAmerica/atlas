// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  api: {
    entries: {
      get: vi.fn(),
      list: vi.fn(),
    },
    taxonomy: {
      list: vi.fn(),
    },
  },
  useQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  keepPreviousData: "keep-previous-data",
  useQuery: mocks.useQuery,
}));

vi.mock("@/lib/api", () => ({
  api: mocks.api,
}));

describe("catalog hooks", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.api.entries.get.mockReset();
    mocks.api.entries.list.mockReset();
    mocks.api.taxonomy.list.mockReset();
    mocks.useQuery.mockReset();
    mocks.useQuery.mockReturnValue({ data: null, isPending: false });
  });

  it("queries entry collections and individual entries", async () => {
    const mod = await import("@/domains/catalog/hooks/use-entries");
    renderHook(() => mod.useEntries({ query: "housing" }));
    renderHook(() => mod.useEntry("entry_123"));

    expect(mocks.useQuery).toHaveBeenNthCalledWith(1, {
      placeholderData: "keep-previous-data",
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      queryFn: expect.any(Function),
      queryKey: ["entries", { query: "housing" }],
      staleTime: 1000 * 60 * 10,
    });
    expect(mocks.useQuery).toHaveBeenNthCalledWith(2, {
      enabled: true,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      queryFn: expect.any(Function),
      queryKey: ["entries", "entry_123"],
      staleTime: 1000 * 60 * 10,
    });

    await (mocks.useQuery.mock.calls[0]?.[0] as { queryFn: () => Promise<unknown> }).queryFn();
    await (mocks.useQuery.mock.calls[1]?.[0] as { queryFn: () => Promise<unknown> }).queryFn();

    expect(mocks.api.entries.list).toHaveBeenCalledWith({ query: "housing" });
    expect(mocks.api.entries.get).toHaveBeenCalledWith("entry_123");
  });

  it("queries taxonomy with a daily stale time", async () => {
    const mod = await import("@/domains/catalog/hooks/use-taxonomy");
    renderHook(() => mod.useTaxonomy());

    expect(mocks.useQuery).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      queryFn: expect.any(Function),
      queryKey: ["taxonomy"],
      staleTime: 1000 * 60 * 60 * 24,
    });

    await (mocks.useQuery.mock.calls[0]?.[0] as { queryFn: () => Promise<unknown> }).queryFn();
    expect(mocks.api.taxonomy.list).toHaveBeenCalledTimes(1);
  });
});
