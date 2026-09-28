// @vitest-environment jsdom
/* eslint-disable atlas-tests/no-test-file-locals */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscoveryReviewsPage } from "@/domains/admin/discovery-reviews-page";
import type { DiscoveryReviewPage } from "@/domains/admin/discovery-reviews.functions";

const mocks = vi.hoisted(() => ({
  decideDiscoveryReview: vi.fn(),
  loadEditorialProfile: vi.fn(),
  listDiscoveryReviews: vi.fn(),
  prepareLasVegasWebsiteReviews: vi.fn(),
  searchEditorialProfiles: vi.fn(),
  stageEditorialCandidate: vi.fn(),
  stageEditorialProfileChange: vi.fn(),
  useTaxonomy: vi.fn<() => { data: Record<string, { name: string; slug: string }[]> | undefined }>(
    () => ({
      data: {
        transportation: [
          { name: "Public transit", slug: "public_transit" },
          { name: "Housing affordability", slug: "housing_affordability" },
        ],
      },
    }),
  ),
  useHydrated: vi.fn(() => true),
}));

vi.mock("@/domains/admin/discovery-reviews.functions", () => ({
  decideDiscoveryReview: mocks.decideDiscoveryReview,
  loadEditorialProfile: mocks.loadEditorialProfile,
  listDiscoveryReviews: mocks.listDiscoveryReviews,
  prepareLasVegasWebsiteReviews: mocks.prepareLasVegasWebsiteReviews,
  searchEditorialProfiles: mocks.searchEditorialProfiles,
  stageEditorialCandidate: mocks.stageEditorialCandidate,
  stageEditorialProfileChange: mocks.stageEditorialProfileChange,
}));

vi.mock("@rebuildingamerica/atlas-catalog/hooks/use-taxonomy", () => ({
  useTaxonomy: mocks.useTaxonomy,
}));

vi.mock("@/platform/runtime/use-hydrated", () => ({ useHydrated: mocks.useHydrated }));

const page: DiscoveryReviewPage = {
  items: [
    {
      changes: [{ before: "Old", after: "New", field: "description" }],
      entityName: "Civic Group",
      entitySlug: "civic-group",
      entityType: "organization",
      holdReason: "published_profile_change",
      id: "7cb2c69a-f22b-4f4e-ab83-16872c9fd59e",
      sourceUrls: ["https://example.org/about"],
    },
  ],
  total: 1,
};

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DiscoveryReviewsPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.decideDiscoveryReview.mockReset();
  mocks.loadEditorialProfile.mockReset();
  mocks.listDiscoveryReviews.mockReset();
  mocks.prepareLasVegasWebsiteReviews.mockReset();
  mocks.searchEditorialProfiles.mockReset();
  mocks.stageEditorialCandidate.mockReset();
  mocks.stageEditorialProfileChange.mockReset();
  mocks.useTaxonomy.mockReset();
  mocks.useTaxonomy.mockReturnValue({
    data: {
      transportation: [
        { name: "Public transit", slug: "public_transit" },
        { name: "Housing affordability", slug: "housing_affordability" },
      ],
    },
  });
  mocks.useHydrated.mockReset();
  mocks.useHydrated.mockReturnValue(true);
});

