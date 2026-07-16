// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  taxonomyQueryOptions,
  useTaxonomy,
} from "@rebuildingamerica/atlas-catalog/hooks/use-taxonomy";

const mocks = vi.hoisted(() => ({
  queryOptions: vi.fn((options: unknown) => options),
  useQuery: vi.fn(),
  apiTaxonomyList: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  queryOptions: mocks.queryOptions,
  useQuery: mocks.useQuery,
}));

vi.mock("@rebuildingamerica/atlas-api-client", () => ({
  api: {
    taxonomy: {
      list: mocks.apiTaxonomyList,
    },
  },
}));

describe("useTaxonomy", () => {
  beforeEach(() => {
    mocks.apiTaxonomyList.mockReset();
    mocks.queryOptions.mockClear();
    mocks.useQuery.mockReset();
  });

  it("builds reusable taxonomy query options", async () => {
    const options = taxonomyQueryOptions();

    expect(mocks.queryOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["taxonomy"],
        staleTime: 1000 * 60 * 60 * 24,
      }),
    );
    const queryFn = options.queryFn as () => Promise<unknown>;
    await queryFn();
    expect(mocks.apiTaxonomyList).toHaveBeenCalledTimes(1);
  });

  it("fetches taxonomy data when invoked", async () => {
    mocks.useQuery.mockImplementation((options: { queryFn: () => unknown }) => {
      void options.queryFn();
      return { data: null, isLoading: false };
    });

    useTaxonomy();
    await Promise.resolve();
    expect(mocks.apiTaxonomyList).toHaveBeenCalledTimes(1);
  });
});
