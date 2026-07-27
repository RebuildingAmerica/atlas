// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import {
  CompanionSpotlight,
  ProfileEntryLink,
  ProfileMeta,
  SectionHeading,
  ShelfCard,
  buildScopeCopy,
  entryTypeLabel,
  formatFreshness,
  formatLocation,
  getInitials,
} from "@/domains/catalog/components/profiles/profile-showcase-primitives";
import { createEntryFixture } from "../../../../fixtures/catalog/entries";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("profile showcase primitives", () => {
  it("frames profile overviews as source-linked research records rather than directories", () => {
    expect(buildScopeCopy("people").description).toContain(
      "Source-linked records for people working across public record, place, and issue.",
    );
    expect(buildScopeCopy("people").description).not.toMatch(/directory|surfaced/i);

    expect(buildScopeCopy("organizations").description).toContain(
      "Source-linked records for organizations grounded in local reporting, public records, and research context.",
    );
    expect(buildScopeCopy("organizations").description).not.toMatch(/directory|surfaced/i);

    expect(buildScopeCopy("all").description).toContain(
      "Explore source-linked people and organizations by issue, place, and public record.",
    );
    expect(buildScopeCopy("all").description).not.toMatch(/Wander|surfaced/i);
  });
});

describe("formatLocation", () => {
  it("prefers city and state together", () => {
    expect(formatLocation(createEntryFixture({ city: "Jackson", state: "MS" }))).toBe(
      "Jackson, MS",
    );
  });

  it("falls back to the region when the city is unknown", () => {
    expect(formatLocation(createEntryFixture({ city: undefined, region: "Gulf Coast" }))).toBe(
      "Gulf Coast",
    );
  });

  it("uses the bare state when there is no city or region", () => {
    expect(
      formatLocation(createEntryFixture({ city: undefined, region: undefined, state: "MS" })),
    ).toBe("MS");
  });

  it("says so plainly when the record carries no place at all", () => {
    expect(
      formatLocation(createEntryFixture({ city: undefined, region: undefined, state: undefined })),
    ).toBe("Location not specified");
  });
});

describe("formatFreshness", () => {
  it("renders a calendar day as a readable date without shifting it", () => {
    expect(formatFreshness("2026-02-01")).toBe("Feb 1, 2026");
  });

  it("returns nothing when the record has no source date", () => {
    expect(formatFreshness(undefined)).toBeNull();
  });

  it("echoes text that is not a date rather than dropping the fact", () => {
    expect(formatFreshness("not-a-date")).toBe("not-a-date");
  });
});

describe("getInitials", () => {
  it("takes the first letter of the first two words", () => {
    expect(getInitials("jane maria doe")).toBe("JM");
  });

  it("handles a single-word name", () => {
    expect(getInitials("Prairie")).toBe("P");
  });

  it("falls back to a placeholder when the name is blank", () => {
    expect(getInitials("   ")).toBe("A");
  });
});

describe("entryTypeLabel", () => {
  it("labels people and organizations in plain words", () => {
    expect(entryTypeLabel(createEntryFixture({ type: "person" }))).toBe("Person");
    expect(entryTypeLabel(createEntryFixture({ type: "organization" }))).toBe("Organization");
  });

  it("humanizes any other entry type", () => {
    expect(entryTypeLabel(createEntryFixture({ type: "initiative" }))).toBe("Initiative");
  });
});

describe("ProfileEntryLink", () => {
  it("sends a visitor to the person profile when the record has a slug", () => {
    render(
      <ProfileEntryLink entry={createEntryFixture({ slug: "jane-doe-a3f2", type: "person" })}>
        Jane Doe
      </ProfileEntryLink>,
    );
    expect(screen.getByRole("link", { name: "Jane Doe" })).toHaveAttribute(
      "href",
      "/profiles/people/jane-doe-a3f2",
    );
  });

  it("sends a visitor to the organization profile when the record has a slug", () => {
    render(
      <ProfileEntryLink
        entry={createEntryFixture({
          name: "Prairie Coop",
          slug: "prairie-coop-b1c2",
          type: "organization",
        })}
      >
        Prairie Coop
      </ProfileEntryLink>,
    );
    expect(screen.getByRole("link", { name: "Prairie Coop" })).toHaveAttribute(
      "href",
      "/profiles/organizations/prairie-coop-b1c2",
    );
  });

  it("falls back to the entry id route for a slugless record", () => {
    render(
      <ProfileEntryLink entry={createEntryFixture({ id: "entry-77", slug: undefined })}>
        Jane Doe
      </ProfileEntryLink>,
    );
    expect(screen.getByRole("link", { name: "Jane Doe" })).toHaveAttribute(
      "href",
      "/entries/entry-77",
    );
  });

  it("routes an entry type without a profile page to the entry id route", () => {
    render(
      <ProfileEntryLink
        entry={createEntryFixture({ id: "entry-88", slug: "a-drive-c3", type: "campaign" })}
      >
        A Drive
      </ProfileEntryLink>,
    );
    expect(screen.getByRole("link", { name: "A Drive" })).toHaveAttribute(
      "href",
      "/entries/entry-88",
    );
  });

  it("passes its class through so callers keep their card styling", () => {
    render(
      <ProfileEntryLink className="group block" entry={createEntryFixture()}>
        Jane Doe
      </ProfileEntryLink>,
    );
    expect(screen.getByRole("link", { name: "Jane Doe" })).toHaveClass("group", "block");
  });
});

