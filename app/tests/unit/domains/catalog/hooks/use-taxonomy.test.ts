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
  it("configures the taxonomy query", () => {
    useTaxonomy();
    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["taxonomy"],
      }),
    );
  });
});
