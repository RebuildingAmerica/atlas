// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProfilesMarquee } from "@/domains/catalog/components/profiles/profiles-marquee";
import { createEntryFixture } from "../../../../fixtures/catalog/entries";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("ProfilesMarquee", () => {
  it("features the first entry and offers the next two as companions", () => {
    render(
      <ProfilesMarquee
        entries={[
          createEntryFixture({ name: "Jane Doe", slug: "jane-doe-a3f2" }),
          createEntryFixture({ id: "entry-2", name: "Ada Reyes", slug: "ada-reyes-b2" }),
          createEntryFixture({ id: "entry-3", name: "Prairie Coop", slug: "prairie-coop-c3" }),
          createEntryFixture({ id: "entry-4", name: "Never Shown", slug: "never-shown-d4" }),
        ]}
        issueAreaLabels={{}}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Profiles worth opening" }),
    ).toBeInTheDocument();
    // The lead card is the only one promoted to an h2-level headline.
    expect(screen.getByRole("heading", { level: 2, name: "Jane Doe" })).toBeInTheDocument();
    expect(screen.getByText("Featured")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Ada Reyes" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Prairie Coop" })).toBeInTheDocument();
    expect(screen.queryByText("Never Shown")).not.toBeInTheDocument();
  });

  it("features a lone entry without companions beside it", () => {
    render(<ProfilesMarquee entries={[createEntryFixture()]} issueAreaLabels={{}} />);
    expect(screen.getByRole("heading", { level: 2, name: "Jane Doe" })).toBeInTheDocument();
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  });

  it("holds the spotlight rhythm with placeholders while loading", () => {
    const { container } = render(<ProfilesMarquee entries={[]} isLoading issueAreaLabels={{}} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Featured profiles" }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("surfaces the failure instead of a silent gap", () => {
    render(
      <ProfilesMarquee
        entries={[createEntryFixture()]}
        error={new Error("Spotlight is unavailable.")}
        issueAreaLabels={{}}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: "Featured profiles" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Spotlight is unavailable.")).toBeInTheDocument();
    expect(screen.queryByText("Jane Doe")).not.toBeInTheDocument();
  });

  it("renders nothing when there is nothing to spotlight", () => {
    const { container } = render(<ProfilesMarquee entries={[]} issueAreaLabels={{}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
