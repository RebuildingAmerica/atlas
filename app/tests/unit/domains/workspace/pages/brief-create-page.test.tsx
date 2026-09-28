// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readRouterMocks, resetRouterMocks } from "@/../tests/helpers/router-harness";
import type { useCreateWorkspaceBrief } from "@/domains/workspace/hooks/use-briefs";
import { BriefCreatePage } from "@/domains/workspace/pages/brief-create-page";
import {
  buildBriefCreateInput,
  initialFormState,
} from "@/domains/workspace/pages/brief-create-page-utils";
import type { AtlasBrief } from "@/domains/workspace/server/briefs";

const mocks = vi.hoisted(() => ({
  createBrief: vi.fn(),
  discoveryRuns: vi.fn(),
  exportSavedList: vi.fn(),
  savedLists: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/workspace/hooks/use-briefs", () => ({
  useCreateWorkspaceBrief: vi.fn(),
}));

vi.mock("@/domains/catalog/hooks/use-claims", () => ({
  useSavedLists: mocks.savedLists,
}));

vi.mock("@/domains/discovery/hooks/use-discovery", () => ({
  useDiscoveryRuns: mocks.discoveryRuns,
}));

vi.mock("@rebuildingamerica/atlas-api-client/generated/atlas", () => ({
  exportSavedList: mocks.exportSavedList,
}));

