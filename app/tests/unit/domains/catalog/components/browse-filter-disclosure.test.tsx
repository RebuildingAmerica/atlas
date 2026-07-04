// @vitest-environment jsdom

import type { ReactNode } from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Building2, Tags, Users } from "lucide-react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterDisclosure } from "@/domains/catalog/components/browse/browse-page-sections";

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
    expect(housingButton.querySelector("svg.lucide-users")).toBeInTheDocument();
    expect(housingButton.querySelector("svg.lucide-check")).toBeInTheDocument();
    expect(laborButton.querySelector("svg.lucide-building2")).toBeInTheDocument();
    expect(laborButton.querySelector("svg.lucide-check")).not.toBeInTheDocument();

    fireEvent.click(housingButton);
    expect(onHousingClick).toHaveBeenCalledOnce();
  });
});
