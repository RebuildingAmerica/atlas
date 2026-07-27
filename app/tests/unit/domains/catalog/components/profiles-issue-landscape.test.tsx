// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ProfilesIssueLandscape } from "@/domains/catalog/components/profiles/profiles-issue-landscape";
import { createEntryFixture } from "../../../../fixtures/catalog/entries";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("ProfilesIssueLandscape", () => {
  it("groups entries under their issue cluster with place, type and source count", () => {
    render(
      <ProfilesIssueLandscape
        groups={[
          {
            entries: [createEntryFixture({ source_count: 6 })],
            issueArea: "housing_affordability",
            title: "Housing affordability",
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Where the work is clustering" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Issue landscapes")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Housing affordability" }),
    ).toBeInTheDocument();

    const row = screen.getByRole("link");
    expect(row).toHaveAttribute("href", "/profiles/people/jane-doe-a3f2");
    expect(within(row).getByText("Jane Doe")).toBeInTheDocument();
    expect(within(row).getByText("Jackson, MS")).toBeInTheDocument();
    expect(within(row).getByText("Person")).toBeInTheDocument();
    expect(within(row).getByText("6 sources")).toBeInTheDocument();
  });

  it("compresses a long cluster to its first four rows", () => {
    render(
      <ProfilesIssueLandscape
        groups={[
          {
            entries: Array.from({ length: 6 }, (_, index) =>
              createEntryFixture({
                id: `entry-${index}`,
                name: `Person ${index}`,
                slug: `person-${index}`,
              }),
            ),
            issueArea: "housing_affordability",
            title: "Housing affordability",
          },
        ]}
      />,
    );

    expect(screen.queryAllByRole("link")).toHaveLength(4);
    expect(screen.getByText("Person 3")).toBeInTheDocument();
    expect(screen.queryByText("Person 4")).not.toBeInTheDocument();
  });

  it("shows a cluster's own failure without hiding the working clusters", () => {
    render(
      <ProfilesIssueLandscape
        groups={[
          {
            entries: [],
            error: new Error("Housing cluster is unavailable."),
            issueArea: "housing_affordability",
            title: "Housing affordability",
          },
          {
            entries: [createEntryFixture({ name: "Ada Reyes", slug: "ada-reyes-b2" })],
            issueArea: "public_health",
            title: "Public health",
          },
        ]}
      />,
    );

    expect(screen.getByText("Housing cluster is unavailable.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ada Reyes/ })).toBeInTheDocument();
  });

  it("drops clusters that came back empty", () => {
    render(
      <ProfilesIssueLandscape
        groups={[
          { entries: [], issueArea: "public_health", title: "Public health" },
          {
            entries: [createEntryFixture()],
            issueArea: "housing_affordability",
            title: "Housing affordability",
          },
        ]}
      />,
    );

    expect(screen.queryByText("Public health")).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 3, name: "Housing affordability" }),
    ).toBeInTheDocument();
  });

  it("holds two placeholder columns while the clusters load", () => {
    const { container } = render(<ProfilesIssueLandscape groups={[]} isLoading />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Where the work is clustering" }),
    ).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(4);
  });

  it("hides the whole band when every cluster is empty", () => {
    const { container } = render(
      <ProfilesIssueLandscape
        groups={[{ entries: [], issueArea: "public_health", title: "Public health" }]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
