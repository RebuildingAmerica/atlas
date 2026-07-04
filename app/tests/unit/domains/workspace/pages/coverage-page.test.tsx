// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CoveragePage } from "@/domains/workspace/pages/coverage-page";
import type {
  CoverageTarget,
  CoverageTargetCollection,
} from "@/domains/workspace/server/coverage-targets";

const mocks = vi.hoisted(() => ({
  exportOrgCoverageTargets: vi.fn(),
  getExportOrgCoverageTargetsUrl: vi.fn(),
  useImportCoverageTargets: vi.fn(),
  useCoverageTargets: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/workspace/hooks/use-coverage-targets", () => ({
  useImportCoverageTargets: mocks.useImportCoverageTargets,
  useCoverageTargets: mocks.useCoverageTargets,
}));

vi.mock("@/lib/generated/atlas", () => ({
  exportOrgCoverageTargets: mocks.exportOrgCoverageTargets,
  getExportOrgCoverageTargetsUrl: mocks.getExportOrgCoverageTargetsUrl,
}));

describe("CoveragePage", () => {
  beforeEach(() => {
    mocks.exportOrgCoverageTargets.mockReset();
    mocks.getExportOrgCoverageTargetsUrl.mockReset();
    mocks.getExportOrgCoverageTargetsUrl.mockImplementation(
      (orgId: string, params?: { format?: string }) =>
        `/api/orgs/${orgId}/coverage-targets/export${params?.format ? `?format=${params.format}` : ""}`,
    );
    mocks.useCoverageTargets.mockReset();
    mocks.useImportCoverageTargets.mockReset();
    mocks.useImportCoverageTargets.mockReturnValue({
      isPending: false,
      mutateAsync: vi.fn().mockResolvedValue({ created: [], imported: 0 }),
    });
  });

  afterEach(() => {
    cleanup();
  });

  function target(overrides: Partial<CoverageTarget>): CoverageTarget {
    return {
      actor_types: ["organization"],
      created_at: "2026-07-01T00:00:00.000Z",
      created_by: "operator_1",
      gaps: [],
      geography: "Kansas City, MO",
      id: "coverage_1",
      issue_areas: ["housing_affordability"],
      last_reviewed_at: "2026-07-02T00:00:00.000Z",
      last_run_at: "2026-07-02T00:00:00.000Z",
      linked_discovery_run_ids: ["run_1"],
      linked_entry_ids: ["entry_1", "entry_2", "entry_3"],
      name: "Kansas City tenant power",
      next_actions: [],
      org_id: "org_123",
      records_found: 3,
      review_state: "needs_research",
      source_types: ["news", "website"],
      sources_reviewed: 3,
      status: "covered",
      status_reason: "At least 3 records and 3 sources are linked.",
      updated_at: "2026-07-02T00:00:00.000Z",
      ...overrides,
    };
  }

  function collection(): CoverageTargetCollection {
    return {
      total: 5,
      items: [
        target({
          id: "coverage_covered",
          name: "Kansas City tenant power",
          review_state: "ready_for_delivery",
          status: "covered",
          gaps: [
            {
              label: "County reach",
              detail: "Confirm organizers active outside the city core.",
            },
          ],
          next_actions: ["Call tenant hotline partners", "Review county filings"],
        }),
        target({
          id: "coverage_thin",
          name: "Nevada mutual aid",
          geography: "Clark County, NV",
          issue_areas: ["food_security"],
          records_found: 2,
          sources_reviewed: 1,
          status: "thin",
          status_reason: "Fewer than 3 records or 3 sources are linked.",
        }),
        target({
          id: "coverage_stale",
          name: "Detroit labor table",
          geography: "Detroit, MI",
          last_reviewed_at: "2026-01-01T00:00:00.000Z",
          status: "stale",
          status_reason: "Latest linked discovery run or review is older than 90 days.",
        }),
        target({
          id: "coverage_unknown",
          name: "Appalachia broadband coalition",
          geography: "Eastern Kentucky",
          linked_discovery_run_ids: [],
          linked_entry_ids: [],
          last_reviewed_at: null,
          last_run_at: null,
          records_found: 0,
          sources_reviewed: 0,
          status: "unknown",
          status_reason: "No linked discovery runs or records yet.",
        }),
        target({
          id: "coverage_blocked",
          name: "Florida legal defense",
          geography: "Florida",
          status: "blocked",
          status_reason: "Latest linked discovery run failed.",
        }),
      ],
    };
  }

  it("renders workspace coverage targets with plain status language and operator actions", () => {
    const initialCoverageTargets = collection();
    mocks.useCoverageTargets.mockReturnValue({ data: initialCoverageTargets });

    render(<CoveragePage initialCoverageTargets={initialCoverageTargets} orgId="org_123" />);

    expect(mocks.useCoverageTargets).toHaveBeenCalledWith(initialCoverageTargets, "org_123");
    expect(screen.getByRole("heading", { name: "Coverage Workspace" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Research" })).toHaveAttribute(
      "data-link-to",
      "/discovery",
    );
    expect(screen.getByRole("button", { name: "Download CSV" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download JSON" })).toBeInTheDocument();
    expect(screen.getAllByText("5 targets")).toHaveLength(2);
    expect(screen.getByText("4 need work")).toBeInTheDocument();
    expect(screen.getAllByText("Covered")).toHaveLength(2);
    expect(screen.getByText("Ready for delivery")).toBeInTheDocument();
    expect(screen.getAllByText("Needs research").length).toBeGreaterThan(0);
    expect(screen.getByText("Current records and sources.")).toBeInTheDocument();
    expect(screen.getByText("Fewer than 3 records or sources.")).toBeInTheDocument();
    expect(screen.getByText("Not reviewed in 90 days.")).toBeInTheDocument();
    expect(screen.getByText("No linked records yet.")).toBeInTheDocument();
    expect(screen.getByText("Latest review failed.")).toBeInTheDocument();
    expect(screen.queryByText(/discovery run/i)).not.toBeInTheDocument();

    const tenantTarget = screen.getByTestId("coverage-target-coverage_covered");
    expect(within(tenantTarget).getByRole("heading", { name: "Kansas City tenant power" }));
    expect(
      within(tenantTarget).getByRole("link", { name: "Kansas City tenant power" }),
    ).toHaveAttribute("data-link-to", "/coverage/$targetId");
    expect(
      within(tenantTarget).getByRole("link", { name: "Kansas City tenant power" }),
    ).toHaveAttribute("data-link-params", JSON.stringify({ targetId: "coverage_covered" }));
    expect(within(tenantTarget).getByText("Kansas City, MO")).toBeInTheDocument();
    expect(within(tenantTarget).getByText("housing affordability")).toBeInTheDocument();
    expect(within(tenantTarget).getByText("3 records")).toBeInTheDocument();
    expect(within(tenantTarget).getByText("3 sources")).toBeInTheDocument();
    expect(within(tenantTarget).getByText("County reach")).toBeInTheDocument();
    expect(within(tenantTarget).getByText("Call tenant hotline partners")).toBeInTheDocument();
  });

  it("renders a plain empty state", () => {
    const initialCoverageTargets: CoverageTargetCollection = { items: [], total: 0 };
    mocks.useCoverageTargets.mockReturnValue({ data: initialCoverageTargets });

    render(<CoveragePage initialCoverageTargets={initialCoverageTargets} orgId="org_123" />);

    expect(screen.getByText("No coverage targets yet.")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Research" })[0]).toHaveAttribute(
      "data-link-to",
      "/discovery",
    );
  });

  it("downloads CSV and JSON coverage reports", async () => {
    const initialCoverageTargets = collection();
    const createObjectUrl = vi.fn().mockReturnValue("blob:atlas-coverage-export");
    const revokeObjectUrl = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);
    click.mockClear();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("target_id,name\ncoverage_covered,Kansas City tenant power\n"),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrl,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: revokeObjectUrl,
    });
    mocks.useCoverageTargets.mockReturnValue({ data: initialCoverageTargets });
    mocks.exportOrgCoverageTargets.mockResolvedValue({
      format: "json",
      org_id: "org_123",
      generated_at: "2026-07-03T00:00:00.000Z",
      summary: { total_targets: 5 },
      targets: [{ id: "coverage_covered", name: "Kansas City tenant power" }],
    });

    render(<CoveragePage initialCoverageTargets={initialCoverageTargets} orgId="org_123" />);

    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    await waitFor(() => {
      expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    });
    const csvBlob = createObjectUrl.mock.calls[0]?.[0] as Blob;
    await expect(csvBlob.text()).resolves.toContain("Kansas City tenant power");
    expect(fetchMock).toHaveBeenCalledWith("/api/orgs/org_123/coverage-targets/export?format=csv", {
      headers: { Accept: "text/csv" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Download JSON" }));
    await waitFor(() => {
      expect(createObjectUrl).toHaveBeenCalledTimes(2);
    });
    const jsonBlob = createObjectUrl.mock.calls[1]?.[0] as Blob;
    await expect(jsonBlob.text()).resolves.toContain('"org_id": "org_123"');
    expect(mocks.exportOrgCoverageTargets).toHaveBeenCalledWith("org_123");
    expect(click).toHaveBeenCalledTimes(2);
    expect(revokeObjectUrl).toHaveBeenLastCalledWith("blob:atlas-coverage-export");
  });

  it("imports coverage targets from onboarding CSV rows", async () => {
    const initialCoverageTargets = collection();
    const mutateAsync = vi.fn().mockResolvedValue({ created: [], imported: 2 });
    const csvText = "name,geography,issue_areas,actor_types,source_types\n";
    mocks.useCoverageTargets.mockReturnValue({ data: initialCoverageTargets });
    mocks.useImportCoverageTargets.mockReturnValue({
      isPending: false,
      mutateAsync,
    });

    render(<CoveragePage initialCoverageTargets={initialCoverageTargets} orgId="org_123" />);

    fireEvent.change(screen.getByLabelText("Coverage target CSV"), {
      target: { value: csvText },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import CSV" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith({ csv_text: csvText });
    });
    expect(screen.getByText("2 targets imported.")).toBeInTheDocument();
  });
});
