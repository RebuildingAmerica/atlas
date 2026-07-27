// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProfilesShelf } from "@/domains/catalog/components/profiles/profiles-shelf";
import { createEntryFixture } from "../../../../fixtures/catalog/entries";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("ProfilesShelf", () => {
  it("lists each loaded entry as a card that links to its profile", () => {
    render(
      <ProfilesShelf
        entries={[
          createEntryFixture(),
          createEntryFixture({
            id: "entry-2",
            name: "Prairie Coop",
            slug: "prairie-coop-b1c2",
            type: "organization",
          }),
        ]}
        issueAreaLabels={{ housing_affordability: "Housing Affordability" }}
        subtitle="Curated"
        title="People to know"
      />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "People to know" })).toBeInTheDocument();
    expect(screen.getByText("Curated")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Jane Doe/ })).toHaveAttribute(
      "href",
      "/profiles/people/jane-doe-a3f2",
    );
    expect(screen.getByRole("link", { name: /Prairie Coop/ })).toHaveAttribute(
      "href",
      "/profiles/organizations/prairie-coop-b1c2",
    );
  });

  it("renders placeholders instead of cards while the shelf is loading", () => {
    const { container } = render(
      <ProfilesShelf entries={[]} isLoading issueAreaLabels={{}} title="People to know" />,
    );

    expect(screen.getByRole("heading", { level: 2, name: "People to know" })).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(4);
  });

  it("shows the failure instead of an empty shelf when the load errored", () => {
    render(
      <ProfilesShelf
        entries={[]}
        error={new Error("Profiles are unavailable right now.")}
        issueAreaLabels={{}}
        title="People to know"
      />,
    );

    expect(screen.getByText("Profiles are unavailable right now.")).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("hides itself entirely rather than leaving an empty section behind", () => {
    const { container } = render(
      <ProfilesShelf entries={[]} issueAreaLabels={{}} title="People to know" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
