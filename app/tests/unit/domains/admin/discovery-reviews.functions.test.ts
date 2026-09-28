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

  it("finds an existing organization and loads its published facts for correction", async () => {
    const entityId = "d4ad7d29-75b9-420e-ba57-9d08c5a9e4c5";
    mocks.requestAtlasApi
      .mockResolvedValueOnce({
        items: [{ id: entityId, name: "NAACP Las Vegas Branch #1111", address: { state: "NV" } }],
        total: 1,
      })
      .mockResolvedValueOnce({
        id: entityId,
        name: "NAACP Las Vegas Branch #1111",
        description: "Existing branch description.",
        address: { city: null, state: "NV", geo_specificity: "statewide", region: null },
        issue_area_ids: ["housing_affordability", "public_transit"],
        contact: { website: null },
        sources: [{ url: "https://www.naacplasvegas.org/about", type: "org_website" }],
      });
    const { searchEditorialProfiles, loadEditorialProfile } =
      await import("@/domains/admin/discovery-reviews.functions");

    const matches = await searchEditorialProfiles({ data: { query: "NAACP Las Vegas" } });
    const profile = await loadEditorialProfile({ data: { entityId } });

    expect(mocks.requestAtlasApi).toHaveBeenNthCalledWith(
      1,
      "/entities?query=NAACP%20Las%20Vegas&entity_type=organization&limit=10",
    );
    expect(matches[0]?.id).toBe(entityId);
    expect(profile.initial.issue_areas).toEqual(["housing_affordability", "public_transit"]);
    expect(profile.initial.source_url).toBe("https://www.naacplasvegas.org/about");
    expect(profile.initial.source_context).toBe("");
  });

  it("handles sparse legacy profiles without inventing place, issue, or official-source facts", async () => {
    const entityId = "d4ad7d29-75b9-420e-ba57-9d08c5a9e4c5";
    mocks.requestAtlasApi
      .mockResolvedValueOnce({ total: 0 })
      .mockResolvedValueOnce({
        items: [{ id: entityId, name: "Sparse Group", address: {} }],
        total: 1,
      })
      .mockResolvedValueOnce({
        id: entityId,
        name: "Sparse Group",
        description: "An incomplete organization record.",
        address: { city: "Las Vegas", geo_specificity: "unknown" },
        contact: {},
      })
      .mockResolvedValueOnce({
        id: entityId,
        name: "Sparse Group",
        description: "An incomplete organization record.",
        address: { city: null, geo_specificity: "unknown" },
        contact: {},
        sources: [],
      });
    const { searchEditorialProfiles, loadEditorialProfile } =
      await import("@/domains/admin/discovery-reviews.functions");

    expect(await searchEditorialProfiles({ data: { query: "No match" } })).toEqual([]);
    expect(await searchEditorialProfiles({ data: { query: "Sparse" } })).toEqual([
      { id: entityId, name: "Sparse Group", city: null, state: null },
    ]);
    const local = await loadEditorialProfile({ data: { entityId } });
    const statewide = await loadEditorialProfile({ data: { entityId } });
    expect(local.initial).toMatchObject({
      geo_specificity: "local",
      issue_areas: [],
      source_url: "",
      state: "",
    });
    expect(statewide.initial.geo_specificity).toBe("statewide");
    expect(local.officialSources).toEqual([]);
  });

  it("stages an existing profile change through the editorial review endpoint", async () => {
    mocks.requestAtlasApi.mockResolvedValue({ review_item_id: "review-1", status: "pending" });
    const { stageEditorialProfileChange } =
      await import("@/domains/admin/discovery-reviews.functions");
    const entityId = "d4ad7d29-75b9-420e-ba57-9d08c5a9e4c5";
    const candidate = {
      action_url: "https://www.naacplasvegas.org/housing",
      city: "Las Vegas",
      description: "The local branch works on housing access.",
      geo_specificity: "local" as const,
      issue_areas: ["housing_affordability"],
      name: "NAACP Las Vegas Branch #1111",
      region: null,
      source_context: "The Housing Committee page describes local housing work.",
      source_url: "https://www.naacplasvegas.org/housing",
      sources_checked: true as const,
      state: "NV",
    };

    await stageEditorialProfileChange({ data: { entityId, candidate } });

    expect(mocks.requestAtlasApi).toHaveBeenCalledWith(
      `/review-queue/editorial-profiles/${entityId}/changes`,
      { body: JSON.stringify(candidate), method: "POST" },
    );
  });

  it("shows identifiable before-and-after facts and cited URLs from the private queue", async () => {
    mocks.requestAtlasApi.mockResolvedValue({
      items: [
        {
          id: "7cb2c69a-f22b-4f4e-ab83-16872c9fd59e",
          entity_name: "Civic Group",
          entity_description: "A source-backed local organization.",
          entity_city: "Las Vegas",
          entity_state: "NV",
          entity_website: "https://example.org/join",
          entity_issue_areas: ["public_transit"],
          entity_slug: "civic-group",
          entity_type: "organization",
          hold_reason: "editorial_candidate",
          source_urls: ["https://example.org/about"],
          source_evidence: [
            {
              url: "https://example.org/about",
              context: "The About page describes local transit advocacy.",
            },
          ],
          proposed_changes: {
            description: { before: "Old", after: "New" },
            issue_areas: { before: [], after: ["housing", "transit"] },
            website: { before: null, after: "https://example.org" },
            verified: { before: false, after: true },
            count: { before: 0, after: 1 },
            metadata: { before: { key: "value" }, after: { key: "next" } },
            source_evidence: {
              before: null,
              after: [
                {
                  url: "https://example.org/about",
                  context: "The About page describes local transit advocacy.",
                },
              ],
            },
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
    expect(result.items[0]?.entityDescription).toBe("A source-backed local organization.");
    expect(result.items[0]?.issueAreas).toEqual(["public_transit"]);
    expect(result.items[0]?.sourceUrls).toEqual(["https://example.org/about"]);
    expect(result.items[0]?.sourceEvidence).toEqual([
      {
        url: "https://example.org/about",
        context: "The About page describes local transit advocacy.",
      },
    ]);
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
    expect(result.items[0]?.changes.some((change) => change.field === "source_evidence")).toBe(
      false,
    );
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

  it("stages a checked official-source candidate without publishing it", async () => {
    mocks.requestAtlasApi.mockResolvedValue({
      entity_id: "held-entity",
      review_item_id: "review-item",
      status: "pending",
    });
    const { stageEditorialCandidate } = await import("@/domains/admin/discovery-reviews.functions");
    const candidate = {
      action_url: "https://lasvegasfortransit.org/join/",
      city: "Las Vegas",
      description: "Las Vegas Valley group organizing residents for transit.",
      geo_specificity: "regional" as const,
      issue_areas: ["public_transit"],
      name: "Las Vegans for Better Transit",
      region: "Las Vegas Valley",
      source_context: "The About page describes its transit advocacy.",
      source_url: "https://lasvegasfortransit.org/about/",
      sources_checked: true as const,
      state: "NV",
    };
    const result = await stageEditorialCandidate({ data: candidate });
    expect(mocks.requestAtlasApi).toHaveBeenCalledWith("/review-queue/editorial-candidates", {
      body: JSON.stringify(candidate),
      method: "POST",
    });
    expect(result.status).toBe("pending");
  });
});
