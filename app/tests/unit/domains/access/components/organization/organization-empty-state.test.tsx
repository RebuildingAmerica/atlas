// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OrganizationEmptyState } from "@/domains/access/components/organization/organization-empty-state";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

describe("OrganizationEmptyState", () => {
  it("renders the empty state message", () => {
    render(<OrganizationEmptyState />);
    expect(screen.getByText(/No active workspace/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Discovery/i })).toHaveAttribute("href", "/discovery");
  });
});
