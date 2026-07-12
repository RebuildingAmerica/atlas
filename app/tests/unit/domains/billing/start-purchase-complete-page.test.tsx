// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { StartPurchaseCompletePage } from "@/domains/billing/pages/auth/start-purchase-complete-page";

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  loadPurchaseOnboarding: vi.fn(),
  useAtlasSession: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
  }: {
    children: ReactNode;
    search?: Record<string, unknown>;
    to: string;
  }) => <a href={to}>{children}</a>,
}));

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  atlasSessionQueryKey: ["atlas-session"],
  useAtlasSession: mocks.useAtlasSession,
}));

vi.mock("@/domains/billing/purchase-onboarding.functions", () => ({
  loadPurchaseOnboarding: mocks.loadPurchaseOnboarding,
}));

describe("StartPurchaseCompletePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does not mark the purchase complete just because another product is active", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: { id: "org_team" },
          activeProducts: ["atlas_pro"],
        },
      },
    });
    mocks.loadPurchaseOnboarding.mockResolvedValue({
      id: "pi_team",
      interval: "monthly",
      product: "atlas_team",
      status: "checkout_created",
      stripeCheckoutSessionId: "cs_123",
      userId: "user_123",
      workspaceId: "org_team",
    });

    render(<StartPurchaseCompletePage purchase="pi_team" />);

    await waitFor(() => {
      expect(mocks.loadPurchaseOnboarding).toHaveBeenCalledWith({
        data: { purchaseId: "pi_team" },
      });
    });
    expect(screen.getByText("Finishing setup")).toBeInTheDocument();
    expect(screen.queryByText("Your team workspace is ready.")).not.toBeInTheDocument();
  });

  it("refreshes the purchase intent while waiting for Stripe completion", async () => {
    vi.useFakeTimers();
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: { id: "org_other" },
          activeProducts: [],
        },
      },
    });
    mocks.loadPurchaseOnboarding
      .mockResolvedValueOnce({
        id: "pi_team",
        interval: "monthly",
        product: "atlas_team",
        status: "checkout_created",
        stripeCheckoutSessionId: "cs_123",
        userId: "user_123",
        workspaceId: "org_team",
      })
      .mockResolvedValueOnce({
        id: "pi_team",
        interval: "monthly",
        product: "atlas_team",
        status: "paid",
        stripeCheckoutSessionId: "cs_123",
        userId: "user_123",
        workspaceId: "org_team",
      });

    render(<StartPurchaseCompletePage purchase="pi_team" />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(mocks.loadPurchaseOnboarding).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.loadPurchaseOnboarding).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Your team workspace is ready.")).toBeInTheDocument();
  });

  it("does not claim payment succeeded when the completion link has no purchase", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: null,
          activeProducts: [],
        },
      },
    });

    render(<StartPurchaseCompletePage />);

    expect(screen.getByText("Payment link unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/Payment succeeded/)).not.toBeInTheDocument();
    expect(mocks.loadPurchaseOnboarding).not.toHaveBeenCalled();
  });
});
