// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEntries, useEntry, useEntryBySlug } from "@/domains/catalog/hooks/use-entries";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  apiList: vi.fn(),
  apiGet: vi.fn(),
  apiGetBySlug: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  keepPreviousData: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  api: {
    entries: {
      list: mocks.apiList,
      get: mocks.apiGet,
      getBySlug: mocks.apiGetBySlug,
    },
  },
}));

beforeEach(() => {
  mocks.useQuery.mockReset();
  mocks.apiList.mockReset();
  mocks.apiGet.mockReset();
  mocks.apiGetBySlug.mockReset();
  mocks.useQuery.mockImplementation((options: { enabled?: boolean; queryFn: () => unknown }) => {
    if (options.enabled !== false) {
      void options.queryFn();
    }
    return { data: null, isLoading: false };
  });
});

describe("useEntries", () => {
  it("fetches entries with params", async () => {
    const params = { states: ["NY"] };
    useEntries(params);
    await Promise.resolve();
    expect(mocks.apiList).toHaveBeenCalledWith(params);
  });
});

describe("useEntry", () => {
  it("fetches an entry by ID", async () => {
    useEntry("entry_1");
    await Promise.resolve();
    expect(mocks.apiGet).toHaveBeenCalledWith("entry_1");
  });

  it("does not fetch when disabled", async () => {
    useEntry("entry_1", { enabled: false });
    await Promise.resolve();
    expect(mocks.apiGet).not.toHaveBeenCalled();
  });
});

describe("useEntryBySlug", () => {
  it("fetches a slug when one is provided", async () => {
    useEntryBySlug("people", "jane-doe-a3f2");
    await Promise.resolve();
    expect(mocks.apiGetBySlug).toHaveBeenCalledWith("people", "jane-doe-a3f2");
  });

  it("does not fetch when the slug is empty", async () => {
    useEntryBySlug("organizations", "");
    await Promise.resolve();
    expect(mocks.apiGetBySlug).not.toHaveBeenCalled();
  });

  it("does not fetch when explicitly disabled", async () => {
    useEntryBySlug("people", "jane-doe-a3f2", { enabled: false });
    await Promise.resolve();
    expect(mocks.apiGetBySlug).not.toHaveBeenCalled();
  });
});
