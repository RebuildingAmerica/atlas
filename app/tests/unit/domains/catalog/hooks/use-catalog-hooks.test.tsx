// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

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
  queryOptions: vi.fn((options: unknown) => options),
  useQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  keepPreviousData: "keep-previous-data",
  queryOptions: mocks.queryOptions,
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
    mocks.queryOptions.mockClear();
    mocks.useQuery.mockReset();
    mocks.useQuery.mockImplementation((options: { enabled?: boolean; queryFn: () => unknown }) => {
      if (options.enabled !== false) {
        void options.queryFn();
      }
      return { data: null, isPending: false };
    });
  });

  it("queries entry collections and individual entries", async () => {
    const mod = await import("@/domains/catalog/hooks/use-entries");
    mod.useEntries({ query: "housing" });
    mod.useEntry("entry_123");
    await Promise.resolve();

    expect(mocks.api.entries.list).toHaveBeenCalledWith({ query: "housing" });
    expect(mocks.api.entries.get).toHaveBeenCalledWith("entry_123");
  });

  it("queries taxonomy data when invoked", async () => {
    const mod = await import("@/domains/catalog/hooks/use-taxonomy");
    mod.useTaxonomy();
    await Promise.resolve();
    expect(mocks.api.taxonomy.list).toHaveBeenCalledTimes(1);
  });
});
