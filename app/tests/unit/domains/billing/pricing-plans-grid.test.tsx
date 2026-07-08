// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PricingComparisonTable } from "@/domains/billing/pages/public/components/pricing-comparison-table";
import { PricingResearchPassCard } from "@/domains/billing/pages/public/components/pricing-tail-cards";
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

  it("exposes student four-month checkout as a separate individual billing step", async () => {
    const user = userEvent.setup();
    render(<PricingPlansGridHarness />);

    const billingGroup = screen.getByRole("group", { name: "Billing interval" });
    await user.click(within(billingGroup).getByRole("button", { name: /Student/ }));

    expect(screen.getByRole("button", { name: /Student/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("$12.80")).toBeInTheDocument();
    expect(screen.getByText(/paid every 4 months/i)).toBeInTheDocument();
  });

  it("advertises Team SCIM without advertising Slack", () => {
    render(<PricingPlansGridHarness />);

    expect(screen.getByText(/SSO \(SAML\/OIDC\) and SCIM/)).toBeInTheDocument();
    expect(screen.queryByText(/Slack/i)).not.toBeInTheDocument();
  });

  it("compares the Team API quota and SCIM access", () => {
    render(<PricingComparisonTable />);

    expect(screen.getByText("10,000 / day key")).toBeInTheDocument();
    expect(screen.getByText("Single Sign-On and SCIM")).toBeInTheDocument();
    expect(screen.queryByText(/Slack/i)).not.toBeInTheDocument();
  });

  it("offers both Research Pass durations as checkout actions", async () => {
    const user = userEvent.setup();
    const onPurchase = vi.fn();

    render(<PricingResearchPassCard pendingCheckoutKey={null} onPurchase={onPurchase} />);

    expect(screen.getByText(/Team-level quotas for one person/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Get 7-day pass" }));
    await user.click(screen.getByRole("button", { name: "Get 30-day pass" }));

    expect(onPurchase).toHaveBeenNthCalledWith(1, "weekly");
    expect(onPurchase).toHaveBeenNthCalledWith(2, "once");
  });
});
