// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { OrganizationEmptyState } from "@/domains/access/components/organization/organization-empty-state";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("OrganizationEmptyState", () => {
  it("renders the empty state message", () => {
    render(<OrganizationEmptyState />);
    expect(screen.getByText(/No active workspace/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Research/i })).toHaveAttribute("href", "/discovery");
  });
});
