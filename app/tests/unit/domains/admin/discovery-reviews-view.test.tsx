// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DiscoveryReviewsView } from "@/domains/admin/discovery-reviews-view";
import type { DiscoveryReview } from "@/domains/admin/discovery-reviews.functions";

describe("DiscoveryReviewsView", () => {
  const review = (overrides: Partial<DiscoveryReview> = {}): DiscoveryReview => {
    return {
      changes: [{ after: "New work", before: "Old work", field: "description" }],
      entityName: "Civic Group",
      entitySlug: "civic-group",
      entityType: "organization",
      holdReason: "published_profile_change",
      id: "7cb2c69a-f22b-4f4e-ab83-16872c9fd59e",
      sourceUrls: ["https://example.org/about"],
      ...overrides,
    };
  };

  const renderQueue = (items: DiscoveryReview[], onDecision = vi.fn()) => {
    render(
      <DiscoveryReviewsView
        isLoading={false}
        items={items}
        offset={0}
        onDecision={onDecision}
        onPageChange={vi.fn()}
        pageSize={25}
        total={items.length}
      />,
    );
    return onDecision;
  };

  it("shows the current fact, proposal, profile, and source before approval", () => {
    const onDecision = renderQueue([review()]);

    expect(screen.getByText("Old work")).toBeInTheDocument();
    expect(screen.getByText("New work")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open current profile" })).toHaveAttribute(
      "href",
      "/profiles/organizations/civic-group",
    );
    expect(screen.getByRole("link", { name: "https://example.org/about" })).toHaveAttribute(
      "href",
      "https://example.org/about",
    );

    const approve = screen.getByRole("button", { name: "Approve Civic Group" });
    expect(approve).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /I checked these sources/ }));
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    expect(onDecision).toHaveBeenCalledWith("7cb2c69a-f22b-4f4e-ab83-16872c9fd59e", "approve");
  });

  it("does not offer approval without a usable source", () => {
    const onDecision = renderQueue([review({ sourceUrls: ["javascript:alert(1)"] })]);

    expect(screen.queryByRole("link", { name: /javascript:/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve Civic Group" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reject Civic Group" }));
    expect(onDecision).toHaveBeenCalledWith("7cb2c69a-f22b-4f4e-ab83-16872c9fd59e", "reject");
  });

  it("keeps unsupported links and held records out of the approval path", () => {
    renderQueue([
      review({
        changes: [],
        sourceUrls: ["not a URL"],
      }),
    ]);

    expect(screen.getByText("Publication hold")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open current profile" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Proposed changes/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve Civic Group" })).toBeDisabled();
  });

  it("shows a held organization's work, scope, issues, and action before approval", () => {
    renderQueue([
      review({
        changes: [],
        entityCity: "Las Vegas",
        entityDescription: "Organizes residents to advocate for better transit.",
        entityState: "NV",
        entityWebsite: "https://example.org/join",
        holdReason: "editorial_candidate",
        issueAreas: ["public_transit"],
        sourceUrls: ["https://example.org/about", "https://example.org/join"],
        sourceEvidence: [
          {
            url: "https://example.org/about",
            context: "The About page describes public education and transit advocacy.",
          },
        ],
      }),
    ]);

    expect(screen.getByRole("region", { name: "Profile facts for Civic Group" })).toHaveTextContent(
      "Organizes residents to advocate for better transit.",
    );
    expect(screen.getByText(/Las Vegas, NV.*public transit/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Official next step/ })).toHaveAttribute(
      "href",
      "https://example.org/join",
    );
    expect(
      screen.getByRole("region", { name: "Candidate sources for Civic Group" }),
    ).toHaveTextContent("The About page describes public education and transit advocacy.");
  });

  it("keeps a homepage evidence note beside its normalized link", () => {
    renderQueue([
      review({
        sourceUrls: ["https://example.org"],
        sourceEvidence: [
          {
            url: "https://example.org",
            context: "The homepage explains the group's current work.",
          },
        ],
      }),
    ]);

    const sources = screen.getByRole("region", { name: "Candidate sources for Civic Group" });
    expect(within(sources).getByRole("link", { name: "https://example.org/" })).toHaveAttribute(
      "href",
      "https://example.org/",
    );
    expect(sources).toHaveTextContent("The homepage explains the group's current work.");
  });

  it("shows missing place plainly and does not link an unsafe claimed next step", () => {
    renderQueue([
      review({
        changes: [],
        entityDescription: "A statewide group under editorial review.",
        entityWebsite: "javascript:alert(1)",
        issueAreas: [],
      }),
    ]);
    const facts = screen.getByRole("region", { name: "Profile facts for Civic Group" });
    expect(facts).toHaveTextContent("Place not listed");
    expect(within(facts).queryByRole("link")).not.toBeInTheDocument();
  });

  it("can review held facts that do not yet have an action link", () => {
    renderQueue([
      review({
        changes: [],
        entityCity: "Las Vegas",
        entityDescription: "A local group awaiting a next-step check.",
        entityWebsite: null,
      }),
    ]);
    expect(screen.getByRole("region", { name: "Profile facts for Civic Group" })).toHaveTextContent(
      "Las Vegas",
    );
    expect(screen.queryByRole("link", { name: /Official next step/ })).not.toBeInTheDocument();
  });

  it("links a person and leaves unknown entity types without a profile link", () => {
    renderQueue([
      review({
        entityName: "A person",
        entitySlug: "a-person",
        entityType: "person",
        id: "person",
      }),
      review({ entityName: "A place", entitySlug: "a-place", entityType: "place", id: "place" }),
      review({ entityName: "No slug", entitySlug: null, id: "no-slug" }),
    ]);

    expect(screen.getByRole("link", { name: "Open current profile" })).toHaveAttribute(
      "href",
      "/profiles/people/a-person",
    );
    expect(screen.getAllByRole("link", { name: "Open current profile" })).toHaveLength(1);
  });

  it("states when no reviews are waiting", () => {
    renderQueue([]);
    expect(screen.getByText("No discovery profiles waiting.")).toBeInTheDocument();
  });

  it("keeps the shell and review navigation available around loading and errors", () => {
    const onPageChange = vi.fn();
    render(
      <DiscoveryReviewsView
        errorMessage="Discovery reviews could not load."
        isLoading={false}
        items={[]}
        offset={25}
        onDecision={vi.fn()}
        onPageChange={onPageChange}
        pageSize={25}
        total={51}
      />,
    );

    expect(screen.getByRole("heading", { name: "Discovered profiles" })).toBeInTheDocument();
    expect(screen.getByText("Discovery reviews could not load.")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Review pages" });
    fireEvent.click(within(nav).getByRole("button", { name: "Previous reviews" }));
    expect(onPageChange).toHaveBeenCalledWith(0);
  });
});
