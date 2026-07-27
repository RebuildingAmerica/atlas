// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readRouterMocks, resetRouterMocks } from "@/../tests/helpers/router-harness";
import {
  createAtlasSessionFixture,
  createAtlasWorkspace,
} from "@/../tests/fixtures/access/sessions";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  useAtlasSession: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  useAtlasSession: mocks.useAtlasSession,
}));

vi.mock("@rebuildingamerica/atlas-ui/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("@rebuildingamerica/atlas-ui/ui/confirm-dialog", () => ({
  useConfirmDialog: () => ({ confirm: mocks.confirm }),
}));

import { PricingPage } from "@/domains/billing/pages/public/pricing-page";

describe("PricingPage start handoff", () => {
  beforeEach(() => {
    mocks.confirm.mockReset();
    mocks.useAtlasSession.mockReset();
    resetRouterMocks();
    mocks.useAtlasSession.mockReturnValue({ data: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("routes anonymous Team buyers to purchase onboarding", async () => {
    const user = userEvent.setup();
    render(<PricingPage />);

    await user.click(screen.getByRole("button", { name: "Get Atlas Team" }));

    expect(readRouterMocks().navigate).toHaveBeenCalledWith({
      to: "/onboarding",
      search: { interval: "monthly", product: "atlas_team" },
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("routes signed-in but incomplete Pro buyers to purchase onboarding", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: false,
        hasPasskey: false,
        workspace: { activeOrganization: null },
      },
    });
    const user = userEvent.setup();
    render(<PricingPage />);

    await user.click(screen.getByRole("button", { name: "Get Atlas Pro" }));

    expect(readRouterMocks().navigate).toHaveBeenCalledWith({
      to: "/onboarding",
      search: { interval: "monthly", product: "atlas_pro" },
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("resumes the checkout an anonymous visitor started before signing in", () => {
    mocks.useAtlasSession.mockReturnValue({ data: createAtlasSessionFixture() });

    render(<PricingPage intent="atlas_pro" interval="yearly" />);

    expect(readRouterMocks().navigate).toHaveBeenCalledWith({
      to: "/onboarding",
      search: { interval: "yearly", product: "atlas_pro" },
    });
  });

  it("does not resume anything when only half the handoff survived the redirect", () => {
    render(<PricingPage intent="atlas_pro" />);

    expect(readRouterMocks().navigate).not.toHaveBeenCalled();
  });

  it("does not resume anything on a plain visit to the pricing page", () => {
    render(<PricingPage />);

    expect(readRouterMocks().navigate).not.toHaveBeenCalled();
  });

  it("sends a signed-in visitor to their workspace from the free plan", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: createAtlasSessionFixture({
        workspace: createAtlasWorkspace({
          activeOrganization: {
            id: "org_desk",
            name: "Research Desk",
            role: "owner",
            slug: "research-desk",
            workspaceType: "team",
          },
        }),
      }),
    });

    render(<PricingPage />);

    expect(screen.getByRole("link", { name: "Open your workspace" })).toHaveAttribute(
      "href",
      "/discovery",
    );
    expect(screen.getByText(/Buying for Research Desk\./)).toBeInTheDocument();
  });

  it("sends an anonymous visitor to the public directory from the free plan", () => {
    render(<PricingPage />);

    expect(screen.getByRole("link", { name: "Browse the Atlas" })).toHaveAttribute(
      "href",
      "/browse",
    );
  });

  it("buys the yearly plans once the visitor switches to annual billing", async () => {
    const user = userEvent.setup();
    render(<PricingPage />);

    await user.click(screen.getByRole("button", { name: /^Annual/ }));
    await user.click(screen.getByRole("button", { name: "Get Atlas Team" }));

    expect(readRouterMocks().navigate).toHaveBeenCalledWith({
      to: "/onboarding",
      search: { interval: "yearly", product: "atlas_team" },
    });
  });

  it("buys the four-month Pro plan once the visitor switches to student billing", async () => {
    const user = userEvent.setup();
    render(<PricingPage />);

    await user.click(screen.getByRole("button", { name: "Student" }));
    await user.click(screen.getByRole("button", { name: "Get Atlas Pro" }));

    expect(readRouterMocks().navigate).toHaveBeenCalledWith({
      to: "/onboarding",
      search: { interval: "four_month", product: "atlas_pro" },
    });
  });

  it("buys the seven-day Research Pass from the tail card", async () => {
    const user = userEvent.setup();
    render(<PricingPage />);

    await user.click(screen.getByRole("button", { name: "Get 7-day pass" }));

    expect(readRouterMocks().navigate).toHaveBeenCalledWith({
      to: "/onboarding",
      search: { interval: "weekly", product: "atlas_research_pass" },
    });
  });

  it("buys the thirty-day Research Pass from the tail card", async () => {
    const user = userEvent.setup();
    render(<PricingPage />);

    await user.click(screen.getByRole("button", { name: "Get 30-day pass" }));

    expect(readRouterMocks().navigate).toHaveBeenCalledWith({
      to: "/onboarding",
      search: { interval: "once", product: "atlas_research_pass" },
    });
  });
  it("keeps monthly billing selected when the visitor switches back to it", async () => {
    const user = userEvent.setup();
    render(<PricingPage />);

    await user.click(screen.getByRole("button", { name: /^Annual/ }));
    await user.click(screen.getByRole("button", { name: "Monthly" }));
    await user.click(screen.getByRole("button", { name: "Get Atlas Team" }));

    expect(readRouterMocks().navigate).toHaveBeenCalledWith({
      to: "/onboarding",
      search: { interval: "monthly", product: "atlas_team" },
    });
  });
});
