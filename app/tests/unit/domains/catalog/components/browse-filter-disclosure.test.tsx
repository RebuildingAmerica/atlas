// @vitest-environment jsdom

import type { ReactNode } from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Building2, Tags, Users } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BrowseSearchBox,
  FilterDisclosure,
  GridSurface,
  ListSurface,
} from "@/domains/catalog/components/browse/browse-page-sections";

vi.mock("@headlessui/react", () => ({
  Popover: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  PopoverButton: ({ children, className }: { children: ReactNode; className?: string }) => (
    <button type="button" className={className}>
      {children}
    </button>
  ),
  PopoverPanel: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

afterEach(cleanup);

describe("FilterDisclosure", () => {
  it("gives the browse search box a durable accessible name", () => {
    const onSearch = vi.fn();

    render(<BrowseSearchBox initialQuery="" onSearch={onSearch} />);

    const input = screen.getByRole("textbox", {
      name: "Search people and groups by issue, place, or name",
    });
    const form = input.closest("form");
    if (!form) {
      throw new Error("Expected browse search form");
    }

    fireEvent.change(input, { target: { value: "tenant union" } });
    fireEvent.submit(form);

    expect(onSearch).toHaveBeenCalledWith("tenant union");
  });

  it("renders category icons, option icons, and active checks without changing click behavior", () => {
    const onHousingClick = vi.fn();
    const onLaborClick = vi.fn();

    render(
      <FilterDisclosure
        label="Issues"
        count={1}
        icon={Tags}
        items={[
          {
            active: true,
            icon: Users,
            key: "housing",
            label: "Housing",
            onClick: onHousingClick,
          },
          {
            active: false,
            icon: Building2,
            key: "labor",
            label: "Labor",
            onClick: onLaborClick,
          },
        ]}
      />,
    );

    const issuesButton = screen.getByRole("button", { name: /Issues/ });
    const housingButton = screen.getByRole("button", { name: "Housing" });
    const laborButton = screen.getByRole("button", { name: "Labor" });

    expect(issuesButton.querySelector("svg.lucide-tags")).toBeInTheDocument();
    expect(housingButton).toHaveAttribute("aria-pressed", "true");
    expect(laborButton).toHaveAttribute("aria-pressed", "false");
    expect(housingButton.querySelector("svg.lucide-users")).toBeInTheDocument();
    expect(housingButton.querySelector("svg.lucide-check")).toBeInTheDocument();
    expect(laborButton.querySelector("svg.lucide-building2")).toBeInTheDocument();
    expect(laborButton.querySelector("svg.lucide-check")).not.toBeInTheDocument();

    fireEvent.click(housingButton);
    expect(onHousingClick).toHaveBeenCalledOnce();
  });

  it("exposes selected state buttons on grid and list browse surfaces", () => {
    const states = [
      { count: 10, intensity: 0.9, state: "MO" },
      { count: 5, intensity: 0.5, state: "CA" },
    ];

    const { unmount } = render(
      <GridSurface states={states} selectedState="MO" onSelectState={vi.fn()} />,
    );

    expect(screen.getByRole("button", { name: "Missouri 10 matching records" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "California 5 matching records" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    unmount();

    render(<ListSurface states={states} selectedState="CA" onSelectState={vi.fn()} />);

    expect(screen.getByRole("button", { name: "01 Missouri MO 10 records" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "02 California CA 5 records" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});
