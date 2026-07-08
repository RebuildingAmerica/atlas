import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEntity: vi.fn(),
  listEntities: vi.fn(),
  listIssueAreas: vi.fn(),
}));

vi.mock("@/lib/generated/atlas", () => ({
  getEntity: mocks.getEntity,
  listEntities: mocks.listEntities,
  listIssueAreas: mocks.listIssueAreas,
}));

describe("api runtime adapters", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.getEntity.mockReset();
    mocks.listEntities.mockReset();
    mocks.listIssueAreas.mockReset();
  });

  it("keeps discovery reads and writes routed through authenticated server functions", async () => {
    const { api } = await import("@/lib/api");

    await expect(api.discovery.list()).resolves.toEqual({
      items: [],
      total: 0,
    });
    await expect(api.discovery.get("run_123")).rejects.toThrow(
      "Use the authenticated discovery server functions instead.",
    );
    await expect(api.discovery.start({})).rejects.toThrow(
      "Use the authenticated discovery server functions instead.",
    );
  });
});
