// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { renderWithProviders as render } from "@/../tests/helpers/render-with-providers";
import userEvent from "@testing-library/user-event";
import { readRouterMocks, resetRouterMocks } from "@/../tests/helpers/router-harness";
import {
  createAtlasSessionFixture,
  createAtlasWorkspace,
} from "@/../tests/fixtures/access/sessions";

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  paidAccess: vi.fn(),
  loadCheckoutAvailability: vi.fn(),
  useAtlasSession: vi.fn(),
}));

vi.mock("@/domains/waitlist/waitlist.functions", () => ({ loadPaidAccess: mocks.paidAccess }));
vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/billing/purchase-onboarding.functions", () => ({
  loadCheckoutAvailability: mocks.loadCheckoutAvailability,
}));

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  useAtlasSession: mocks.useAtlasSession,
}));

vi.mock("@rebuildingamerica/atlas-ui/layout/page-layout", () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock("@rebuildingamerica/atlas-ui/ui/confirm-dialog", () => ({
  ConfirmDialogProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useConfirmDialog: () => ({ confirm: mocks.confirm }),
}));

import { PricingPage } from "@/domains/billing/pages/public/pricing-page";

describe("PricingPage start handoff", () => {
  beforeEach(() => {
    mocks.paidAccess.mockResolvedValue({ mode: "open", requests: [], admittedProducts: [] });
    mocks.confirm.mockReset();
    mocks.useAtlasSession.mockReset();
    resetRouterMocks();
    mocks.loadCheckoutAvailability.mockReset();
    mocks.loadCheckoutAvailability.mockResolvedValue({
      available: true,
      reason: null,
      allowedOffers: [
        "atlas_pro:monthly",
        "atlas_pro:yearly",
        "atlas_pro:four_month",
        "atlas_team:monthly",
        "atlas_team:yearly",
        "atlas_research_pass:weekly",
        "atlas_research_pass:once",
      ],
    });
    mocks.useAtlasSession.mockReturnValue({ data: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("routes anonymous Team buyers to purchase onboarding", async () => {
    const user = userEvent.setup();
    render(<PricingPage />);

    await user.click(await screen.findByRole("button", { name: "Get Atlas Team" }));

    expect(readRouterMocks().navigate).toHaveBeenCalledWith({
      to: "/onboarding",
      search: { interval: "monthly", product: "atlas_team" },
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it("routes signed-in but incomplete Pro buyers to purchase onboarding", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: createAtlasSessionFixture({ accountReady: false, hasPasskey: false }),
    });
    const user = userEvent.setup();
    render(<PricingPage />);

    await user.click(await screen.findByRole("button", { name: "Get Atlas Pro" }));

    expect(readRouterMocks().navigate).toHaveBeenCalledWith({
      to: "/onboarding",
      search: { interval: "monthly", product: "atlas_pro" },
    });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });
  it("resumes the checkout an anonymous visitor started before signing in", async () => {
    mocks.useAtlasSession.mockReturnValue({ data: createAtlasSessionFixture() });

    render(<PricingPage intent="atlas_pro" interval="yearly" />);

    // Resume waits for the availability probe to confirm the funnel is open.
    await waitFor(() => {
      expect(readRouterMocks().navigate).toHaveBeenCalledWith({
        to: "/onboarding",
        search: { interval: "yearly", product: "atlas_pro" },
      });
    });
  });

  it("keeps unapproved offers inert while another offer is available", async () => {
    mocks.loadCheckoutAvailability.mockResolvedValue({
      available: true,
      reason: null,
      allowedOffers: ["atlas_pro:monthly"],
    });
    const user = userEvent.setup();
    render(<PricingPage intent="atlas_team" interval="monthly" />);

    await screen.findByRole("button", { name: "Get Atlas Pro" });
    const unavailableButtons = screen.getAllByRole("button", { name: "Temporarily unavailable" });
    expect(unavailableButtons).toHaveLength(3);
    for (const button of unavailableButtons) {
      expect(button).toBeDisabled();
      await user.click(button);
    }
    expect(readRouterMocks().navigate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Get Atlas Pro" }));
    expect(readRouterMocks().navigate).toHaveBeenCalledWith({
      to: "/onboarding",
      search: { interval: "monthly", product: "atlas_pro" },
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
    await user.click(await screen.findByRole("button", { name: "Get Atlas Team" }));

    expect(readRouterMocks().navigate).toHaveBeenCalledWith({
      to: "/onboarding",
      search: { interval: "yearly", product: "atlas_team" },
    });
  });

  it("buys the four-month Pro plan once the visitor switches to student billing", async () => {
    const user = userEvent.setup();
    render(<PricingPage />);

    await user.click(screen.getByRole("button", { name: "Student" }));
    await user.click(await screen.findByRole("button", { name: "Get Atlas Pro" }));

    expect(readRouterMocks().navigate).toHaveBeenCalledWith({
      to: "/onboarding",
      search: { interval: "four_month", product: "atlas_pro" },
    });
  });

  it("buys the seven-day Research Pass from the tail card", async () => {
    const user = userEvent.setup();
    render(<PricingPage />);

    await user.click(await screen.findByRole("button", { name: "Get 7-day pass" }));

    expect(readRouterMocks().navigate).toHaveBeenCalledWith({
      to: "/onboarding",
      search: { interval: "weekly", product: "atlas_research_pass" },
    });
  });

  it("buys the thirty-day Research Pass from the tail card", async () => {
    const user = userEvent.setup();
    render(<PricingPage />);

    await user.click(await screen.findByRole("button", { name: "Get 30-day pass" }));

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
    await user.click(await screen.findByRole("button", { name: "Get Atlas Team" }));

    expect(readRouterMocks().navigate).toHaveBeenCalledWith({
      to: "/onboarding",
      search: { interval: "monthly", product: "atlas_team" },
    });
  });
  describe("when checkout is unavailable", () => {
    beforeEach(() => {
      mocks.loadCheckoutAvailability.mockResolvedValue({
        available: false,
        reason: "catalog_unavailable",
        allowedOffers: [],
      });
    });

    it("explains that paid plans are paused", async () => {
      render(<PricingPage />);

      expect(await screen.findByText("Paid plans are temporarily unavailable")).toBeInTheDocument();
    });

    it("makes every paid call to action inert", async () => {
      render(<PricingPage />);

      await screen.findByText("Paid plans are temporarily unavailable");

      const inert = screen.getAllByRole("button", { name: "Temporarily unavailable" });
      expect(inert.length).toBe(4);
      for (const button of inert) {
        expect(button).toBeDisabled();
      }
    });

    it("does not route a click to purchase onboarding", async () => {
      const user = userEvent.setup();
      render(<PricingPage />);

      await screen.findByText("Paid plans are temporarily unavailable");
      for (const button of screen.getAllByRole("button", { name: "Temporarily unavailable" })) {
        await user.click(button);
      }

      expect(readRouterMocks().navigate).not.toHaveBeenCalled();
    });

    it("does not auto-resume a checkout the visitor was bounced out of", async () => {
      render(<PricingPage intent="atlas_pro" interval="yearly" />);

      await screen.findByText("Paid plans are temporarily unavailable");

      expect(readRouterMocks().navigate).not.toHaveBeenCalled();
    });
  });
  it("treats a failed availability probe as unavailable", async () => {
    mocks.loadCheckoutAvailability.mockRejectedValue(new Error("probe exploded"));

    render(<PricingPage intent="atlas_pro" interval="yearly" />);

    // The dangerous alternative is live buttons plus a silently dropped
    // intent on exactly the deployment whose server functions will refuse.
    expect(await screen.findByText("Paid plans are temporarily unavailable")).toBeInTheDocument();
    expect(readRouterMocks().navigate).not.toHaveBeenCalled();
  });
  it("routes a visitor to the waitlist while preserving the selected plan and interval", async () => {
    mocks.paidAccess.mockResolvedValue({ mode: "waitlist", requests: [], admittedProducts: [] });
    mocks.loadCheckoutAvailability.mockResolvedValue({ available: false, allowedOffers: [] });
    render(<PricingPage />);
    const [join] = await screen.findAllByRole("button", { name: "Join waitlist" });
    if (!join) throw new Error("Expected join button");
    await userEvent.click(join);
    expect(readRouterMocks().navigate).toHaveBeenCalledWith({
      to: "/waitlist",
      search: { product: "atlas_pro", interval: "monthly" },
    });
  });
  it("routes confirmed applicants to their private request", async () => {
    mocks.paidAccess.mockResolvedValue({
      mode: "waitlist",
      requests: [{ id: "private", product: "atlas_pro" }],
      admittedProducts: [],
    });
    render(<PricingPage />);
    await userEvent.click(await screen.findByRole("button", { name: "View waitlist request" }));
    expect(readRouterMocks().navigate).toHaveBeenCalledWith({
      to: "/waitlist/request/$id",
      params: { id: "private" },
    });
  });
  it.each(["join", "request", "account"])("resumes a saved intent into %s", async (action) => {
    mocks.paidAccess.mockResolvedValue({
      mode: "waitlist",
      requests: action === "request" ? [{ id: "private", product: "atlas_pro" }] : [],
      admittedProducts: [],
    });
    if (action === "account")
      mocks.useAtlasSession.mockReturnValue({
        data: createAtlasSessionFixture({
          workspace: { ...createAtlasSessionFixture().workspace, activeProducts: ["atlas_pro"] },
        }),
      });
    render(<PricingPage intent="atlas_pro" interval="yearly" />);
    await waitFor(() => {
      expect(readRouterMocks().navigate).toHaveBeenCalledWith(
        expect.objectContaining({
          to:
            action === "join"
              ? "/waitlist"
              : action === "request"
                ? "/waitlist/request/$id"
                : "/account",
        }),
      );
    });
  });
  it("recovers a failed admission probe without enabling purchases", async () => {
    mocks.paidAccess
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ mode: "waitlist", requests: [], admittedProducts: [] });
    render(<PricingPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Try again" }));
    expect(await screen.findAllByRole("button", { name: "Join waitlist" })).toHaveLength(4);
  });

  it("takes an existing paid customer directly to plan management", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: createAtlasSessionFixture({
        workspace: { ...createAtlasSessionFixture().workspace, activeProducts: ["atlas_pro"] },
      }),
    });
    render(<PricingPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Manage plan" }));
    expect(readRouterMocks().navigate).toHaveBeenCalledWith({ to: "/account" });
  });
  it("waits for the customer session before resuming an intent when admission arrives first", async () => {
    mocks.paidAccess.mockResolvedValue({ mode: "waitlist", requests: [], admittedProducts: [] });
    mocks.useAtlasSession.mockReturnValue({ data: undefined });
    const view = render(<PricingPage intent="atlas_pro" interval="monthly" />);
    await screen.findByText(
      "Paid plans are available by invitation. Joining the waitlist costs nothing.",
    );
    expect(readRouterMocks().navigate).not.toHaveBeenCalled();
    mocks.useAtlasSession.mockReturnValue({
      data: createAtlasSessionFixture({
        workspace: { ...createAtlasSessionFixture().workspace, activeProducts: ["atlas_pro"] },
      }),
    });
    view.rerender(
      <QueryClientProvider client={view.queryClient}>
        <PricingPage intent="atlas_pro" interval="monthly" />
      </QueryClientProvider>,
    );
    await waitFor(() => {
      expect(readRouterMocks().navigate).toHaveBeenCalledWith({ to: "/account" });
    });
  });

  it("keeps a failed account query recoverable without resuming paid signup", async () => {
    const refetch = vi.fn(() => Promise.resolve());
    mocks.useAtlasSession.mockReturnValue({ data: undefined, isError: true, refetch });
    render(<PricingPage intent="atlas_pro" interval="monthly" />);
    await userEvent.click(screen.getByRole("button", { name: "Retry account" }));
    expect(refetch).toHaveBeenCalled();
    expect(readRouterMocks().navigate).not.toHaveBeenCalled();
  });
});