describe("ProfileMeta", () => {
  it("shows the entry type and the issue areas a reader can recognize", () => {
    render(
      <ProfileMeta
        entry={createEntryFixture({ issue_areas: ["housing_affordability", "public_health"] })}
        issueAreaLabels={{ housing_affordability: "Housing Affordability" }}
      />,
    );
    expect(screen.getByText("Person")).toBeInTheDocument();
    expect(screen.getByText("Housing Affordability")).toBeInTheDocument();
    expect(screen.getByText("Public Health")).toBeInTheDocument();
  });

  it("omits the verified badge for an unverified record", () => {
    render(<ProfileMeta entry={createEntryFixture({ verified: false })} issueAreaLabels={{}} />);
    expect(screen.queryByText("Verified")).not.toBeInTheDocument();
  });

  it("marks a verified record", () => {
    render(<ProfileMeta entry={createEntryFixture({ verified: true })} issueAreaLabels={{}} />);
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("caps the issue areas it shows at the requested number", () => {
    render(
      <ProfileMeta
        entry={createEntryFixture({ issue_areas: ["housing", "labor", "climate"] })}
        issueAreaLabels={{}}
        maxIssues={1}
      />,
    );
    expect(screen.getByText("Housing")).toBeInTheDocument();
    expect(screen.queryByText("Labor")).not.toBeInTheDocument();
    expect(screen.queryByText("Climate")).not.toBeInTheDocument();
  });
});

describe("SectionHeading", () => {
  it("renders the title as a heading with the given subtitle", () => {
    render(<SectionHeading subtitle="Spotlight" title="Profiles worth opening" />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Profiles worth opening" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Spotlight")).toBeInTheDocument();
  });

  it("names the surface when the caller supplies no subtitle", () => {
    render(<SectionHeading title="New in Atlas" />);
    expect(screen.getByText("Atlas profiles")).toBeInTheDocument();
  });

  it("renders a caller-supplied icon alongside the subtitle", () => {
    render(<SectionHeading icon={<svg data-testid="heading-icon" />} title="People" />);
    expect(screen.getByTestId("heading-icon")).toBeInTheDocument();
  });
});

describe("ShelfCard", () => {
  it("summarizes the record and links to its profile", () => {
    render(
      <ShelfCard
        entry={createEntryFixture({ latest_source_date: "2026-02-01", source_count: 3 })}
        issueAreaLabels={{ housing_affordability: "Housing Affordability" }}
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/profiles/people/jane-doe-a3f2");
    expect(within(link).getByRole("heading", { level: 3, name: "Jane Doe" })).toBeInTheDocument();
    expect(within(link).getByText("Jackson, MS")).toBeInTheDocument();
    expect(within(link).getByText("Community organizer focused on housing.")).toBeInTheDocument();
    expect(within(link).getByText("JD")).toBeInTheDocument();
    expect(within(link).getByText("3 sources")).toBeInTheDocument();
    expect(within(link).getByText("Updated Feb 1, 2026")).toBeInTheDocument();
    expect(within(link).getByText("Housing Affordability")).toBeInTheDocument();
  });

  it("leaves out the freshness line when no source date is on file", () => {
    render(<ShelfCard entry={createEntryFixture()} issueAreaLabels={{}} />);
    expect(screen.queryByText(/^Updated /)).not.toBeInTheDocument();
  });
});

describe("CompanionSpotlight", () => {
  it("leads with the hero photo, type and place, and links to the profile", () => {
    const { container } = render(
      <CompanionSpotlight
        entry={createEntryFixture({ photo_url: "https://img.test/jane.jpg" })}
        issueAreaLabels={{ housing_affordability: "Housing Affordability" }}
      />,
    );

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/profiles/people/jane-doe-a3f2");
    // Decorative art: empty alt keeps it out of the accessibility tree.
    expect(container.querySelector("img")).toHaveAttribute("src", "https://img.test/jane.jpg");
    expect(within(link).getByRole("heading", { level: 3, name: "Jane Doe" })).toBeInTheDocument();
    expect(within(link).getByText("Jackson, MS")).toBeInTheDocument();
    expect(within(link).getByText("Community organizer focused on housing.")).toBeInTheDocument();
    expect(within(link).getByText("Housing Affordability")).toBeInTheDocument();
  });

  it("falls back to initials artwork when the record has no photo", () => {
    const { container } = render(
      <CompanionSpotlight
        entry={createEntryFixture({ name: "Prairie Coop", type: "organization" })}
        issueAreaLabels={{}}
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("PC")).toBeInTheDocument();
    // Once as the eyebrow above the name, once as the type badge in the meta row.
    expect(screen.getAllByText("Organization")).toHaveLength(2);
  });
});