describe("BriefCreatePage", () => {
  type CreateBriefMutation = ReturnType<typeof useCreateWorkspaceBrief>;

  function createBriefMutation(
    mutation: Pick<CreateBriefMutation, "isPending" | "mutateAsync">,
  ): CreateBriefMutation {
    return mutation as CreateBriefMutation;
  }

  beforeEach(async () => {
    const briefs = await import("@/domains/workspace/hooks/use-briefs");
    mocks.createBrief.mockReset();
    resetRouterMocks();
    vi.mocked(briefs.useCreateWorkspaceBrief).mockReturnValue(
      createBriefMutation({
        mutateAsync: mocks.createBrief,
        isPending: false,
      }),
    );
    mocks.savedLists.mockReturnValue({
      data: [{ id: "list_1", name: "Detroit organizers", item_count: 1 }],
      isError: false,
    });
    mocks.discoveryRuns.mockReturnValue({
      data: {
        items: [
          {
            id: "run_1",
            location_query: "Detroit, MI",
            issue_areas: ["housing"],
            status: "completed",
          },
        ],
      },
      isError: false,
    });
    mocks.exportSavedList.mockResolvedValue({
      list: { id: "list_1", name: "Detroit organizers" },
      items: [
        {
          entry_id: "entry_1",
          entry: { name: "Detroit Tenant Alliance", type: "organization" },
          sources: [
            {
              id: "source_1",
              title: "Tenant organizing",
              type: "news",
              url: "https://example.org/tenant",
            },
            {
              id: "source_2",
              title: "Alliance website",
              type: "website",
              url: "https://example.org/about",
            },
          ],
        },
      ],
      provenance: { item_count: 1, source_count: 2 },
    });
  });

  afterEach(() => {
    cleanup();
    mocks.exportSavedList.mockReset();
    mocks.savedLists.mockReset();
    mocks.discoveryRuns.mockReset();
  });

  function renderPage(initialListId = "list_1") {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <BriefCreatePage initialListId={initialListId} />
      </QueryClientProvider>,
    );
  }

  function createdBrief(): AtlasBrief {
    return {
      id: "brief_new",
      org_id: "org_123",
      title: "Detroit Tenant Power Brief",
      scope: {
        geography: "Detroit, MI",
        issue_areas: ["housing", "tenant organizing"],
        actor_types: ["organization"],
        source_types: ["news", "website"],
      },
      summary: "A source-linked brief for tenant organizing.",
      linked_entry_ids: ["entry_1"],
      linked_source_ids: ["source_1", "source_2"],
      linked_discovery_run_ids: ["run_1"],
      confidence_summary: {
        source_count: 2,
        state: "partial",
        review_status: "needs review",
      },
      gaps: [
        {
          label: "Rural coverage",
          detail: "Confirm non-metro groups.",
        },
      ],
      created_by: "operator_1",
      created_at: "2026-07-03T10:00:00.000Z",
      updated_at: "2026-07-03T10:00:00.000Z",
    };
  }

  function fillRequiredFields() {
    fireEvent.change(screen.getByLabelText("Brief title"), {
      target: { value: "Detroit Tenant Power Brief" },
    });
    fireEvent.change(screen.getByLabelText("Place"), {
      target: { value: "Detroit, MI" },
    });
    fireEvent.change(screen.getByLabelText("Issues"), {
      target: { value: "housing, tenant organizing" },
    });
    fireEvent.change(screen.getByLabelText("Brief summary"), {
      target: { value: "A source-linked brief for tenant organizing." },
    });
  }

  it("creates a source-linked brief and opens the new workspace artifact", async () => {
    mocks.createBrief.mockResolvedValue(createdBrief());

    renderPage();

    fillRequiredFields();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Tenant organizing" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Alliance website" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Detroit, MI · housing" }));
    fireEvent.change(screen.getByLabelText("Confidence state"), {
      target: { value: "partial" },
    });
    fireEvent.change(screen.getByLabelText("Review status"), {
      target: { value: "reviewed" },
    });
    fireEvent.change(screen.getByLabelText("Known gaps"), {
      target: { value: "Rural coverage: Confirm non-metro groups." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create brief" }));

    await waitFor(() => {
      expect(mocks.createBrief).toHaveBeenCalledWith({
        title: "Detroit Tenant Power Brief",
        scope: {
          geography: "Detroit, MI",
          issue_areas: ["housing", "tenant organizing"],
          actor_types: ["organization"],
          source_types: ["news", "website"],
        },
        summary: "A source-linked brief for tenant organizing.",
        linked_entry_ids: ["entry_1"],
        linked_source_ids: ["source_1", "source_2"],
        linked_discovery_run_ids: ["run_1"],
        confidence_summary: {
          source_count: 2,
          state: "partial",
          review_status: "reviewed",
        },
        gaps: [
          {
            label: "Rural coverage",
            detail: "Confirm non-metro groups.",
          },
        ],
      });
    });
    expect(readRouterMocks().navigate).toHaveBeenCalledWith({
      params: { briefId: "brief_new" },
      to: "/briefs/$briefId",
    });
  });

  it("requires a saved list", async () => {
    renderPage("");

    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create brief" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Choose a saved list with people or groups to include.",
    );
    expect(mocks.createBrief).not.toHaveBeenCalled();
  });

  it("reports unavailable list evidence and keeps list selection usable", async () => {
    mocks.savedLists.mockReturnValue({
      data: [
        { id: "list_1", name: "Detroit organizers", item_count: 1 },
        { id: "list_2", name: "Empty list" },
      ],
      isError: false,
    });
    mocks.exportSavedList.mockImplementation((id: string) =>
      Promise.resolve({
        items: id === "list_2" ? [] : [{ entry_id: "missing", entry: null, sources: [] }],
      }),
    );
    renderPage();
    expect(
      await screen.findByText("Saved profiles in this list are unavailable."),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Saved list"), { target: { value: "list_2" } });
    expect(await screen.findByText("This list has no saved profiles.")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Empty list (0)" })).toBeInTheDocument();
  });

  it("offers a route to find profiles when no saved list exists", () => {
    mocks.savedLists.mockReturnValue({ data: [], isError: false });
    renderPage("");
    expect(screen.getByText(/No saved lists yet/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Explore people and groups" })).toHaveAttribute(
      "href",
      "/browse",
    );
  });

  it("separates saved-list and research load failures", () => {
    mocks.savedLists.mockReturnValue({ data: undefined, isError: true });
    mocks.discoveryRuns.mockReturnValue({ data: undefined, isError: true });
    renderPage("");
    expect(screen.getByText("Saved lists could not load.")).toBeInTheDocument();
    expect(screen.getByText("Earlier research could not load.")).toBeInTheDocument();
  });

  it("requires a selected profile and one of its source receipts", async () => {
    renderPage();
    fillRequiredFields();
    const actor = await screen.findByRole("checkbox", { name: "Detroit Tenant Alliance" });
    fireEvent.click(actor);
    fireEvent.click(screen.getByRole("button", { name: "Create brief" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose at least one person or group.");

    fireEvent.click(actor);
    fireEvent.click(screen.getByRole("button", { name: "Create brief" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose at least one source receipt from your saved profiles.",
    );
    expect(mocks.createBrief).not.toHaveBeenCalled();
  });

  it("never links an unavailable profile or a source no longer in the selection", async () => {
    mocks.exportSavedList.mockResolvedValue({
      items: [
        { entry_id: "missing", entry: null, sources: [] },
        {
          entry_id: "entry_1",
          entry: { name: "Detroit Tenant Alliance", type: "organization" },
          sources: [
            {
              id: "source_1",
              title: "Tenant organizing",
              type: "news",
              url: "https://example.org/tenant",
            },
          ],
        },
        {
          entry_id: "entry_2",
          entry: { name: "Civic Network", type: "organization" },
          sources: [
            {
              id: "source_2",
              title: "Network source",
              type: "website",
              url: "https://example.org/network",
            },
          ],
        },
      ],
    });
    mocks.createBrief.mockResolvedValue(createdBrief());
    renderPage();
    fillRequiredFields();
    expect(await screen.findByText("Civic Network")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Unavailable profile" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "Network source" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Civic Network" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Tenant organizing" }));
    fireEvent.click(screen.getByRole("button", { name: "Create brief" }));
    await waitFor(() => {
      expect(mocks.createBrief).toHaveBeenCalledWith(
        expect.objectContaining({
          linked_entry_ids: ["entry_1"],
          linked_source_ids: ["source_1"],
        }),
      );
    });
  });

  it("shows a list load failure without submitting a stale brief", async () => {
    mocks.exportSavedList.mockRejectedValue(new Error("private API detail"));
    renderPage();
    fillRequiredFields();
    expect(await screen.findByText("This list could not load.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Create brief" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose a saved list with people or groups to include.",
    );
    expect(screen.queryByText("private API detail")).not.toBeInTheDocument();
  });

  it("retries a failed saved list without losing the brief draft", async () => {
    mocks.exportSavedList.mockRejectedValueOnce(new Error("temporary failure"));
    mocks.createBrief.mockResolvedValue(createdBrief());
    renderPage();
    fillRequiredFields();

    expect(await screen.findByText(/This list could not load/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try loading this list again" }));

    fireEvent.click(await screen.findByRole("checkbox", { name: "Tenant organizing" }));
    expect(screen.getByLabelText("Brief title")).toHaveValue("Detroit Tenant Power Brief");
    expect(screen.getByLabelText("Brief summary")).toHaveValue(
      "A source-linked brief for tenant organizing.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Create brief" }));

    await waitFor(() => {
      expect(mocks.createBrief).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Detroit Tenant Power Brief",
          linked_entry_ids: ["entry_1"],
          linked_source_ids: ["source_1"],
        }),
      );
    });
  });

  it("shows source gaps and prevents a receipt without a type from being submitted", async () => {
    mocks.exportSavedList.mockResolvedValue({
      items: [
        {
          entry_id: "entry_1",
          entry: { name: null, type: "organization" },
          sources: [
            {
              id: "source_1",
              title: null,
              publication: "City Ledger",
              type: null,
              url: "http://example.org/story",
            },
            {
              id: "source_2",
              title: null,
              publication: null,
              type: "news",
              url: "https://example.org/other",
            },
            {
              id: "source_3",
              title: "Unsupported link",
              type: "news",
              url: "ftp://example.org/unsafe",
            },
            { id: "source_4", title: "Malformed link", type: "news", url: "not a url" },
          ],
        },
      ],
    });
    renderPage();
    fillRequiredFields();
    expect(await screen.findByRole("checkbox", { name: "Unavailable profile" })).toBeChecked();
    expect(screen.getByText("City Ledger")).toBeInTheDocument();
    expect(screen.getByText("https://example.org/other")).toBeInTheDocument();
    expect(screen.queryByText("Unsupported link")).not.toBeInTheDocument();
    expect(screen.queryByText("Malformed link")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: "City Ledger" }));
    fireEvent.click(screen.getByRole("button", { name: "Create brief" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A selected source is missing its type. Choose another receipt.",
    );
    expect(mocks.createBrief).not.toHaveBeenCalled();
  });

  it("explains when a saved profile has no source receipts", async () => {
    mocks.exportSavedList.mockResolvedValue({
      items: [{ entry_id: "entry_1", entry: { name: "Civic Network", type: "organization" } }],
    });
    renderPage();
    expect(
      await screen.findByText("No source receipts are linked to these profiles."),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Civic Network" })).toBeChecked();
  });

  it("rejects an empty evidence draft before sending it to the API", () => {
    expect(buildBriefCreateInput(initialFormState)).toEqual({
      input: null,
      problem: "Add at least one actor, source, or research run.",
    });
  });

  it("rejects malformed known-gap lines before saving", async () => {
    renderPage();

    fillRequiredFields();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Tenant organizing" }));
    fireEvent.change(screen.getByLabelText("Known gaps"), {
      target: { value: "Coverage missing" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create brief" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Each gap needs a label and detail.",
    );
    expect(mocks.createBrief).not.toHaveBeenCalled();
  });

  it("shows the known-gap line format before submission", () => {
    renderPage();

    expect(screen.getByText("Gap format")).toBeInTheDocument();
    expect(screen.getByText("Label: detail")).toBeInTheDocument();
  });

  it("says the brief could not be saved without echoing the API failure", async () => {
    mocks.createBrief.mockRejectedValue(new Error("ATLAS_API_REQUEST_FAILED"));

    renderPage();

    fillRequiredFields();
    fireEvent.click(await screen.findByRole("checkbox", { name: "Tenant organizing" }));
    fireEvent.click(screen.getByRole("button", { name: "Create brief" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not create brief. Try again in a moment.",
    );
    expect(screen.queryByText(/ATLAS_API/)).not.toBeInTheDocument();
  });
});
