// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

import { BrowseHero } from "@/domains/catalog/components/browse/browse-hero";

describe("BrowseHero", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the eyebrow, title, and description without tabs", () => {
    render(
      <BrowseHero
        eyebrow="Discover"
        title="Browse civic actors"
        description="Find people and organizations working on civic issues."
      />,
    );
    expect(screen.getByText("Discover")).toBeInTheDocument();
    expect(screen.getByText("Browse civic actors")).toBeInTheDocument();
    expect(screen.getByText(/Find people and organizations/)).toBeInTheDocument();
  });

  it("renders the scope tab pills when provided and highlights the active one", () => {
    render(
      <BrowseHero
        eyebrow="Discover"
        title="Browse civic actors"
        description="Description"
        scopeTabs={[
          { label: "All", to: "/profiles", isActive: true },
          { label: "People", to: "/profiles/people" },
          { label: "Organizations", to: "/profiles/organizations" },
        ]}
      />,
    );
    expect(screen.getByText("All")).toBeInTheDocument();
    expect(screen.getByText("People")).toBeInTheDocument();
    expect(screen.getByText("Organizations")).toBeInTheDocument();
  });

  it("renders no tab pills when the scopeTabs array is empty", () => {
    const { container } = render(
      <BrowseHero eyebrow="Discover" title="Browse" description="No tabs" scopeTabs={[]} />,
    );
    expect(container.querySelectorAll("a").length).toBe(0);
  });
});
