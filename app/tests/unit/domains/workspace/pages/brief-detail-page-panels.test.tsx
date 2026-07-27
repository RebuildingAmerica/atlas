// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { useAddSavedListItem, useSavedLists } from "@/domains/catalog/hooks/use-claims";
import {
  ActorsPanel,
  DiscoveryRunsPanel,
  GapsPanel,
  SaveActorsPanel,
  SourcesPanel,
} from "@/domains/workspace/pages/brief-detail-page-panels";
import type {
  AtlasBriefExportEntry,
  AtlasBriefExportSource,
} from "@/domains/workspace/server/briefs";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/catalog/hooks/use-claims", () => ({
  useAddSavedListItem: vi.fn(),
  useSavedLists: vi.fn(),
}));

describe("brief detail page panels", () => {
  type AddSavedListItemMutation = ReturnType<typeof useAddSavedListItem>;
  type SavedListsQuery = ReturnType<typeof useSavedLists>;

  function savedListsQuery(query: Pick<SavedListsQuery, "data" | "isLoading">): SavedListsQuery {
    return query as SavedListsQuery;
  }

  function addSavedListItemMutation(
    mutation: Pick<AddSavedListItemMutation, "isPending" | "mutateAsync">,
  ): AddSavedListItemMutation {
    return mutation as AddSavedListItemMutation;
  }

  function entry(overrides: Partial<AtlasBriefExportEntry> = {}): AtlasBriefExportEntry {
    return {
      city: "Kansas City",
      id: "entry_1",
      name: "KC Tenants",
      state: "MO",
      type: "community_organization",
      ...overrides,
    };
  }

  function source(overrides: Partial<AtlasBriefExportSource> = {}): AtlasBriefExportSource {
    return {
      id: "source_1",
      ingested_at: "2026-07-01T12:00:00.000Z",
      publication: "Civic Ledger",
      published_date: "2026-06-28",
      title: "Tenant organizers expand court watch",
      type: "news_article",
      url: "https://example.org/tenant-organizing",
      ...overrides,
    };
  }

  beforeEach(async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useSavedLists).mockReturnValue(
      savedListsQuery({ data: undefined, isLoading: true }),
    );
    vi.mocked(claims.useAddSavedListItem).mockReturnValue(
      addSavedListItemMutation({
        isPending: false,
        mutateAsync: vi.fn().mockResolvedValue(undefined),
      }),
    );
  });

  it("stays silent when the brief records no gaps", () => {
    const { container } = render(<GapsPanel gaps={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("names the actor kind without a dangling separator when no place is known", () => {
    render(<ActorsPanel entries={[entry({ city: null, state: null })]} />);

    expect(screen.getByText("community organization")).toBeInTheDocument();
    expect(screen.queryByText(/-\s*$/)).not.toBeInTheDocument();
  });

  it("says plainly that no actors are linked", () => {
    render(<ActorsPanel entries={[]} />);

    expect(screen.getByText("No people or groups linked.")).toBeInTheDocument();
  });

  it("offers a route to a first list while the reader has none", () => {
    render(<SaveActorsPanel briefTitle="Tenant Power" entries={[entry()]} />);

    expect(screen.getByText("No lists yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New list" })).toHaveAttribute("href", "/lists");
  });

  it("hides the save affordance when the brief links no actors", () => {
    const { container } = render(<SaveActorsPanel briefTitle="Tenant Power" entries={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("reports a failed save without dropping the reader's list choice", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    vi.mocked(claims.useSavedLists).mockReturnValue(
      savedListsQuery({
        data: [
          {
            created_at: "2026-07-01T00:00:00.000Z",
            description: "Field follow-up",
            id: "list_1",
            item_count: 2,
            items: [],
            name: "Coalition outreach",
            updated_at: "2026-07-02T00:00:00.000Z",
            user_id: "user_1",
          },
        ],
        isLoading: false,
      }),
    );
    vi.mocked(claims.useAddSavedListItem).mockReturnValue(
      addSavedListItemMutation({
        isPending: false,
        mutateAsync: vi.fn().mockRejectedValue(new Error("ATLAS_API_REQUEST_FAILED")),
      }),
    );

    render(<SaveActorsPanel briefTitle="Tenant Power" entries={[entry()]} />);

    fireEvent.click(screen.getByRole("button", { name: "Save 1 actor" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Could not save actors to list.");
    expect(screen.queryByText(/ATLAS_API/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Target list")).toHaveValue("list_1");
  });

  it("says a source has no known publication rather than leaving a blank", async () => {
    const onEvidenceOpen = vi.fn();
    render(
      <SourcesPanel
        onEvidenceOpen={onEvidenceOpen}
        sources={[source({ ingested_at: "", publication: null, published_date: null })]}
      />,
    );

    expect(screen.getByText("Unknown publication")).toBeInTheDocument();
    expect(screen.queryByText(/^Ingested /)).not.toBeInTheDocument();
    expect(screen.queryByText("Jun 28, 2026")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("link", { name: /Tenant organizers expand court watch/ }));

    await waitFor(() => {
      expect(onEvidenceOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "source_1" }));
    });
  });

  it("says plainly that a brief carries no source receipts", () => {
    render(<SourcesPanel onEvidenceOpen={vi.fn()} sources={[]} />);

    expect(screen.getByText("No source receipts.")).toBeInTheDocument();
  });

  it("stays silent when the brief cites no research runs", () => {
    const { container } = render(<DiscoveryRunsPanel runs={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("marks an unfinished research run apart from a completed one", () => {
    render(
      <DiscoveryRunsPanel
        runs={[
          {
            id: "run_1",
            issue_areas: ["housing_affordability"],
            location_query: "Kansas City, MO",
            research_goal: "landscape_scan",
            state: "MO",
            status: "in_progress",
          },
        ]}
      />,
    );

    expect(screen.getByText("in progress")).toBeInTheDocument();
    expect(screen.getByText("landscape scan")).toBeInTheDocument();
    expect(screen.getByText("housing affordability")).toBeInTheDocument();
  });
});
