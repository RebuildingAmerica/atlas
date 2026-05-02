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
  mocks.useQuery.mockReturnValue({ data: null, isLoading: false });
  mocks.apiList.mockReset();
  mocks.apiGet.mockReset();
  mocks.apiGetBySlug.mockReset();
});

describe("useEntries", () => {
  it("configures the entries query with params", () => {
    const params = { states: ["NY"] };
    useEntries(params);
    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["entries", params],
      }),
    );
  });
});

describe("useEntry", () => {
  it("configures the entry query by ID", () => {
    useEntry("entry_1");
    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["entries", "entry_1"],
      }),
    );
  });

  it("respects the enabled option", () => {
    useEntry("entry_1", { enabled: false });
    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
      }),
    );
  });
});

describe("useEntryBySlug", () => {
  it("configures the slug query and uses default enabled when slug is provided", async () => {
    useEntryBySlug("people", "jane-doe-a3f2");
    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["entries", "by-slug", "people", "jane-doe-a3f2"],
        enabled: true,
        retry: false,
      }),
    );
    const queryFn = (mocks.useQuery.mock.calls[0]?.[0] as { queryFn: () => Promise<unknown> })
      .queryFn;
    await queryFn();
    expect(mocks.apiGetBySlug).toHaveBeenCalledWith("people", "jane-doe-a3f2");
  });

  it("disables the query when the slug is empty", () => {
    useEntryBySlug("organizations", "");
    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
      }),
    );
  });

  it("respects an explicit enabled override and combines with slug truthiness", () => {
    useEntryBySlug("people", "jane-doe-a3f2", { enabled: false });
    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
      }),
    );
  });
});
