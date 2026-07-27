// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  ProfilesEmptyState,
  ProfilesShowcaseHeader,
} from "@/domains/catalog/components/profiles/profile-showcase";

describe("ProfilesShowcaseHeader", () => {
  it("matches its heading to the people scope", () => {
    render(<ProfilesShowcaseHeader scope="people" />);
    expect(screen.getByRole("heading", { level: 1, name: "People" })).toBeInTheDocument();
    expect(screen.getByText(/Source-linked records for people/)).toBeInTheDocument();
  });

  it("matches its heading to the organizations scope", () => {
    render(<ProfilesShowcaseHeader scope="organizations" />);
    expect(screen.getByRole("heading", { level: 1, name: "Organizations" })).toBeInTheDocument();
    expect(screen.getByText(/Source-linked records for organizations/)).toBeInTheDocument();
  });

  it("falls back to the combined heading for the all scope", () => {
    render(<ProfilesShowcaseHeader scope="all" />);
    expect(screen.getByRole("heading", { level: 1, name: "Profiles" })).toBeInTheDocument();
  });
});

describe("ProfilesEmptyState", () => {
  it("names what is missing for each scope", () => {
    const { unmount } = render(<ProfilesEmptyState scope="people" />);
    expect(
      screen.getByRole("heading", { level: 2, name: "No people listed yet." }),
    ).toBeInTheDocument();
    unmount();

    const organizations = render(<ProfilesEmptyState scope="organizations" />);
    expect(
      screen.getByRole("heading", { level: 2, name: "No organizations listed yet." }),
    ).toBeInTheDocument();
    organizations.unmount();

    render(<ProfilesEmptyState scope="all" />);
    expect(
      screen.getByRole("heading", { level: 2, name: "No profiles listed yet." }),
    ).toBeInTheDocument();
  });
});
