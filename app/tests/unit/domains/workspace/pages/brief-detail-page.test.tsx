// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { useAddSavedListItem, useSavedLists } from "@/domains/catalog/hooks/use-claims";
import type {
  useRecordWorkspaceEvidenceOpen,
  useUpdateWorkspaceBrief,
} from "@/domains/workspace/hooks/use-briefs";
import { BriefDetailPage } from "@/domains/workspace/pages/brief-detail-page";
import type { AtlasBriefExport } from "@/domains/workspace/server/briefs";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/catalog/hooks/use-claims", () => ({
  useAddSavedListItem: vi.fn(),
  useSavedLists: vi.fn(),
}));

vi.mock("@/domains/workspace/hooks/use-briefs", () => ({
  useRecordWorkspaceEvidenceOpen: vi.fn(),
  useUpdateWorkspaceBrief: vi.fn(),
}));

describe("BriefDetailPage", () => {
  type AddSavedListItemMutation = ReturnType<typeof useAddSavedListItem>;
  type RecordEvidenceOpenMutation = ReturnType<typeof useRecordWorkspaceEvidenceOpen>;
  type SavedListsQuery = ReturnType<typeof useSavedLists>;
  type UpdateBriefMutation = ReturnType<typeof useUpdateWorkspaceBrief>;

  function savedListsQuery(query: Pick<SavedListsQuery, "data" | "isLoading">): SavedListsQuery {
    return query as SavedListsQuery;
  }

  function addSavedListItemMutation(
    mutation: Pick<AddSavedListItemMutation, "isPending" | "mutateAsync">,
  ): AddSavedListItemMutation {
    return mutation as AddSavedListItemMutation;
  }

  function updateBriefMutation(
    mutation: Pick<UpdateBriefMutation, "isPending" | "mutateAsync">,
  ): UpdateBriefMutation {
    return mutation as UpdateBriefMutation;
  }

  function recordEvidenceOpenMutation(
    mutation: Pick<RecordEvidenceOpenMutation, "isPending" | "mutate">,
  ): RecordEvidenceOpenMutation {
    return mutation as RecordEvidenceOpenMutation;
  }

  beforeEach(async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const briefs = await import("@/domains/workspace/hooks/use-briefs");
    vi.mocked(claims.useSavedLists).mockReturnValue(
      savedListsQuery({
        data: [],
        isLoading: false,
      }),
    );
    vi.mocked(claims.useAddSavedListItem).mockReturnValue(
      addSavedListItemMutation({
        mutateAsync: vi.fn().mockResolvedValue(undefined),
        isPending: false,
      }),
    );
    vi.mocked(briefs.useUpdateWorkspaceBrief).mockReturnValue(
      updateBriefMutation({
        mutateAsync: vi.fn().mockResolvedValue(undefined),
        isPending: false,
      }),
    );
    vi.mocked(briefs.useRecordWorkspaceEvidenceOpen).mockReturnValue(
      recordEvidenceOpenMutation({
        mutate: vi.fn(),
        isPending: false,
      }),
    );
  });

  afterEach(() => {
    cleanup();
  });

  function briefExport(): AtlasBriefExport {
    return {
      format: "json",
      brief: {
        id: "brief_123",
        org_id: "org_123",
        title: "Tenant Power in Kansas City",
        scope: {
          geography: "Kansas City, MO",
          issue_areas: ["housing", "labor"],
          actor_types: ["organization", "person"],
          source_types: ["news", "website"],
        },
        summary:
          "Tenant organizers, legal aid groups, and neighborhood coalitions are coordinating eviction defense.",
        linked_entry_ids: ["entry_1"],
        linked_source_ids: ["source_1"],
        linked_discovery_run_ids: ["run_1"],
        confidence_summary: {
          source_count: 3,
          state: "corroborated",
          review_status: "reviewed by research",
        },
        gaps: [
          {
            label: "Rural organizers",
            detail: "Confirm coverage outside the metro before statewide outreach.",
          },
        ],
        created_by: "operator_1",
        created_at: "2026-07-03T10:00:00.000Z",
        updated_at: "2026-07-03T11:00:00.000Z",
      },
      entries: [
        {
          id: "entry_1",
          name: "KC Tenants",
          type: "organization",
          city: "Kansas City",
          state: "MO",
        },
      ],
      sources: [
        {
          id: "source_1",
          url: "https://example.org/tenant-organizing",
          title: "Tenant organizers expand court watch",
          publication: "Civic Ledger",
          published_date: "2026-06-28",
          type: "news",
          ingested_at: "2026-07-01T12:00:00.000Z",
        },
      ],
      discovery_runs: [
        {
          id: "run_1",
          location_query: "Kansas City, MO",
          state: "MO",
          issue_areas: ["housing"],
          research_goal: "landscape_scan",
          status: "completed",
        },
      ],
      provenance: {
        source_count: 1,
        entry_count: 1,
        discovery_run_count: 1,
        confidence_state: "corroborated",
        review_status: "reviewed by research",
      },
    };
  }

  it("renders the brief, confidence state, known gaps, and source receipts", () => {
    render(<BriefDetailPage briefExport={briefExport()} />);

    expect(
      screen.getByRole("heading", { name: "Tenant Power in Kansas City" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Kansas City, MO").length).toBeGreaterThan(0);
    expect(screen.getByText(/Tenant organizers, legal aid groups/)).toBeInTheDocument();
    expect(screen.getAllByText("corroborated").length).toBeGreaterThan(0);
    expect(screen.getByText("3 sources")).toBeInTheDocument();
    expect(screen.getAllByText("reviewed by research").length).toBeGreaterThan(0);
    expect(screen.getByText("Rural organizers")).toBeInTheDocument();
    expect(screen.getByText(/Confirm coverage outside the metro/)).toBeInTheDocument();
    expect(screen.getByText("KC Tenants")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Tenant organizers expand court watch" }),
    ).toHaveAttribute("href", "https://example.org/tenant-organizing");
    expect(screen.getByText("Civic Ledger")).toBeInTheDocument();
    expect(screen.getByText("landscape scan")).toBeInTheDocument();
    expect(screen.getByText("1 source receipt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy JSON" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download JSON" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download CSV" })).toBeInTheDocument();
  });

  it("downloads the brief export as a JSON file", async () => {
    const createObjectUrl = vi.fn().mockReturnValue("blob:atlas-brief-export");
    const revokeObjectUrl = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });

    render(<BriefDetailPage briefExport={briefExport()} />);

    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));

    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    const blob = createObjectUrl.mock.calls[0]?.[0] as Blob;
    await expect(blob.text()).resolves.toContain("Tenant Power in Kansas City");
    expect(click).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:atlas-brief-export");
  });

  it("downloads the brief export as a CSV file", async () => {
    const createObjectUrl = vi.fn().mockReturnValue("blob:atlas-brief-csv-export");
    const revokeObjectUrl = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });

    render(<BriefDetailPage briefExport={briefExport()} />);

    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));

    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    const blob = createObjectUrl.mock.calls[0]?.[0] as Blob;
    await expect(blob.text()).resolves.toContain("row_type,record_id,title");
    await expect(blob.text()).resolves.toContain("brief,brief_123,Tenant Power in Kansas City");
    await expect(blob.text()).resolves.toContain("entry,entry_1,,KC Tenants,organization");
    await expect(blob.text()).resolves.toContain(
      "source,source_1,Tenant organizers expand court watch",
    );
    await expect(blob.text()).resolves.toContain("discovery_run,run_1");
    await expect(blob.text()).resolves.toContain("gap,,Rural organizers");
    await expect(blob.text()).resolves.toContain("provenance");
    expect(click).toHaveBeenCalled();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:atlas-brief-csv-export");
  });

  it("opens the browser print flow for customer-ready PDF handoff", () => {
    const print = vi.fn();
    Object.defineProperty(window, "print", {
      configurable: true,
      value: print,
    });

    render(<BriefDetailPage briefExport={briefExport()} />);

    fireEvent.click(screen.getByRole("button", { name: "Print brief" }));

    expect(print).toHaveBeenCalledOnce();
  });

  it("records evidence-open usage when a source receipt is opened", async () => {
    const briefs = await import("@/domains/workspace/hooks/use-briefs");
    const recordEvidenceOpen = vi.fn();
    vi.mocked(briefs.useRecordWorkspaceEvidenceOpen).mockReturnValue(
      recordEvidenceOpenMutation({
        mutate: recordEvidenceOpen,
        isPending: false,
      }),
    );

    render(<BriefDetailPage briefExport={briefExport()} />);

    fireEvent.click(screen.getByRole("link", { name: "Tenant organizers expand court watch" }));

    expect(recordEvidenceOpen).toHaveBeenCalledWith({
      sourceId: "source_1",
      surface: "brief",
    });
  });

  it("saves linked actors into the selected workspace list", async () => {
    const claims = await import("@/domains/catalog/hooks/use-claims");
    const addItem = vi.fn().mockResolvedValue(undefined);
    vi.mocked(claims.useSavedLists).mockReturnValue(
      savedListsQuery({
        data: [
          {
            id: "list_1",
            user_id: "user_1",
            name: "Coalition outreach",
            description: "Field follow-up",
            item_count: 2,
            items: [],
            created_at: "2026-07-01T00:00:00.000Z",
            updated_at: "2026-07-02T00:00:00.000Z",
          },
        ],
        isLoading: false,
      }),
    );
    vi.mocked(claims.useAddSavedListItem).mockReturnValue(
      addSavedListItemMutation({
        mutateAsync: addItem,
        isPending: false,
      }),
    );

    render(<BriefDetailPage briefExport={briefExport()} />);

    expect(screen.getByRole("heading", { name: "Save linked actors" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Target list"), { target: { value: "list_1" } });
    fireEvent.click(screen.getByRole("button", { name: "Save 1 actor" }));

    await waitFor(() => {
      expect(addItem).toHaveBeenCalledWith({
        listId: "list_1",
        body: {
          entry_id: "entry_1",
          note: "From Atlas Brief: Tenant Power in Kansas City",
        },
      });
    });
    expect(screen.getByText("Saved 1 actor to Coalition outreach.")).toBeInTheDocument();
  });

  it("updates editable brief memo fields without dropping evidence context", async () => {
    const briefs = await import("@/domains/workspace/hooks/use-briefs");
    const updateBrief = vi.fn().mockResolvedValue({
      ...briefExport().brief,
      title: "Reviewed Tenant Power Brief",
      summary: "Reviewed source-linked summary.",
      confidence_summary: {
        source_count: 3,
        state: "partial",
        review_status: "reviewed by research",
      },
      gaps: [
        {
          label: "County organizers",
          detail: "Confirm county-level organizing before regional outreach.",
        },
      ],
    });
    vi.mocked(briefs.useUpdateWorkspaceBrief).mockReturnValue(
      updateBriefMutation({
        mutateAsync: updateBrief,
        isPending: false,
      }),
    );

    render(<BriefDetailPage briefExport={briefExport()} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit brief" }));
    fireEvent.change(screen.getByLabelText("Brief title"), {
      target: { value: "Reviewed Tenant Power Brief" },
    });
    fireEvent.change(screen.getByLabelText("Brief summary"), {
      target: { value: "Reviewed source-linked summary." },
    });
    fireEvent.change(screen.getByLabelText("Confidence state"), {
      target: { value: "partial" },
    });
    fireEvent.change(screen.getByLabelText("Review status"), {
      target: { value: "reviewed by research" },
    });
    fireEvent.change(screen.getByLabelText("Known gaps"), {
      target: {
        value: "County organizers: Confirm county-level organizing before regional outreach.",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save brief" }));

    await waitFor(() => {
      expect(updateBrief).toHaveBeenCalledWith({
        briefId: "brief_123",
        confidence_summary: {
          source_count: 3,
          state: "partial",
          review_status: "reviewed by research",
        },
        gaps: [
          {
            label: "County organizers",
            detail: "Confirm county-level organizing before regional outreach.",
          },
        ],
        summary: "Reviewed source-linked summary.",
        title: "Reviewed Tenant Power Brief",
      });
    });
    expect(
      screen.getByRole("heading", { name: "Reviewed Tenant Power Brief" }),
    ).toBeInTheDocument();
    expect(screen.getByText("KC Tenants")).toBeInTheDocument();
    expect(screen.getByText("Tenant organizers expand court watch")).toBeInTheDocument();
  });
});
