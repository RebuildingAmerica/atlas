// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { useEntries, useEntry } from "@/domains/catalog/hooks/use-entries";

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  apiList: vi.fn(),
  apiGet: vi.fn(),
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
    },
  },
}));

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
