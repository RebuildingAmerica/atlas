// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OrganizationPageHeader } from "@/domains/access/components/organization/organization-page-header";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

describe("OrganizationPageHeader", () => {
  it("renders labels and title", () => {
    render(
      <OrganizationPageHeader
        label="Header Label"
        title="Header Title"
        description="Header Description"
      />,
    );
    expect(screen.getByText("Header Label")).toBeInTheDocument();
    expect(screen.getByText("Header Title")).toBeInTheDocument();
    expect(screen.getByText("Header Description")).toBeInTheDocument();
  });

  it("renders navigation links when provided", () => {
    const links = [
      { label: "Link 1", to: "/organization" as const },
      { label: "Link 2", to: "/organization/sso" as const },
    ];
    render(<OrganizationPageHeader label="L" title="T" description="D" links={links} />);
    expect(screen.getByRole("link", { name: "Link 1" })).toHaveAttribute("href", "/organization");
    expect(screen.getByRole("link", { name: "Link 2" })).toHaveAttribute(
      "href",
      "/organization/sso",
    );
  });
});
