// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CorrectionInboxView } from "@/domains/admin/correction-inbox-view";
import type { CorrectionReport } from "@/domains/admin/correction-inbox.functions";

describe("CorrectionInboxView", () => {
  function report(): CorrectionReport {
    return {
      createdAt: "2026-09-27T17:00:00Z",
      entityId: "entry-1",
      entityName: "Las Vegas Civic Group",
      entitySlug: "las-vegas-civic-group",
      entityType: "organization",
      id: "report-1",
      note: "The listed meeting time is wrong.\n\nContact: reporter@example.org",
      reason: "incorrect",
    };
  }

  it("shows a private report with profile context and requires an explicit disposition", () => {
    const onDecision = vi.fn();
    render(
      <CorrectionInboxView
        isLoading={false}
        items={[report()]}
        offset={0}
        onDecision={onDecision}
        onPageChange={vi.fn()}
        pageSize={25}
        total={1}
      />,
    );

    expect(screen.getByRole("heading", { name: "Profile corrections" })).toBeInTheDocument();
    expect(screen.getByText(/The listed meeting time is wrong/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Las Vegas Civic Group" })).toHaveAttribute(
      "href",
      "/profiles/organizations/las-vegas-civic-group",
    );
    fireEvent.click(screen.getByRole("button", { name: "Resolve Las Vegas Civic Group" }));
    expect(onDecision).toHaveBeenCalledWith("report-1", "resolve");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Las Vegas Civic Group" }));
    expect(onDecision).toHaveBeenCalledWith("report-1", "dismiss");
  });

  it("does not make unsafe profile links and preserves loading or decision errors", () => {
    render(
      <CorrectionInboxView
        decisionError="Decision could not be saved."
        isLoading={false}
        items={[{ ...report(), entitySlug: "a-place", entityType: "place", note: null }]}
        offset={0}
        onDecision={vi.fn()}
        onPageChange={vi.fn()}
        pageSize={25}
        pendingItemId="report-1"
        total={1}
      />,
    );
    expect(
      screen.queryByRole("link", { name: /Open Las Vegas Civic Group/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No detail supplied.")).toBeInTheDocument();
    expect(screen.getByText("Decision could not be saved.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolve Las Vegas Civic Group" })).toBeDisabled();
  });

  it("links person reports and pages the oldest open items", () => {
    const onPageChange = vi.fn();
    render(
      <CorrectionInboxView
        isLoading={false}
        items={[{ ...report(), entitySlug: "maya-organizer", entityType: "person" }]}
        offset={25}
        onDecision={vi.fn()}
        onPageChange={onPageChange}
        pageSize={25}
        total={51}
      />,
    );
    expect(screen.getByRole("link", { name: "Open Las Vegas Civic Group" })).toHaveAttribute(
      "href",
      "/profiles/people/maya-organizer",
    );
    const nav = screen.getByRole("navigation", { name: "Correction pages" });
    fireEvent.click(within(nav).getByRole("button", { name: "Previous reports" }));
    expect(onPageChange).toHaveBeenCalledWith(0);
    fireEvent.click(within(nav).getByRole("button", { name: "Next reports" }));
    expect(onPageChange).toHaveBeenCalledWith(50);
  });

  it("disables page controls at the queue boundaries", () => {
    const { rerender } = render(
      <CorrectionInboxView
        isLoading={false}
        items={[report()]}
        offset={0}
        onDecision={vi.fn()}
        onPageChange={vi.fn()}
        pageSize={25}
        total={26}
      />,
    );
    expect(screen.getByRole("button", { name: "Previous reports" })).toBeDisabled();
    rerender(
      <CorrectionInboxView
        isLoading={false}
        items={[report()]}
        offset={25}
        onDecision={vi.fn()}
        onPageChange={vi.fn()}
        pageSize={25}
        total={26}
      />,
    );
    expect(screen.getByRole("button", { name: "Next reports" })).toBeDisabled();
  });

  it("has clear empty, loading, and failure states", () => {
    const { rerender } = render(
      <CorrectionInboxView
        isLoading={true}
        items={[]}
        offset={0}
        onDecision={vi.fn()}
        onPageChange={vi.fn()}
        pageSize={25}
        total={0}
      />,
    );
    expect(screen.getByRole("region", { name: "Open profile reports" })).toBeInTheDocument();
    rerender(
      <CorrectionInboxView
        isLoading={false}
        items={[]}
        offset={0}
        onDecision={vi.fn()}
        onPageChange={vi.fn()}
        pageSize={25}
        total={0}
      />,
    );
    expect(screen.getByText("No open profile reports.")).toBeInTheDocument();
    rerender(
      <CorrectionInboxView
        errorMessage="Profile reports could not load."
        isLoading={false}
        items={[]}
        offset={0}
        onDecision={vi.fn()}
        onPageChange={vi.fn()}
        pageSize={25}
        total={0}
      />,
    );
    expect(screen.getByText("Profile reports could not load.")).toBeInTheDocument();
    expect(screen.queryByText("No open profile reports.")).not.toBeInTheDocument();
  });
});
