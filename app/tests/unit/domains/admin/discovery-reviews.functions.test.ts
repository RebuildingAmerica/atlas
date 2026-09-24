import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requestAtlasApi: vi.fn() }));

vi.mock("@tanstack/react-start", async () => {
  const { createServerFnStub } = await import("../../../helpers/server-fn-stub");
  return { createServerFn: createServerFnStub() };
});

vi.mock("@/domains/discovery/server/api-client", () => ({
  requestAtlasApi: mocks.requestAtlasApi,
}));

describe("discovery review server functions", () => {
  afterEach(() => {
    vi.resetModules();
    mocks.requestAtlasApi.mockReset();
  });

  it("shows identifiable before-and-after facts and cited URLs from the private queue", async () => {
    mocks.requestAtlasApi.mockResolvedValue({
      items: [
        {
          id: "7cb2c69a-f22b-4f4e-ab83-16872c9fd59e",
          entity_name: "Civic Group",
          entity_slug: "civic-group",
          entity_type: "organization",
          hold_reason: "published_profile_change",
          source_urls: ["https://example.org/about"],
          proposed_changes: {
            description: { before: "Old", after: "New" },
            issue_areas: { before: [], after: ["housing", "transit"] },
            website: { before: null, after: "https://example.org" },
            verified: { before: false, after: true },
            count: { before: 0, after: 1 },
            metadata: { before: { key: "value" }, after: { key: "next" } },
          },
        },
      ],
      total: 1,
    });

    const { listDiscoveryReviews } = await import("@/domains/admin/discovery-reviews.functions");
    const result = await listDiscoveryReviews({ data: { offset: 25 } });

    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/review-queue?limit=25&offset=25");
    expect(result.total).toBe(1);
    expect(result.items[0]?.entityName).toBe("Civic Group");
    expect(result.items[0]?.sourceUrls).toEqual(["https://example.org/about"]);
    expect(result.items[0]?.changes).toContainEqual({
      field: "issue_areas",
      before: "None listed",
      after: "housing, transit",
    });
    expect(result.items[0]?.changes).toContainEqual({
      field: "metadata",
      before: '{"key":"value"}',
      after: '{"key":"next"}',
    });
  });

  it("keeps legacy queue items identifiable without inventing sources or changes", async () => {
    mocks.requestAtlasApi.mockResolvedValue({
      items: [{ id: "legacy", hold_reason: "person_requires_review" }],
      total: 1,
    });

    const { listDiscoveryReviews } = await import("@/domains/admin/discovery-reviews.functions");
    const result = await listDiscoveryReviews({ data: { offset: 0 } });

    expect(result.items[0]).toMatchObject({
      entityName: "Unnamed profile",
      entitySlug: null,
      entityType: null,
      sourceUrls: [],
      changes: [],
    });
  });

  it("returns an empty page when there are no pending items", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ total: 0 });

    const { listDiscoveryReviews } = await import("@/domains/admin/discovery-reviews.functions");
    const result = await listDiscoveryReviews({ data: { offset: 0 } });

    expect(result).toEqual({ items: [], total: 0 });
  });

  it("submits the selected decision for one item", async () => {
    mocks.requestAtlasApi.mockResolvedValue({
      id: "7cb2c69a-f22b-4f4e-ab83-16872c9fd59e",
      status: "approved",
    });

    const { decideDiscoveryReview } = await import("@/domains/admin/discovery-reviews.functions");
    const result = await decideDiscoveryReview({
      data: { decision: "approve", itemId: "7cb2c69a-f22b-4f4e-ab83-16872c9fd59e" },
    });

    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(
      "/review-queue/7cb2c69a-f22b-4f4e-ab83-16872c9fd59e/approve",
      { method: "POST" },
    );
    expect(result).toEqual({ id: "7cb2c69a-f22b-4f4e-ab83-16872c9fd59e", status: "approved" });
  });

  it("requests review proposals for Las Vegas organization websites", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ enqueued: 2, review_item_ids: ["a", "b"] });

    const { prepareLasVegasWebsiteReviews } =
      await import("@/domains/admin/discovery-reviews.functions");
    const result = await prepareLasVegasWebsiteReviews();

    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(
      "/review-queue/website-candidate-scan?city=Las%20Vegas&state=NV",
      { method: "POST" },
    );
    expect(result).toEqual({ enqueued: 2 });
  });
});
