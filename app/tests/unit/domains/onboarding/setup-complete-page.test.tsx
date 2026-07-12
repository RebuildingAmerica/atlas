// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  purchaseOnboardingIntentQueryOptions,
  SetupCompletePage,
} from "@/domains/onboarding/pages/setup-complete-page";

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  loadPurchaseOnboarding: vi.fn(),
  queryOptions: vi.fn((options: unknown) => options),
  useAtlasSession: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  queryOptions: mocks.queryOptions,
  useQuery: mocks.useQuery,
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

describe("SetupCompletePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryOptions.mockClear();
    mocks.useQuery.mockReturnValue({ data: null, refetch: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("builds reusable query options for purchase completion", async () => {
    const intent = {
      id: "pi_team",
      interval: "monthly",
      product: "atlas_team",
      status: "paid",
      stripeCheckoutSessionId: "cs_123",
      userId: "user_123",
      workspaceId: "org_team",
    };
    mocks.loadPurchaseOnboarding.mockResolvedValue(intent);

    const options = purchaseOnboardingIntentQueryOptions("pi_team");

    expect(mocks.queryOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        queryKey: ["onboarding", "purchase-intent", "pi_team"],
      }),
    );
    const queryFn = options.queryFn as () => Promise<unknown>;
    await expect(queryFn()).resolves.toBe(intent);
    expect(mocks.loadPurchaseOnboarding).toHaveBeenCalledWith({
      data: { purchaseId: "pi_team" },
    });
  });

  it("does not mark the purchase complete just because another product is active", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: { id: "org_team" },
          activeProducts: ["atlas_pro"],
        },
      },
    });
    mocks.useQuery.mockReturnValue({
      data: {
        id: "pi_team",
        product: "atlas_team",
        status: "checkout_created",
        workspaceId: "org_team",
      },
      refetch: vi.fn(),
    });

    render(<SetupCompletePage purchase="pi_team" />);

    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true,
        queryKey: ["onboarding", "purchase-intent", "pi_team"],
      }),
    );
    expect(screen.getByText("Finishing setup")).toBeInTheDocument();
    expect(screen.queryByText("Your team workspace is ready.")).not.toBeInTheDocument();
  });

  it("refreshes the purchase intent while waiting for Stripe completion", async () => {
    vi.useFakeTimers();
    const refetch = vi.fn().mockResolvedValue({});
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: { id: "org_other" },
          activeProducts: [],
        },
      },
    });
    mocks.useQuery.mockReturnValue({
      data: {
        id: "pi_team",
        product: "atlas_team",
        status: "checkout_created",
        workspaceId: "org_team",
      },
      refetch,
    });

    render(<SetupCompletePage purchase="pi_team" />);

    await act(async () => {
      vi.advanceTimersByTime(1500);
      await Promise.resolve();
    });

    expect(refetch).toHaveBeenCalledTimes(1);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["atlas-session"] });
  });

  it("shows the ready state when the purchase query is paid", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: { id: "org_other" },
          activeProducts: [],
        },
      },
    });
    mocks.useQuery.mockReturnValue({
      data: {
        id: "pi_team",
        product: "atlas_team",
        status: "paid",
        workspaceId: "org_team",
      },
      refetch: vi.fn(),
    });

    render(<SetupCompletePage purchase="pi_team" />);

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

    render(<SetupCompletePage />);

    expect(screen.getByText("Payment link unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/Payment succeeded/)).not.toBeInTheDocument();
    expect(mocks.loadPurchaseOnboarding).not.toHaveBeenCalled();
    expect(mocks.useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false,
        queryKey: ["onboarding", "purchase-intent", ""],
      }),
    );
  });
});
