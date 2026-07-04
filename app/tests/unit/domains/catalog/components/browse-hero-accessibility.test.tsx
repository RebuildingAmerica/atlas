// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowseHero } from "@/domains/catalog/components/browse/browse-hero";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { "aria-current"?: "page"; children: ReactNode; to: string }) => (
    <a href={props.to} aria-current={props["aria-current"]}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

describe("BrowseHero accessibility", () => {
  it("marks the active profile scope tab as the current page", () => {
    render(
      <BrowseHero
        eyebrow="Discover"
        title="Browse people and groups"
        description="Find people and organizations working on civic issues."
        scopeTabs={[
          { label: "All", to: "/profiles" },
          { label: "People", to: "/profiles/people", isActive: true },
          { label: "Organizations", to: "/profiles/organizations" },
        ]}
      />,
    );

    expect(screen.getByRole("link", { name: "People" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "All" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Organizations" })).not.toHaveAttribute("aria-current");
  });
});