describe("DiscoveryReviewsPage", () => {
  it("finds a published profile and queues its sourced correction without overwriting it", async () => {
    const entityId = "d4ad7d29-75b9-420e-ba57-9d08c5a9e4c5";
    mocks.listDiscoveryReviews.mockResolvedValue({ items: [], total: 0 });
    mocks.searchEditorialProfiles.mockResolvedValue([
      { id: entityId, name: "NAACP Las Vegas Branch #1111", city: null, state: "NV" },
    ]);
    mocks.loadEditorialProfile.mockResolvedValue({
      id: entityId,
      name: "NAACP Las Vegas Branch #1111",
      profileUrl: "/profiles/organizations/naacp-las-vegas",
      officialSources: ["https://www.naacplasvegas.org/about"],
      initial: {
        name: "NAACP Las Vegas Branch #1111",
        description: "Old generic description.",
        city: null,
        state: "NV",
        geo_specificity: "statewide",
        region: null,
        issue_areas: ["housing_affordability", "public_transit"],
        source_url: "https://www.naacplasvegas.org/about",
        source_context: "",
        action_url: "",
      },
    });
    mocks.stageEditorialProfileChange.mockResolvedValue({
      entity_id: entityId,
      review_item_id: "review-item",
      status: "pending",
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Improve existing organization" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Find published organization" }), {
      target: { value: "NAACP Las Vegas" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find organization" }));
    expect(
      await screen.findByRole("button", { name: /Select NAACP Las Vegas Branch/ }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Select NAACP Las Vegas Branch/ }));
    expect(
      await screen.findByRole("heading", { name: "Improve existing organization" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /What the organization does/ }), {
      target: { value: "The local branch organizes housing access work." },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "City" }), {
      target: { value: "Las Vegas" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Geographic scope" }), {
      target: { value: "local" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove Public transit" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Official page supporting this work/ }), {
      target: { value: "https://www.naacplasvegas.org/housing" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /What the page supports/ }), {
      target: { value: "The Housing Committee page describes local housing work." },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Official next step/ }), {
      target: { value: "https://www.naacplasvegas.org/housing" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked both official pages/ }));
    fireEvent.click(screen.getByRole("button", { name: "Propose correction" }));

    await waitFor(() => {
      expect(mocks.stageEditorialProfileChange.mock.calls[0]?.[0]).toMatchObject({
        data: {
          entityId,
          candidate: {
            city: "Las Vegas",
            issue_areas: ["housing_affordability"],
            source_url: "https://www.naacplasvegas.org/housing",
          },
        },
      });
    });
    expect(await screen.findByText(/Correction ready for editorial review/)).toBeInTheDocument();
  });

  it("shows search failure, empty results, and a sparse profile without an official site", async () => {
    const entityId = "d4ad7d29-75b9-420e-ba57-9d08c5a9e4c5";
    mocks.listDiscoveryReviews.mockResolvedValue({ items: [], total: 0 });
    mocks.searchEditorialProfiles
      .mockRejectedValueOnce(new Error("Search offline"))
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: entityId, name: "Sparse Group", city: null, state: null }]);
    mocks.loadEditorialProfile.mockResolvedValue({
      id: entityId,
      name: "Sparse Group",
      officialSources: [],
      profileUrl: null,
      initial: {},
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Improve existing organization" }));
    const search = screen.getByRole("textbox", { name: "Find published organization" });
    fireEvent.change(search, { target: { value: "Broken search" } });
    fireEvent.click(screen.getByRole("button", { name: "Find organization" }));
    expect(await screen.findByText(/Organization search could not load/)).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "No results" } });
    fireEvent.click(screen.getByRole("button", { name: "Find organization" }));
    expect(await screen.findByText(/No published organization matched/)).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "Sparse Group" } });
    fireEvent.click(screen.getByRole("button", { name: "Find organization" }));
    const select = await screen.findByRole("button", {
      name: "Select Sparse Group · Place unknown",
    });
    fireEvent.click(select);
    expect(await screen.findByText(/no linked official organization site/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Propose correction" })).not.toBeInTheDocument();
  });

  it("keeps the editor on the current profile after a failed correction submission", async () => {
    const entityId = "d4ad7d29-75b9-420e-ba57-9d08c5a9e4c5";
    mocks.listDiscoveryReviews.mockResolvedValue({ items: [], total: 0 });
    mocks.searchEditorialProfiles.mockResolvedValue([
      { id: entityId, name: "NAACP Las Vegas Branch", city: "Las Vegas", state: "NV" },
    ]);
    mocks.loadEditorialProfile.mockResolvedValue({
      id: entityId,
      name: "NAACP Las Vegas Branch",
      officialSources: ["https://www.naacplasvegas.org/about"],
      profileUrl: null,
      initial: {
        name: "NAACP Las Vegas Branch",
        description: "Existing local branch description.",
        city: "Las Vegas",
        state: "NV",
        geo_specificity: "local",
        issue_areas: ["housing_affordability"],
        source_url: "https://www.naacplasvegas.org/about",
        action_url: "https://www.naacplasvegas.org/housing",
      },
    });
    mocks.stageEditorialProfileChange.mockRejectedValue(new Error("Queue offline"));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Improve existing organization" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Find published organization" }), {
      target: { value: "NAACP Las Vegas" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find organization" }));
    fireEvent.click(await screen.findByRole("button", { name: /Select NAACP Las Vegas Branch/ }));
    expect(
      await screen.findByRole("heading", { name: "Improve existing organization" }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /What the page supports/ }), {
      target: { value: "The official page describes local housing work." },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked both official pages/ }));
    fireEvent.click(screen.getByRole("button", { name: "Propose correction" }));
    expect(await screen.findByText(/Correction could not be queued/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Organization name/ })).toHaveValue(
      "NAACP Las Vegas Branch",
    );
  });

  it("shows a profile-loading error instead of an editable blank profile", async () => {
    const entityId = "d4ad7d29-75b9-420e-ba57-9d08c5a9e4c5";
    mocks.listDiscoveryReviews.mockResolvedValue({ items: [], total: 0 });
    mocks.searchEditorialProfiles.mockResolvedValue([
      { id: entityId, name: "NAACP Las Vegas Branch", city: "Las Vegas", state: "NV" },
    ]);
    mocks.loadEditorialProfile.mockRejectedValue(new Error("Profile offline"));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Improve existing organization" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Find published organization" }), {
      target: { value: "NAACP Las Vegas" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find organization" }));
    fireEvent.click(await screen.findByRole("button", { name: /Select NAACP Las Vegas Branch/ }));
    expect(await screen.findByText(/Current profile could not load/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Propose correction" })).not.toBeInTheDocument();
  });

  it("renders the admin shell while the private queue is pending", () => {
    mocks.listDiscoveryReviews.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(screen.getByRole("heading", { name: "Discovered profiles" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Pending discovery reviews" })).toBeInTheDocument();
  });

  it("loads reviewed facts, pages, and submits an attested decision", async () => {
    mocks.listDiscoveryReviews.mockResolvedValue({ ...page, total: 26 });
    mocks.decideDiscoveryReview.mockResolvedValue({ id: page.items[0]?.id, status: "approved" });
    renderPage();

    expect(await screen.findByText("Civic Group")).toBeInTheDocument();
    expect(mocks.listDiscoveryReviews).toHaveBeenCalledWith({ data: { offset: 0 } });
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked these sources/ }));
    fireEvent.click(screen.getByRole("button", { name: "Approve Civic Group" }));
    await waitFor(() => {
      expect(mocks.decideDiscoveryReview.mock.calls[0]?.[0]).toEqual({
        data: { decision: "approve", itemId: page.items[0]?.id },
      });
    });
    fireEvent.click(screen.getByRole("button", { name: "Next reviews" }));
    expect(mocks.listDiscoveryReviews).toHaveBeenCalledWith({ data: { offset: 25 } });
  });

  it("prepares Las Vegas website proposals and refreshes the review queue", async () => {
    mocks.listDiscoveryReviews.mockResolvedValue({ items: [], total: 0 });
    mocks.prepareLasVegasWebsiteReviews.mockResolvedValue({ enqueued: 2 });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Find Las Vegas website candidates" }));

    await waitFor(() => {
      expect(mocks.prepareLasVegasWebsiteReviews).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("2 website proposals ready for review.")).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.listDiscoveryReviews).toHaveBeenCalledTimes(2);
    });
  });

  it("opens official-source intake and adds a held profile to the review queue", async () => {
    mocks.listDiscoveryReviews.mockResolvedValue({ items: [], total: 0 });
    mocks.stageEditorialCandidate
      .mockRejectedValueOnce(new Error("Queue unavailable"))
      .mockResolvedValue({
        entity_id: "held-entity",
        review_item_id: "review-item",
        status: "pending",
      });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add organization from official source" }));
    fireEvent.change(screen.getByRole("textbox", { name: /Organization name/ }), {
      target: { value: "Las Vegans for Better Transit" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /What the organization does/ }), {
      target: { value: "Las Vegas Valley group organizing residents for better transit." },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Official page supporting this work/ }), {
      target: { value: "https://lasvegasfortransit.org/about/" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /What the page supports/ }), {
      target: { value: "The About page describes transit advocacy." },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Official next step/ }), {
      target: { value: "https://lasvegasfortransit.org/join/" },
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Issue area" }), {
      target: { value: "public_transit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add issue area" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked both official pages/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add to review queue" }));

    expect(await screen.findByText(/Organization could not be queued/)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /Organization name/ })).toHaveValue(
      "Las Vegans for Better Transit",
    );
    fireEvent.click(screen.getByRole("button", { name: "Add to review queue" }));

    await waitFor(() => {
      expect(mocks.stageEditorialCandidate).toHaveBeenCalledTimes(2);
    });
    expect(
      await screen.findByText(
        "Organization ready for editorial review. Its profile is not public.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.listDiscoveryReviews).toHaveBeenCalledTimes(2);
    });
  });

  it("shows that intake cannot proceed when issue taxonomy is unavailable", () => {
    mocks.listDiscoveryReviews.mockResolvedValue({ items: [], total: 0 });
    mocks.useTaxonomy.mockReturnValue({ data: undefined });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "Add organization from official source" }));
    expect(screen.getByText("Issue areas unavailable.")).toBeInTheDocument();
  });

  it("states when the website scan finds no new proposals", async () => {
    mocks.listDiscoveryReviews.mockResolvedValue({ items: [], total: 0 });
    mocks.prepareLasVegasWebsiteReviews.mockResolvedValue({ enqueued: 0 });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Find Las Vegas website candidates" }));

    expect(await screen.findByText("No new website proposals.")).toBeInTheDocument();
  });

  it("uses a singular count for one website proposal", async () => {
    mocks.listDiscoveryReviews.mockResolvedValue({ items: [], total: 0 });
    mocks.prepareLasVegasWebsiteReviews.mockResolvedValue({ enqueued: 1 });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Find Las Vegas website candidates" }));

    expect(await screen.findByText("1 website proposal ready for review.")).toBeInTheDocument();
  });

  it("keeps the review queue available when website preparation fails", async () => {
    mocks.listDiscoveryReviews.mockResolvedValue(page);
    mocks.prepareLasVegasWebsiteReviews.mockRejectedValue(new Error("API down"));
    renderPage();
    expect(await screen.findByText("Civic Group")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Find Las Vegas website candidates" }));

    expect(
      await screen.findByText("Website candidates could not be prepared."),
    ).toBeInTheDocument();
    expect(screen.getByText("Civic Group")).toBeInTheDocument();
  });

  it("shows a safe load error", async () => {
    mocks.listDiscoveryReviews.mockRejectedValue(new Error("API down"));
    renderPage();
    expect(await screen.findByText("Discovery reviews could not load.")).toBeInTheDocument();
  });

  it("shows a decision failure without dropping the review", async () => {
    mocks.listDiscoveryReviews.mockResolvedValue(page);
    mocks.decideDiscoveryReview.mockRejectedValue(new Error("Conflict"));
    renderPage();
    expect(await screen.findByText("Civic Group")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reject Civic Group" }));
    expect(
      await screen.findByText("Decision could not be saved. Reload and review the current facts."),
    ).toBeInTheDocument();
    expect(screen.getByText("Civic Group")).toBeInTheDocument();
  });

  it("marks an in-flight decision as pending", async () => {
    mocks.listDiscoveryReviews.mockResolvedValue(page);
    mocks.decideDiscoveryReview.mockReturnValue(new Promise(() => undefined));
    renderPage();
    expect(await screen.findByText("Civic Group")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reject Civic Group" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reject Civic Group" })).toBeDisabled();
    });
  });

  it("does not request the queue before hydration", () => {
    mocks.useHydrated.mockReturnValue(false);
    renderPage();
    expect(mocks.listDiscoveryReviews).not.toHaveBeenCalled();
  });
});
