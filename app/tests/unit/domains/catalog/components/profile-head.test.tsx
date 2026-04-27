// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ProfileJsonLd } from "@/domains/catalog/components/profiles/profile-head";
import type { Entry } from "@/types";

const mockPerson: Entry = {
  id: "test-id",
  type: "person",
  name: "Jane Doe",
  description: "Community organizer focused on housing",
  city: "Kansas City",
  state: "MO",
  slug: "jane-doe-a3f2",
  geo_specificity: "local",
  first_seen: "2026-01-01",
  last_seen: "2026-04-01",
  issue_areas: ["housing", "labor"],
  source_count: 5,
  source_types: [],
  active: true,
  verified: true,
  claim: { status: "unclaimed", verification_level: "atlas-verified" },
  created_at: "2026-01-01",
  updated_at: "2026-04-01",
};

/** Extract and parse the JSON-LD script content from a rendered container. */
function parseJsonLd(container: HTMLElement): Record<string, unknown> {
  const script = container.querySelector('script[type="application/ld+json"]');
  expect(script).not.toBeNull();
  const text = script?.textContent ?? "";
  return JSON.parse(text) as Record<string, unknown>;
}

describe("ProfileJsonLd", () => {
  it("renders Person schema for person entries", () => {
    const { container } = render(<ProfileJsonLd entry={mockPerson} />);
    const data = parseJsonLd(container);
    expect(data["@type"]).toBe("Person");
    expect(data.name).toBe("Jane Doe");
    expect(data.areaServed).toEqual({ "@type": "Place", name: "Kansas City, MO" });
    expect(data.knowsAbout).toContain("housing");
  });

  it("renders Organization schema for org entries", () => {
    const orgEntry: Entry = { ...mockPerson, type: "organization", slug: "prairie-coop-b1c2" };
    const { container } = render(<ProfileJsonLd entry={orgEntry} />);
    const data = parseJsonLd(container);
    expect(data["@type"]).toBe("Organization");
  });

  it("includes memberOf when affiliated org is provided", () => {
    const affiliatedOrg: Entry = {
      ...mockPerson,
      id: "org-id",
      type: "organization",
      name: "Prairie Workers Cooperative",
      slug: "prairie-workers-a1b2",
    };
    const { container } = render(
      <ProfileJsonLd entry={mockPerson} affiliatedOrg={affiliatedOrg} />,
    );
    const data = parseJsonLd(container);
    expect(data.memberOf).toBeDefined();
    expect(data.memberOf).toEqual(expect.objectContaining({ name: "Prairie Workers Cooperative" }));
  });

  it("includes sameAs for social media URLs", () => {
    const entryWithSocial: Entry = {
      ...mockPerson,
      social_media: {
        twitter: "https://twitter.com/janedoe",
        linkedin: "https://linkedin.com/in/janedoe",
      },
    };
    const { container } = render(<ProfileJsonLd entry={entryWithSocial} />);
    const data = parseJsonLd(container);
    expect(data.sameAs).toEqual(
      expect.arrayContaining(["https://twitter.com/janedoe", "https://linkedin.com/in/janedoe"]),
    );
  });

  it("omits areaServed when location is missing", () => {
    const noLocationEntry: Entry = { ...mockPerson, city: undefined, state: undefined };
    const { container } = render(<ProfileJsonLd entry={noLocationEntry} />);
    const data = parseJsonLd(container);
    expect(data.areaServed).toBeUndefined();
  });
});
