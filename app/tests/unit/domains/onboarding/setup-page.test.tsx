// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { SetupPage } from "@/domains/onboarding/pages/setup-page";

const mocks = vi.hoisted(() => ({
  attachPurchaseWorkspace: vi.fn(),
  createWorkspace: vi.fn(),
  ensurePurchaseOnboarding: vi.fn(),
  loadPurchaseOnboarding: vi.fn(),
  startPurchaseCheckout: vi.fn(),
  useAtlasSession: vi.fn(),
}));

vi.mock("@tanstack/react-router", async () => {
  const harness = await import("@/../tests/helpers/router-harness");
  return harness.installRouterMocks();
});

vi.mock("@/domains/access/client/use-atlas-session", () => ({
  useAtlasSession: mocks.useAtlasSession,
}));

vi.mock("@/domains/access", () => ({
  AccountSetupPage: () => <div data-testid="account-setup-page" />,
}));

vi.mock("@/domains/access/organizations.functions", () => ({
  createWorkspace: mocks.createWorkspace,
}));

vi.mock("@/domains/billing/purchase-onboarding.functions", () => ({
  attachPurchaseWorkspace: mocks.attachPurchaseWorkspace,
  ensurePurchaseOnboarding: mocks.ensurePurchaseOnboarding,
  // Real implementation: the point of these tests is which messages it
  // lets through.
  isCheckoutRefusalMessage: (message: string) =>
    message === "Atlas is not selling subscriptions right now.",
  loadPurchaseOnboarding: mocks.loadPurchaseOnboarding,
  startPurchaseCheckout: mocks.startPurchaseCheckout,
}));

