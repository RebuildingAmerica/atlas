// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  useAtlasSession: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  useAtlasSession: mocks.useAtlasSession,
}));

import { ResumeCheckoutBanner } from "@/domains/billing/components/resume-checkout-banner";
import { rememberPendingCheckout } from "@/domains/billing/pending-checkout";

describe("ResumeCheckoutBanner", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mocks.useAtlasSession.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders when a pending checkout exists and the product is not yet active", () => {
    rememberPendingCheckout({ product: "atlas_team", interval: "monthly" });
    mocks.useAtlasSession.mockReturnValue({
      data: { workspace: { activeProducts: [] } },
    });
    render(<ResumeCheckoutBanner />);
    expect(screen.getByText(/Resume checkout/i)).toBeInTheDocument();
  });

  it("self-clears once the product activates on the session", () => {
    rememberPendingCheckout({ product: "atlas_team", interval: "monthly" });
    mocks.useAtlasSession.mockReturnValue({
      data: { workspace: { activeProducts: ["atlas_team"] } },
    });
    render(<ResumeCheckoutBanner />);
    expect(screen.queryByText(/Resume checkout/i)).not.toBeInTheDocument();
    expect(window.localStorage.getItem("atlas:pending-checkout")).toBeNull();
  });

  it("dismiss button hides the banner and clears the record", () => {
    rememberPendingCheckout({ product: "atlas_pro", interval: "monthly" });
    mocks.useAtlasSession.mockReturnValue({
      data: { workspace: { activeProducts: [] } },
    });
    render(<ResumeCheckoutBanner />);
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/i }));
    expect(screen.queryByText(/Resume checkout/i)).not.toBeInTheDocument();
    expect(window.localStorage.getItem("atlas:pending-checkout")).toBeNull();
  });

  it("renders nothing when no pending checkout exists", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: { workspace: { activeProducts: [] } },
    });
    const { container } = render(<ResumeCheckoutBanner />);
    expect(container.firstChild).toBeNull();
  });
});
