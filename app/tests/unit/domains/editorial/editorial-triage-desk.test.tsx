// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EditorialTriageDesk } from "@/domains/editorial/editorial-triage-desk";
import {
  TRIAGE_NOW,
  clearTriage,
  editorialTriage,
} from "../../../fixtures/editorial/editorial-triage";

afterEach(cleanup);

describe("EditorialTriageDesk", () => {
  it("puts the longest wait first and says how long each has waited", () => {
    render(<EditorialTriageDesk now={TRIAGE_NOW} triage={editorialTriage()} />);

    expect(screen.getByText("7 waiting for review, longest wait first.")).toBeInTheDocument();
    const links = within(screen.getByRole("region", { name: "Needs you" })).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("aria-label"))).toEqual([
      "Review visitor corrections",
      "Review discovered profiles",
      "Review profile verifications",
    ]);
    const corrections = screen.getByRole("link", { name: "Review visitor corrections" });
    expect(corrections).toHaveAttribute("href", "/editorial/corrections");
    expect(within(corrections).getByText("4 waiting")).toBeInTheDocument();
    expect(within(corrections).getByText("Oldest waiting 3 days")).toBeInTheDocument();
    expect(
      within(screen.getByRole("link", { name: "Review discovered profiles" })).getByText(
        "Oldest waiting 1 day",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("link", { name: "Review profile verifications" })).getByText(
        "Oldest waiting 2 hours",
      ),
    ).toBeInTheDocument();
  });

  it("reads a short wait, a single hour, and a time it cannot parse", () => {
    render(
      <EditorialTriageDesk
        now={TRIAGE_NOW}
        triage={editorialTriage({
          claims: { oldestAt: "2026-10-09T11:59:00Z", waiting: 1 },
          corrections: { oldestAt: "2026-10-09T11:00:00Z", waiting: 1 },
          discoveryReviews: { oldestAt: "yesterday-ish", waiting: 1 },
        })}
      />,
    );

    expect(screen.getByText("Oldest waiting under an hour")).toBeInTheDocument();
    expect(screen.getByText("Oldest waiting 1 hour")).toBeInTheDocument();
    expect(screen.getByText("Waiting since yesterday-ish")).toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links.at(-1)).toHaveAttribute("aria-label", "Review discovered profiles");
  });

  it("marks empty queues clear, and an undated waiting item without an age", () => {
    render(
      <EditorialTriageDesk
        now={TRIAGE_NOW}
        triage={{ ...clearTriage(), claims: { oldestAt: null, waiting: 2 } }}
      />,
    );

    expect(screen.getAllByText("Clear")).toHaveLength(2);
    expect(screen.getByText("2 waiting")).toBeInTheDocument();
    expect(screen.queryByText(/Oldest waiting/)).toBeNull();
  });

  it("says when nothing is waiting", () => {
    render(<EditorialTriageDesk now={TRIAGE_NOW} triage={clearTriage()} />);

    expect(screen.getByText("Nothing is waiting for review.")).toBeInTheDocument();
  });

  it("still links to every queue while loading or after a failure", () => {
    render(<EditorialTriageDesk errorMessage="Review queues could not load." now={0} />);

    expect(screen.getByText("Review queues could not load.")).toBeInTheDocument();
    expect(screen.getByText("Review queues, longest wait first.")).toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(3);
    expect(screen.queryByText("Clear")).toBeNull();
  });
});
