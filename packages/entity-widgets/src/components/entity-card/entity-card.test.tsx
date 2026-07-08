import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { EntityCard } from "./entity-card";
import type { EntityCardData } from "./entity-card";

afterEach(() => {
  cleanup();
});

const FULL_DATA: EntityCardData = {
  id: "entity-1",
  name: "Jane Doe",
  type: "person",
  description:
    "A civic organizer working on housing policy across central Ohio.",
  photo_url: "https://example.com/jane.jpg",
  place_label: "Columbus, OH",
  trust_level: "atlas_verified",
  source_count: 3,
  profile_url: "https://atlas.rebuildingus.org/profiles/people/jane-doe-a1b2",
};

const MINIMAL_DATA: EntityCardData = {
  id: "entity-2",
  name: "Acme Housing Collective",
  type: "organization",
  description: null,
  photo_url: null,
  place_label: null,
  trust_level: "unverified",
  source_count: 1,
  profile_url: null,
};

describe("EntityCard", () => {
  it("renders a photo, full subtitle, description, and profile link when all fields are present", () => {
    const { container } = render(<EntityCard data={FULL_DATA} />);

    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    expect(screen.getByText("Person · Columbus, OH")).toBeInTheDocument();

    // The photo is decorative (its `alt=""` keeps it out of the accessible
    // role tree since the name is already rendered as visible text), so it's
    // queried directly rather than via `getByRole("img")`.
    const photo = container.querySelector("img");
    expect(photo).toHaveAttribute("src", FULL_DATA.photo_url);

    expect(
      screen.getByText(
        "A civic organizer working on housing policy across central Ohio.",
      ),
    ).toBeInTheDocument();

    const link = screen.getByRole("link", {
      name: "View full profile on Atlas →",
    });
    expect(link).toHaveAttribute("href", FULL_DATA.profile_url);

    // Trust badge row is delegated to TrustBadgeRow; just confirm it rendered.
    expect(screen.getByText("✓ Atlas-verified")).toBeInTheDocument();
    expect(screen.getByText("3 sources")).toBeInTheDocument();
  });

  it("renders a placeholder avatar, type-only subtitle, no description, and no dead link when fields are missing", () => {
    const { container } = render(<EntityCard data={MINIMAL_DATA} />);

    expect(screen.getByText("Acme Housing Collective")).toBeInTheDocument();
    expect(screen.getByText("Organization")).toBeInTheDocument();
    expect(screen.queryByText(/Organization ·/)).not.toBeInTheDocument();

    // First-letter placeholder avatar instead of an <img>.
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();

    expect(screen.queryByRole("link")).not.toBeInTheDocument();

    expect(screen.getByText("1 source")).toBeInTheDocument();
    expect(screen.getByText("Unverified")).toBeInTheDocument();
  });
});
