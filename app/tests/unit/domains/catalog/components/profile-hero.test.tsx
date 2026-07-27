// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProfileHero } from "@/domains/catalog/components/profiles/profile-hero";
import { createEntryFixture } from "../../../../fixtures/catalog/entries";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("ProfileHero", () => {
  it("leads with the subject's name, role and place", () => {
    render(<ProfileHero entry={createEntryFixture()} />);

    expect(screen.getByRole("heading", { level: 1, name: "Jane Doe" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Jane Doe" })).toHaveTextContent(
      "Community organizer · Community organizer focused on housing.",
    );
    expect(screen.getByText("Jackson, MS")).toBeInTheDocument();
  });

  it("labels the identity section by the name it displays", () => {
    render(<ProfileHero entry={createEntryFixture({ id: "entry-9" })} />);
    const section = screen.getByRole("region", { name: "Jane Doe" });
    expect(section).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("id", "profile-name-entry-9");
  });

  it("shows the subject photo eagerly when one is on file", () => {
    render(<ProfileHero entry={createEntryFixture({ photo_url: "https://img.test/jane.jpg" })} />);

    const photo = screen.getByRole("img", { name: "Jane Doe" });
    expect(photo).toHaveAttribute("src", "https://img.test/jane.jpg");
    expect(photo).toHaveAttribute("loading", "eager");
    expect(photo).toHaveAttribute("fetchpriority", "high");
  });

  it("uses a civic rule instead of an avatar when there is no photo", () => {
    const { container } = render(<ProfileHero entry={createEntryFixture()} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(container.querySelector(".border-l-civic")).not.toBeNull();
  });

  it("calls an organization what it is and describes its reach", () => {
    render(
      <ProfileHero
        entry={createEntryFixture({
          geo_specificity: "national",
          name: "Prairie Coop",
          type: "organization",
        })}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Prairie Coop" })).toBeInTheDocument();
    expect(screen.getByText(/^Organization/)).toBeInTheDocument();
    expect(screen.getByText(/Active nationally/)).toBeInTheDocument();
  });

  it("describes statewide, regional and local organizations distinctly", () => {
    const statewide = render(
      <ProfileHero
        entry={createEntryFixture({ geo_specificity: "statewide", type: "organization" })}
      />,
    );
    expect(screen.getByText(/Active statewide/)).toBeInTheDocument();
    statewide.unmount();

    const regional = render(
      <ProfileHero
        entry={createEntryFixture({ geo_specificity: "regional", type: "organization" })}
      />,
    );
    expect(screen.getByText(/Active regionally/)).toBeInTheDocument();
    regional.unmount();

    render(
      <ProfileHero
        entry={createEntryFixture({ geo_specificity: "local", type: "organization" })}
      />,
    );
    expect(screen.getByText(/Active locally/)).toBeInTheDocument();
  });

  it("adds the affiliation to a person's subtitle without a reach claim", () => {
    render(
      <ProfileHero
        affiliation={{ href: "/profiles/organizations/prairie-coop", name: "Prairie Coop" }}
        entry={createEntryFixture()}
      />,
    );

    expect(screen.getByText(/Prairie Coop/)).toBeInTheDocument();
    expect(screen.queryByText(/Active /)).not.toBeInTheDocument();
  });

  it("omits the description clause when the record has none", () => {
    render(<ProfileHero entry={createEntryFixture({ description: undefined })} />);
    expect(screen.queryByText("Community organizer focused on housing.")).not.toBeInTheDocument();
    expect(screen.getByText("Community organizer")).toBeInTheDocument();
  });
});
