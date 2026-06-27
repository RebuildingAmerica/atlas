// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { useTaxonomy } from "@/domains/catalog/hooks/use-taxonomy";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  apiTaxonomyList: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
}));

vi.mock("@/lib/api", () => ({
  api: {
    taxonomy: {
      list: mocks.apiTaxonomyList,
    },
  },
}));

describe("useTaxonomy", () => {
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
