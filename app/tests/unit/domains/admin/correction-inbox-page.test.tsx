// @vitest-environment jsdom
/* eslint-disable atlas-tests/no-test-file-locals */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CorrectionInboxPage } from "@/domains/admin/correction-inbox-page";

const mocks = vi.hoisted(() => ({
  decideCorrectionReport: vi.fn(),
  listCorrectionReports: vi.fn(),
  useHydrated: vi.fn(() => true),
}));

vi.mock("@/domains/admin/correction-inbox.functions", () => ({
  decideCorrectionReport: mocks.decideCorrectionReport,
  listCorrectionReports: mocks.listCorrectionReports,
}));
vi.mock("@/platform/runtime/use-hydrated", () => ({ useHydrated: mocks.useHydrated }));

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CorrectionInboxPage />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  mocks.decideCorrectionReport.mockReset();
  mocks.listCorrectionReports.mockReset();
  mocks.useHydrated.mockReset();
  mocks.useHydrated.mockReturnValue(true);
});

describe("CorrectionInboxPage", () => {
  const oneReport = {
    createdAt: "2026-09-27T17:00:00Z",
    entitySlug: "las-vegas-civic-group",
    entityType: "organization",
    id: "report-1",
    note: "Private correction",
    reason: "incorrect",
    sourceUrl: null,
    targetId: "entry-1",
    targetName: "Las Vegas Civic Group",
    targetType: "entity",
  };

  it("loads private reports and refreshes after a disposition", async () => {
    mocks.listCorrectionReports
      .mockResolvedValueOnce({
        items: [oneReport],
        total: 1,
      })
      .mockResolvedValue({ items: [], total: 0 });
    mocks.decideCorrectionReport.mockResolvedValue({ id: "report-1", status: "resolved" });
    renderPage();

    expect(await screen.findByText("Private correction")).toBeInTheDocument();
    expect(mocks.listCorrectionReports).toHaveBeenCalledWith({ data: { offset: 0 } });
    fireEvent.click(await screen.findByRole("button", { name: "Resolve Las Vegas Civic Group" }));
    await waitFor(() => {
      expect(mocks.decideCorrectionReport.mock.calls[0]?.[0]).toEqual({
        data: { decision: "resolve", reportId: "report-1", targetType: "entity" },
      });
      expect(mocks.listCorrectionReports).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("No open visitor reports.")).toBeInTheDocument();
  });

  it("keeps a report visible when its decision fails", async () => {
    mocks.listCorrectionReports.mockResolvedValue({
      items: [{ ...oneReport, entitySlug: null }],
      total: 1,
    });
    mocks.decideCorrectionReport.mockRejectedValue(new Error("API down"));
    renderPage();
    expect(await screen.findByText("Private correction")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Las Vegas Civic Group" }));
    expect(await screen.findByText("Decision could not be saved.")).toBeInTheDocument();
    expect(screen.getByText("Private correction")).toBeInTheDocument();
  });

  it("closes a source report through the source decision path", async () => {
    mocks.listCorrectionReports.mockResolvedValue({
      items: [
        {
          ...oneReport,
          entitySlug: null,
          entityType: null,
          id: "source-report-1",
          note: "Source is stale",
          sourceUrl: "https://example.org/source",
          targetId: "source-1",
          targetName: "Official source",
          targetType: "source",
        },
      ],
      total: 1,
    });
    mocks.decideCorrectionReport.mockResolvedValue({ id: "source-report-1", status: "resolved" });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Resolve Official source" }));
    await waitFor(() => {
      expect(mocks.decideCorrectionReport.mock.calls[0]?.[0]).toEqual({
        data: { decision: "resolve", reportId: "source-report-1", targetType: "source" },
      });
    });
  });

  it("returns to the previous page when its last open report closes", async () => {
    mocks.listCorrectionReports.mockResolvedValue({ items: [oneReport], total: 26 });
    mocks.decideCorrectionReport.mockResolvedValue({ id: "report-1", status: "resolved" });
    renderPage();
    expect(await screen.findByText("Private correction")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next reports" }));
    await waitFor(() => {
      expect(mocks.listCorrectionReports).toHaveBeenCalledWith({ data: { offset: 25 } });
    });
    fireEvent.click(await screen.findByRole("button", { name: "Resolve Las Vegas Civic Group" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Previous reports" })).toBeDisabled();
    });
  });

  it("shows a private queue load failure without an empty success state", async () => {
    mocks.listCorrectionReports.mockRejectedValue(new Error("API down"));
    renderPage();
    expect(await screen.findByText("Visitor reports could not load.")).toBeInTheDocument();
    expect(screen.queryByText("No open visitor reports.")).not.toBeInTheDocument();
  });

  it("prevents a second disposition while a report is closing", async () => {
    mocks.listCorrectionReports.mockResolvedValue({ items: [oneReport], total: 1 });
    mocks.decideCorrectionReport.mockReturnValue(new Promise(() => undefined));
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Resolve Las Vegas Civic Group" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Dismiss Las Vegas Civic Group" })).toBeDisabled();
    });
  });

  it("waits for hydration before requesting private notes", () => {
    mocks.useHydrated.mockReturnValue(false);
    renderPage();
    expect(mocks.listCorrectionReports).not.toHaveBeenCalled();
  });
});