describe("SetupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensurePurchaseOnboarding.mockResolvedValue({ id: "pi_123" });
    mocks.loadPurchaseOnboarding.mockResolvedValue(null);
  });

  afterEach(() => {
    cleanup();
  });

  it("defaults Research Pass purchases to the one-time billing interval", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: false,
        hasPasskey: false,
        workspace: { activeOrganization: null, memberships: [] },
      },
    });

    render(<SetupPage product="atlas_research_pass" />);

    expect(screen.getByRole("heading", { name: "Secure your account" })).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.ensurePurchaseOnboarding).toHaveBeenCalledWith({
        data: { product: "atlas_research_pass", interval: "once" },
      });
    });
  });

  it("rejects invalid product and interval pairs before creating a purchase intent", () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: { activeOrganization: null, memberships: [] },
      },
    });

    render(<SetupPage product="atlas_team" interval="weekly" />);

    expect(screen.getByText("Choose a billing option")).toBeInTheDocument();
    expect(
      screen.getByText("That billing interval is not available for Atlas Team."),
    ).toBeInTheDocument();
    expect(mocks.ensurePurchaseOnboarding).not.toHaveBeenCalled();
  });

  it("does not resume a checkout-created purchase as workspace setup", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: { activeOrganization: null, memberships: [] },
      },
    });
    mocks.loadPurchaseOnboarding.mockResolvedValue({
      id: "pi_pro",
      interval: "yearly",
      product: "atlas_pro",
      status: "checkout_created",
      stripeCheckoutSessionId: "cs_123",
      userId: "user_123",
      workspaceId: "org_personal",
    });

    render(<SetupPage purchase="pi_pro" step="payment" />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Purchase unavailable" })).toBeInTheDocument();
    });
    expect(mocks.loadPurchaseOnboarding).toHaveBeenCalledWith({ data: { purchaseId: "pi_pro" } });
    expect(mocks.ensurePurchaseOnboarding).not.toHaveBeenCalled();
  });

  it("does not skip workspace setup from a step param without a workspace-backed purchase", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: { activeOrganization: null, memberships: [] },
      },
    });

    render(<SetupPage product="atlas_team" interval="monthly" step="payment" />);

    expect(await screen.findByLabelText(/Workspace name/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Workspace slug/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Stripe will handle/)).not.toBeInTheDocument();
  });

  it.each([
    {
      product: "atlas_pro",
      interval: "monthly",
      label: "Atlas Pro",
      redirect: "%2Fonboarding%3Fproduct%3Datlas_pro%26interval%3Dmonthly",
    },
    {
      product: "atlas_team",
      interval: "yearly",
      label: "Atlas Team",
      redirect: "%2Fonboarding%3Fproduct%3Datlas_team%26interval%3Dyearly",
    },
    {
      product: "atlas_research_pass",
      interval: "once",
      label: "Atlas Research Pass",
      redirect: "%2Fonboarding%3Fproduct%3Datlas_research_pass%26interval%3Donce",
    },
  ] as const)(
    "shows $label at the anonymous account step and retains its selection",
    ({ product, interval, label, redirect }) => {
      mocks.useAtlasSession.mockReturnValue({ data: null });

      render(<SetupPage product={product} interval={interval} />);

      expect(screen.getByRole("heading", { name: "Start with your account" })).toBeInTheDocument();
      expect(screen.getByText(label, { exact: true })).toBeVisible();
      expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute(
        "href",
        `/sign-up?redirect=${redirect}`,
      );
      expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
        "href",
        `/sign-in?redirect=${redirect}`,
      );
      expect(mocks.ensurePurchaseOnboarding).not.toHaveBeenCalled();
    },
  );

  it("says the purchase link is unavailable when the lookup fails", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: { activeOrganization: null, memberships: [] },
      },
    });
    mocks.loadPurchaseOnboarding.mockRejectedValue(new Error("ATLAS_API_REQUEST_FAILED"));

    render(<SetupPage purchase="pi_broken" />);

    expect(
      await screen.findByRole("heading", { name: "Purchase unavailable" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ATLAS_API/)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View pricing" })).toHaveAttribute("href", "/pricing");
  });

  it("drops a purchase lookup that lands after the visitor leaves", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: { activeOrganization: null, memberships: [] },
      },
    });
    let resolveLookup: (value: unknown) => void = () => undefined;
    mocks.loadPurchaseOnboarding.mockReturnValue(
      new Promise((resolve) => {
        resolveLookup = resolve;
      }),
    );

    const view = render(<SetupPage purchase="pi_slow" />);
    await waitFor(() => {
      expect(mocks.loadPurchaseOnboarding).toHaveBeenCalled();
    });
    view.unmount();
    resolveLookup(null);

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Purchase unavailable" }),
      ).not.toBeInTheDocument();
    });
  });

  it("drops a failed purchase lookup that lands after the visitor leaves", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: { activeOrganization: null, memberships: [] },
      },
    });
    let rejectLookup: (reason: Error) => void = () => undefined;
    mocks.loadPurchaseOnboarding.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectLookup = reject;
      }),
    );

    const view = render(<SetupPage purchase="pi_slow" />);
    await waitFor(() => {
      expect(mocks.loadPurchaseOnboarding).toHaveBeenCalled();
    });
    view.unmount();
    rejectLookup(new Error("ATLAS_API_REQUEST_FAILED"));

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Purchase unavailable" }),
      ).not.toBeInTheDocument();
    });
  });

  it("drops a started purchase intent that lands after the visitor leaves", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: { activeOrganization: null, memberships: [] },
      },
    });
    let resolveStart: (value: unknown) => void = () => undefined;
    mocks.ensurePurchaseOnboarding.mockReturnValue(
      new Promise((resolve) => {
        resolveStart = resolve;
      }),
    );

    const view = render(<SetupPage product="atlas_pro" interval="monthly" />);
    await waitFor(() => {
      expect(mocks.ensurePurchaseOnboarding).toHaveBeenCalled();
    });
    view.unmount();
    resolveStart({ id: "pi_pro", workspaceId: "org_1" });

    await waitFor(() => {
      expect(screen.queryByText(/Stripe will handle/)).not.toBeInTheDocument();
    });
  });
});
