// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ProfileIdentBar } from "@/domains/catalog/components/profiles/profile-ident-bar";
import { createEntryFixture } from "../../../../fixtures/catalog/entries";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("ProfileIdentBar", () => {
  it("walks a person back through the catalog to the people index", () => {
    render(<ProfileIdentBar entry={createEntryFixture()} />);

    const breadcrumb = screen.getByRole("navigation", { name: "Catalog breadcrumb" });
    expect(within(breadcrumb).getByRole("link", { name: "PROFILES" })).toHaveAttribute(
      "href",
      "/profiles",
    );
    expect(within(breadcrumb).getByRole("link", { name: "PEOPLE" })).toHaveAttribute(
      "href",
      "/profiles/people",
    );
  });

  it("walks an organization back to the organizations index", () => {
    render(<ProfileIdentBar entry={createEntryFixture({ type: "organization" })} />);

    const breadcrumb = screen.getByRole("navigation", { name: "Catalog breadcrumb" });
    expect(within(breadcrumb).getByRole("link", { name: "ORGANIZATIONS" })).toHaveAttribute(
      "href",
      "/profiles/organizations",
    );
    expect(within(breadcrumb).queryByRole("link", { name: "PEOPLE" })).not.toBeInTheDocument();
  });

  it("marks the place as the current step of the breadcrumb", () => {
    render(<ProfileIdentBar entry={createEntryFixture({ city: "Jackson", state: "MS" })} />);
    const current = screen.getByText("JACKSON, MS");
    expect(current).toHaveAttribute("aria-current", "page");
  });

  it("names the state alone when the record has no city", () => {
    render(<ProfileIdentBar entry={createEntryFixture({ city: undefined, state: "MS" })} />);
    expect(screen.getByText("MS")).toBeInTheDocument();
  });

  it("names the region when neither city nor state is known", () => {
    render(
      <ProfileIdentBar
        entry={createEntryFixture({ city: undefined, region: "Gulf Coast", state: undefined })}
      />,
    );
    expect(screen.getByText("GULF COAST")).toBeInTheDocument();
  });

  it("falls back to the country when the record carries no place", () => {
    render(
      <ProfileIdentBar
        entry={createEntryFixture({ city: undefined, region: undefined, state: undefined })}
      />,
    );
    expect(screen.getByText("UNITED STATES")).toBeInTheDocument();
  });

  it("stamps the tracking month from the first sighting", () => {
    render(<ProfileIdentBar entry={createEntryFixture({ first_seen: "2024-03-15T00:00:00Z" })} />);
    expect(screen.getByText("Tracked since 2024-03")).toBeInTheDocument();
  });

  it("echoes an unparseable first sighting rather than inventing a date", () => {
    render(<ProfileIdentBar entry={createEntryFixture({ first_seen: "unknown" })} />);
    expect(screen.getByText("Tracked since unknown")).toBeInTheDocument();
  });
});
