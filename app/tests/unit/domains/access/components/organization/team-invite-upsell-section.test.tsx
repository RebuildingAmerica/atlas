// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TeamInviteUpsellSection } from "@/domains/access/components/organization/team-invite-upsell-section";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("TeamInviteUpsellSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("explains the subscription requirement", () => {
    render(<TeamInviteUpsellSection />);
    expect(
      screen.getByText(/Subscribe to Atlas Team to invite members to this workspace/i),
    ).toBeInTheDocument();
  });

  it("links to the pricing page", () => {
    render(<TeamInviteUpsellSection />);
    expect(screen.getByRole("link", { name: /Subscribe to Atlas Team/i })).toHaveAttribute(
      "href",
      "/pricing",
    );
  });
});
