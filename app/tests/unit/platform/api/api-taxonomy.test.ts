import { beforeEach, describe, expect, it, vi } from "vitest";

const listIssueAreasMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/generated/atlas", () => ({
  getEntity: vi.fn(),
  listEntities: vi.fn(),
  listIssueAreas: listIssueAreasMock,
}));

describe("api.taxonomy.list", () => {
  beforeEach(() => {
    vi.resetModules();
    listIssueAreasMock.mockReset();
  });

  it("uses API-compatible pagination and groups issue areas by domain", async () => {
    listIssueAreasMock
      .mockResolvedValueOnce({
        items: [
          {
            description: "First issue",
            domain: "Housing",
            id: "housing_affordability",
            name: "Housing Affordability",
            slug: "housing_affordability",
          },
        ],
        next_cursor: "100",
        total: 2,
      })
      .mockResolvedValueOnce({
        items: [
          {
            description: "Second issue",
            domain: "Labor",
            id: "worker_power",
            name: "Worker Power",
            slug: "worker_power",
          },
        ],
        next_cursor: null,
        total: 2,
      });

    const { api } = await import("@/lib/api");
    const taxonomy = await api.taxonomy.list();

    expect(listIssueAreasMock).toHaveBeenNthCalledWith(1, { cursor: undefined, limit: 100 });
    expect(listIssueAreasMock).toHaveBeenNthCalledWith(2, { cursor: "100", limit: 100 });
    expect(taxonomy).toEqual({
      Housing: [
        {
          description: "First issue",
          name: "Housing Affordability",
          slug: "housing_affordability",
        },
      ],
      Labor: [
        {
          description: "Second issue",
          name: "Worker Power",
          slug: "worker_power",
        },
      ],
    });
  });

  it("returns an empty taxonomy when the API responds without issue-area items", async () => {
    listIssueAreasMock.mockResolvedValue({
      items: null,
      next_cursor: null,
      total: 0,
    });

    const { api } = await import("@/lib/api");
    await expect(api.taxonomy.list()).resolves.toEqual({});

    expect(listIssueAreasMock).toHaveBeenCalledWith({ cursor: undefined, limit: 100 });
  });
});
