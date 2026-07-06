// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PricingPlansGridHarness } from "../../../helpers/billing/pricing-plans-grid-harness";

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

describe("PricingPlansGrid", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders plan prices without invalid paragraph nesting", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(<PricingPlansGridHarness />);

    expect(consoleError).not.toHaveBeenCalled();
  });

  it("exposes the selected billing interval while updating visible prices", async () => {
    const user = userEvent.setup();
    render(<PricingPlansGridHarness />);

    const billingGroup = screen.getByRole("group", { name: "Billing interval" });
    const monthlyButton = within(billingGroup).getByRole("button", { name: "Monthly" });
    const annualButton = within(billingGroup).getByRole("button", { name: /Annual/ });

    expect(monthlyButton).toHaveAttribute("aria-pressed", "true");
    expect(annualButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("/month")).toBeInTheDocument();

    await user.click(annualButton);

    expect(monthlyButton).toHaveAttribute("aria-pressed", "false");
    expect(annualButton).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("/year")).toBeInTheDocument();
    expect(screen.getByText("$4/month, billed annually")).toBeInTheDocument();
  });
});
