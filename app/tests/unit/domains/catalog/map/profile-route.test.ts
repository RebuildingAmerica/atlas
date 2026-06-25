import { describe, expect, it } from "vitest";
import { profileRouteFor } from "@/domains/catalog/map/profile-route";

describe("profileRouteFor", () => {
  it("routes an organization to its organization profile", () => {
    const route = profileRouteFor("organization", "acme-housing");
    expect(route).toEqual({
      to: "/profiles/organizations/$slug",
      params: { slug: "acme-housing" },
    });
  });

  it("routes a person to their people profile", () => {
    const route = profileRouteFor("person", "jane-doe");
    expect(route).toEqual({ to: "/profiles/people/$slug", params: { slug: "jane-doe" } });
  });

  it("has no canonical profile for an actor without a slug", () => {
    expect(profileRouteFor("person", null)).toBeNull();
    expect(profileRouteFor("organization", null)).toBeNull();
  });

  it("has no canonical profile for types Atlas does not render a profile page for", () => {
    expect(profileRouteFor("initiative", "clean-air-now")).toBeNull();
    expect(profileRouteFor("campaign", "vote-2026")).toBeNull();
    expect(profileRouteFor("event", "town-hall")).toBeNull();
  });
});
