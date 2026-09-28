// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderReportStatusPage } from "../../../../helpers/render-report-status-page";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const harness = await import("@/../tests/helpers/router-harness");
  return { ...(await importOriginal<object>()), ...harness.installRouterMocks() };
});

vi.mock("@rebuildingamerica/atlas-api-client/generated/atlas", () => ({
  getEntityFlagStatus: vi.fn(),
}));

vi.mock("@rebuildingamerica/atlas-ui/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe("routes/_public/reports/$reportId", () => {
  beforeEach(async () => {
    const { readRouterMocks, resetRouterMocks } = await import("@/../tests/helpers/router-harness");
    resetRouterMocks();
    readRouterMocks().useParams.mockReturnValue({ reportId: "flag-1" });
    const { getEntityFlagStatus } =
      await import("@rebuildingamerica/atlas-api-client/generated/atlas");
    vi.mocked(getEntityFlagStatus).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("tells the reporter an open report is waiting for an editor", async () => {
    const { getEntityFlagStatus } =
      await import("@rebuildingamerica/atlas-api-client/generated/atlas");
    vi.mocked(getEntityFlagStatus).mockResolvedValue({
      id: "flag-1",
      status: "open",
      created_at: "2026-09-28T20:00:00Z",
      reviewed_at: null,
    });

    await renderReportStatusPage();

    expect(await screen.findByText("Waiting for an editor.")).toBeInTheDocument();
    expect(screen.getByText("flag-1")).toBeInTheDocument();
    expect(getEntityFlagStatus).toHaveBeenCalledWith("flag-1");
  });

  it("says when an editor resolved the report", async () => {
    const { getEntityFlagStatus } =
      await import("@rebuildingamerica/atlas-api-client/generated/atlas");
    vi.mocked(getEntityFlagStatus).mockResolvedValue({
      id: "flag-1",
      status: "resolved",
      created_at: "2026-09-28T20:00:00Z",
      reviewed_at: "2026-09-29T15:00:00Z",
    });

    await renderReportStatusPage();

    expect(
      await screen.findByText(
        "An Atlas editor reviewed this report on Sep 29, 2026 and resolved it.",
      ),
    ).toBeInTheDocument();
  });

  it("says when an editor reviewed the report without changing the record", async () => {
    const { getEntityFlagStatus } =
      await import("@rebuildingamerica/atlas-api-client/generated/atlas");
    vi.mocked(getEntityFlagStatus).mockResolvedValue({
      id: "flag-1",
      status: "reviewed",
      created_at: "2026-09-28T20:00:00Z",
      reviewed_at: "2026-09-29T15:00:00Z",
    });

    await renderReportStatusPage();

    expect(
      await screen.findByText(
        "An Atlas editor reviewed this report on Sep 29, 2026 and did not change the record.",
      ),
    ).toBeInTheDocument();
  });

  it("leaves out the date for an older report closed before review dates were recorded", async () => {
    const { getEntityFlagStatus } =
      await import("@rebuildingamerica/atlas-api-client/generated/atlas");
    vi.mocked(getEntityFlagStatus).mockResolvedValue({
      id: "flag-1",
      status: "resolved",
      created_at: "2026-09-01T20:00:00Z",
      reviewed_at: null,
    });

    await renderReportStatusPage();

    expect(
      await screen.findByText("An Atlas editor reviewed this report and resolved it."),
    ).toBeInTheDocument();
  });

  it("explains how to follow up when the reference is not found", async () => {
    const { getEntityFlagStatus } =
      await import("@rebuildingamerica/atlas-api-client/generated/atlas");
    vi.mocked(getEntityFlagStatus).mockRejectedValue(new Error("Report not found"));

    await renderReportStatusPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Atlas could not find that report.");
  });

  it("keeps the status page out of search results", async () => {
    const { Route } = await import("@/routes/_public/reports/$reportId");
    const head = Route.options.head?.({ params: { reportId: "flag-1" } } as never);

    expect(JSON.stringify(head)).toContain("noindex");
  });
});
