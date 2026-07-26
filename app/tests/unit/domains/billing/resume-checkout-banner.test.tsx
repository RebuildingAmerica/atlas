// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

import { ResumeCheckoutBanner } from "@/domains/billing/components/resume-checkout-banner";
import { rememberPendingCheckout } from "@/domains/billing/pending-checkout";

describe("ResumeCheckoutBanner", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders when a pending checkout exists and the product is not yet active", () => {
    rememberPendingCheckout({ product: "atlas_team", interval: "monthly" });
    render(<ResumeCheckoutBanner activeProducts={[]} />);
    expect(screen.getByText(/Resume checkout/i)).toBeInTheDocument();
  });

  it("self-clears once the product activates in the shell state", () => {
    rememberPendingCheckout({ product: "atlas_team", interval: "monthly" });
    render(<ResumeCheckoutBanner activeProducts={["atlas_team"]} />);
    expect(screen.queryByText(/Resume checkout/i)).not.toBeInTheDocument();
    expect(window.localStorage.getItem("atlas:pending-checkout")).toBeNull();
  });

  it("dismiss button hides the banner and clears the record", () => {
    rememberPendingCheckout({ product: "atlas_pro", interval: "monthly" });
    render(<ResumeCheckoutBanner activeProducts={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/i }));
    expect(screen.queryByText(/Resume checkout/i)).not.toBeInTheDocument();
    expect(window.localStorage.getItem("atlas:pending-checkout")).toBeNull();
  });

  it("renders nothing when no pending checkout exists", () => {
    const { container } = render(<ResumeCheckoutBanner activeProducts={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it("treats omitted active products as no active products", () => {
    rememberPendingCheckout({ product: "atlas_team", interval: "monthly" });
    render(<ResumeCheckoutBanner />);
    expect(screen.getByText(/Resume checkout/i)).toBeInTheDocument();
  });
});
