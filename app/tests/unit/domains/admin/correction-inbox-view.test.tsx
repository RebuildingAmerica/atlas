// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CorrectionInboxView } from "@/domains/admin/correction-inbox-view";
import type { CorrectionReport } from "@/domains/admin/correction-inbox.functions";

describe("CorrectionInboxView", () => {
  function report(): CorrectionReport {
    return {
      createdAt: "2026-09-27T17:00:00Z",
      entitySlug: "las-vegas-civic-group",
      entityType: "organization",
      id: "report-1",
      linkedProfiles: [],
      note: "The listed meeting time is wrong.\n\nContact: reporter@example.org",
      reason: "incorrect",
      sourceUrl: null,
      targetId: "entry-1",
      targetName: "Las Vegas Civic Group",
      targetType: "entity",
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

    expect(screen.getByRole("heading", { name: "Visitor corrections" })).toBeInTheDocument();
    expect(screen.getByText(/The listed meeting time is wrong/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Las Vegas Civic Group" })).toHaveAttribute(
      "href",
      "/profiles/organizations/las-vegas-civic-group",
    );
    fireEvent.click(screen.getByRole("button", { name: "Resolve Las Vegas Civic Group" }));
    expect(onDecision).toHaveBeenCalledWith("report-1", "entity", "resolve");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Las Vegas Civic Group" }));
    expect(onDecision).toHaveBeenCalledWith("report-1", "entity", "dismiss");
  });

  it("shows a source report in the same queue with a safe evidence link", () => {
    const onDecision = vi.fn();
    render(
      <CorrectionInboxView
        isLoading={false}
        items={[
          {
            createdAt: "2026-09-27T18:00:00Z",
            entitySlug: null,
            entityType: null,
            id: "source-report-1",
            linkedProfiles: [
              {
                name: "Las Vegas Civic Group",
                slug: "las-vegas-civic-group",
                type: "organization",
              },
            ],
            note: "The official page no longer supports this claim.",
            reason: "outdated_source",
            sourceUrl: "https://example.org/source",
            targetId: "source-1",
            targetName: "Official housing source",
            targetType: "source",
          },
        ]}
        offset={0}
        onDecision={onDecision}
        onPageChange={vi.fn()}
        pageSize={25}
        total={1}
      />,
    );
    expect(screen.getByRole("heading", { name: "Visitor corrections" })).toBeInTheDocument();
    expect(
      screen.getByText("The official page no longer supports this claim."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Official housing source" })).toHaveAttribute(
      "href",
      "https://example.org/source",
    );
    expect(screen.getByRole("link", { name: "Open Official housing source" })).toHaveAttribute(
      "target",
      "_blank",
    );
    expect(screen.getByRole("link", { name: "Las Vegas Civic Group" })).toHaveAttribute(
      "href",
      "/profiles/organizations/las-vegas-civic-group",
    );
    fireEvent.click(screen.getByRole("button", { name: "Resolve Official housing source" }));
    expect(onDecision).toHaveBeenCalledWith("source-report-1", "source", "resolve");
  });

  it("does not open an unsafe source URL from a report", () => {
    render(
      <CorrectionInboxView
        isLoading={false}
        items={[
          {
            ...report(),
            entitySlug: null,
            entityType: null,
            sourceUrl: "javascript:alert(1)",
            targetName: "Untrusted source",
            targetType: "source",
          },
        ]}
        offset={0}
        onDecision={vi.fn()}
        onPageChange={vi.fn()}
        pageSize={25}
        total={1}
      />,
    );
    expect(screen.queryByRole("link", { name: "Open Untrusted source" })).not.toBeInTheDocument();
  });

  it("keeps source reports actionable when their URL is missing or malformed", () => {
    const item: CorrectionReport = {
      ...report(),
      entitySlug: null,
      entityType: null,
      sourceUrl: null,
      targetName: "Source without a link",
      targetType: "source",
    };
    const props = {
      isLoading: false,
      offset: 0,
      onDecision: vi.fn(),
      onPageChange: vi.fn(),
      pageSize: 25,
      total: 1,
    };
    const { rerender } = render(<CorrectionInboxView {...props} items={[item]} />);
    expect(
      screen.queryByRole("link", { name: "Open Source without a link" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No public profile currently links this source.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolve Source without a link" })).toBeEnabled();

    rerender(
      <CorrectionInboxView
        {...props}
        items={[
          {
            ...item,
            linkedProfiles: [{ name: "Unroutable place", slug: "place", type: "place" }],
          },
        ]}
      />,
    );
    expect(screen.getByText("Unroutable place")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Unroutable place" })).not.toBeInTheDocument();

    rerender(
      <CorrectionInboxView
        {...props}
        items={[{ ...item, sourceUrl: "not a url", targetName: "Malformed source" }]}
      />,
    );
    expect(screen.queryByRole("link", { name: "Open Malformed source" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resolve Malformed source" })).toBeEnabled();
  });

  it("does not make unsafe profile links and preserves loading or decision errors", () => {
    const { rerender } = render(
      <CorrectionInboxView
        decisionError="Decision could not be saved."
        isLoading={false}
        items={[{ ...report(), entitySlug: "a-place", entityType: null, note: null }]}
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
    rerender(
      <CorrectionInboxView
        isLoading={false}
        items={[{ ...report(), entitySlug: null }]}
        offset={0}
        onDecision={vi.fn()}
        onPageChange={vi.fn()}
        pageSize={25}
        total={1}
      />,
    );
    expect(
      screen.queryByRole("link", { name: /Open Las Vegas Civic Group/ }),
    ).not.toBeInTheDocument();
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
    expect(screen.getByRole("region", { name: "Open visitor reports" })).toBeInTheDocument();
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
    expect(screen.getByText("No open visitor reports.")).toBeInTheDocument();
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
    expect(screen.queryByText("No open visitor reports.")).not.toBeInTheDocument();
  });
});
