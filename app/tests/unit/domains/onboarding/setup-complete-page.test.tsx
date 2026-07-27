// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import {
  purchaseOnboardingIntentQueryKey,
  purchaseOnboardingIntentQueryOptions,
  SetupCompletePage,
} from "@/domains/onboarding/pages/setup-complete-page";
import type { PurchaseIntentRecord } from "@/domains/billing/server/purchase-intents";
import { renderWithProviders } from "../../../helpers/render-with-providers";

const mocks = vi.hoisted(() => ({
  loadPurchaseOnboarding: vi.fn(),
  useAtlasSession: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  atlasSessionQueryKey: ["atlas-session"],
  useAtlasSession: mocks.useAtlasSession,
}));

vi.mock("@/domains/billing/purchase-onboarding.functions", () => ({
  loadPurchaseOnboarding: mocks.loadPurchaseOnboarding,
}));

describe("SetupCompletePage", () => {
  function intent(overrides: Partial<PurchaseIntentRecord> = {}): PurchaseIntentRecord {
    return {
      id: "pi_team",
      interval: "monthly",
      product: "atlas_team",
      status: "checkout_created",
      stripeCheckoutSessionId: "cs_123",
      userId: "user_123",
      workspaceId: "org_team",
      ...overrides,
    } as PurchaseIntentRecord;
  }

  function seedIntent(record: PurchaseIntentRecord | null) {
    return (queryClient: QueryClient) => {
      queryClient.setQueryData([...purchaseOnboardingIntentQueryKey, "pi_team"], record);
    };
  }

  function signedInWorkspace(activeProducts: string[], activeOrganizationId: string | null) {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        workspace: {
          activeOrganization: activeOrganizationId ? { id: activeOrganizationId } : null,
          activeProducts,
        },
      },
    });
  }

  beforeEach(() => {
    mocks.loadPurchaseOnboarding.mockResolvedValue(intent());
    signedInWorkspace([], "org_other");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads the purchase intent the completion link names", async () => {
    const record = intent({ status: "paid" });
    mocks.loadPurchaseOnboarding.mockResolvedValue(record);

    const options = purchaseOnboardingIntentQueryOptions("pi_team");

    expect(options.queryKey).toEqual(["onboarding", "purchase-intent", "pi_team"]);
    const queryFn = options.queryFn as () => Promise<unknown>;
    await expect(queryFn()).resolves.toBe(record);
    expect(mocks.loadPurchaseOnboarding).toHaveBeenCalledWith({ data: { purchaseId: "pi_team" } });
  });

  it("keeps waiting when a different product is the one already active", () => {
    signedInWorkspace(["atlas_pro"], "org_team");

    renderWithProviders(<SetupCompletePage purchase="pi_team" />, { seed: seedIntent(intent()) });

    expect(screen.getByText("Finishing setup")).toBeInTheDocument();
    expect(screen.getByText("Stripe has not confirmed this payment yet.")).toBeInTheDocument();
    expect(screen.queryByText("Your team workspace is ready.")).not.toBeInTheDocument();
  });

  it("keeps waiting while the session itself is still loading", () => {
    mocks.useAtlasSession.mockReturnValue({ data: undefined });

    renderWithProviders(<SetupCompletePage purchase="pi_team" />, { seed: seedIntent(intent()) });

    expect(screen.getByText("Finishing setup")).toBeInTheDocument();
  });

  it("offers SSO setup once a paid team workspace is ready", () => {
    renderWithProviders(<SetupCompletePage purchase="pi_team" />, {
      seed: seedIntent(intent({ status: "paid" })),
    });

    expect(screen.getByText("Your team workspace is ready.")).toBeInTheDocument();
    expect(
      screen.getByText("Invite teammates or connect SSO when you are ready."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up SSO" })).toHaveAttribute(
      "href",
      "/organization/sso",
    );
    expect(screen.getByRole("link", { name: "Open workspace" })).toHaveAttribute(
      "href",
      "/discovery",
    );
  });

  it("thanks an individual backer without offering team-only setup", () => {
    signedInWorkspace(["atlas_pro"], "org_team");

    renderWithProviders(<SetupCompletePage purchase="pi_team" />, {
      seed: seedIntent(intent({ product: "atlas_pro", status: "checkout_created" })),
    });

    expect(screen.getByText("Thanks for backing Atlas.")).toBeInTheDocument();
    expect(screen.getByText("Your workspace is ready.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Set up SSO" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open workspace" })).toBeInTheDocument();
  });

  it("keeps re-checking Stripe and offers a way out once the wait runs long", async () => {
    vi.useFakeTimers();

    const { queryClient } = renderWithProviders(<SetupCompletePage purchase="pi_team" />, {
      seed: seedIntent(intent()),
    });
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(mocks.loadPurchaseOnboarding).toHaveBeenCalledWith({ data: { purchaseId: "pi_team" } });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["atlas-session"] });
    expect(screen.getByText("Finishing setup")).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });

    expect(screen.getByText("Almost there")).toBeInTheDocument();
    expect(
      screen.getByText("Payment succeeded, but access has not appeared yet. Refresh in a moment."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to payment" })).toHaveAttribute(
      "href",
      "/onboarding?purchase=pi_team&step=payment",
    );
    expect(mocks.loadPurchaseOnboarding.mock.calls.length).toBeGreaterThan(1);
  });

  it("reloads the page when the buyer asks to refresh", async () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });

    renderWithProviders(<SetupCompletePage purchase="pi_team" />, { seed: seedIntent(intent()) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(32_000);
    });

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(reload).toHaveBeenCalledOnce();
  });

  it("stops polling the moment the workspace has the product", async () => {
    vi.useFakeTimers();
    signedInWorkspace(["atlas_team"], "org_team");

    renderWithProviders(<SetupCompletePage purchase="pi_team" />, { seed: seedIntent(intent()) });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(32_000);
    });

    expect(screen.getByText("Your team workspace is ready.")).toBeInTheDocument();
    // Only the mount load -- nothing rescheduled a poll behind the ready state.
    expect(mocks.loadPurchaseOnboarding).toHaveBeenCalledTimes(1);
  });

  it("does not claim payment succeeded when the completion link has no purchase", async () => {
    renderWithProviders(<SetupCompletePage />);

    expect(screen.getByText("Payment link unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/Payment succeeded/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View pricing" })).toHaveAttribute("href", "/pricing");
    await waitFor(() => {
      expect(mocks.loadPurchaseOnboarding).not.toHaveBeenCalled();
    });
  });
});
