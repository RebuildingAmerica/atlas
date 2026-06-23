// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { ProfileJsonLd } from "@/domains/catalog/components/profiles/profile-head";
import type { Entry } from "@/types";

describe("ProfileJsonLd", () => {
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
    trust: {
      level: "atlas_verified",
      independent_source_count: null,
      website_grounded: null,
      email_grounded: null,
    },
    created_at: "2026-01-01",
    updated_at: "2026-04-01",
  };

  function parseJsonLd(container: HTMLElement): Record<string, unknown> {
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    const text = script?.textContent ?? "";
    return JSON.parse(text) as Record<string, unknown>;
  }

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

  it("includes member entries when affiliated people are provided to an organization", () => {
    const orgEntry: Entry = {
      ...mockPerson,
      type: "organization",
      slug: "prairie-coop-b1c2",
      issue_areas: [],
    };
    const member: Entry = { ...mockPerson, name: "Member Person", slug: "member-1" };
    const { container } = render(<ProfileJsonLd entry={orgEntry} affiliatedPeople={[member]} />);
    const data = parseJsonLd(container);
    const memberArr = data.member as { name: string; url: string }[];
    expect(memberArr).toHaveLength(1);
    expect(memberArr[0]?.name).toBe("Member Person");
  });

  it("omits the member field when affiliated people are absent or empty", () => {
    const orgEntry: Entry = {
      ...mockPerson,
      type: "organization",
      slug: "prairie-coop-b1c2",
      city: undefined,
      state: undefined,
      issue_areas: [],
    };
    const { container } = render(<ProfileJsonLd entry={orgEntry} affiliatedPeople={[]} />);
    const data = parseJsonLd(container);
    expect(data.member).toBeUndefined();
    expect(data.areaServed).toBeUndefined();
    expect(data.knowsAbout).toBeUndefined();
  });

  it("includes social URLs in sameAs for organizations", () => {
    const orgEntry: Entry = {
      ...mockPerson,
      type: "organization",
      slug: "prairie-coop-b1c2",
      social_media: { homepage: "https://example.org" },
    };
    const { container } = render(<ProfileJsonLd entry={orgEntry} />);
    const data = parseJsonLd(container);
    expect(data.sameAs).toEqual(["https://example.org"]);
  });

  it("filters out non-string and non-http values from social_media", () => {
    const entryWithMixed: Entry = {
      ...mockPerson,
      social_media: {
        twitter: "https://twitter.com/x",
        spam: "ftp://example.org",
      },
    };
    const { container } = render(<ProfileJsonLd entry={entryWithMixed} />);
    const data = parseJsonLd(container);
    expect(data.sameAs).toEqual(["https://twitter.com/x"]);
  });

  it("omits the affiliated organization block when not supplied", () => {
    const { container } = render(<ProfileJsonLd entry={{ ...mockPerson, issue_areas: [] }} />);
    const data = parseJsonLd(container);
    expect(data.memberOf).toBeUndefined();
    expect(data.knowsAbout).toBeUndefined();
  });
});
