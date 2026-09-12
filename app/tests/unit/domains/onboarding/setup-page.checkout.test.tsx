// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("hands a workspace-ready purchase to Stripe checkout", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: { activeOrganization: null },
      },
    });
    mocks.ensurePurchaseOnboarding.mockResolvedValue({ id: "pi_pro", workspaceId: "org_1" });
    mocks.startPurchaseCheckout.mockReturnValue(new Promise(() => undefined));

    render(<SetupPage product="atlas_pro" interval="monthly" />);

    fireEvent.click(await screen.findByRole("button", { name: "Continue to Stripe" }));

    expect(await screen.findByRole("button", { name: "Opening Stripe..." })).toBeDisabled();
    expect(mocks.startPurchaseCheckout).toHaveBeenCalledWith({ data: { purchaseId: "pi_pro" } });
    expect(assign).not.toHaveBeenCalled();
  });

  it("sends the visitor to the Stripe session it was given", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: { activeOrganization: null },
      },
    });
    mocks.ensurePurchaseOnboarding.mockResolvedValue({ id: "pi_pro", workspaceId: "org_1" });
    mocks.startPurchaseCheckout.mockResolvedValue({ url: "https://checkout.stripe.test/cs_123" });

    render(<SetupPage product="atlas_pro" interval="monthly" />);

    fireEvent.click(await screen.findByRole("button", { name: "Continue to Stripe" }));

    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("https://checkout.stripe.test/cs_123");
    });
  });

  it("lets the visitor retry when Stripe checkout cannot be opened", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: { activeOrganization: null },
      },
    });
    mocks.ensurePurchaseOnboarding.mockResolvedValue({ id: "pi_pro", workspaceId: "org_1" });
    mocks.startPurchaseCheckout.mockRejectedValue(new Error("ATLAS_API_REQUEST_FAILED"));

    render(<SetupPage product="atlas_pro" interval="monthly" />);

    fireEvent.click(await screen.findByRole("button", { name: "Continue to Stripe" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Atlas could not open Stripe checkout. Try again.",
    );
    expect(screen.queryByText(/ATLAS_API/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue to Stripe" })).toBeEnabled();
  });

  it("shows why a purchase could not start when the funnel is closed", async () => {
    // /onboarding is reachable by direct link, so the disabled pricing
    // buttons do not gate it. Without surfacing the refusal the buyer sat on
    // a step that never advanced while the rejection went to the console.
    mocks.ensurePurchaseOnboarding.mockRejectedValue(
      new Error("Atlas is not selling subscriptions right now."),
    );
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: { activeOrganization: null },
      },
    });

    render(<SetupPage product="atlas_pro" />);

    expect(
      await screen.findByText("Atlas is not selling subscriptions right now."),
    ).toBeInTheDocument();
  });

  it("hides an internal failure behind a generic message", async () => {
    // A raw server-function message can name environment variables or
    // database state, and this page is reachable by direct link.
    mocks.ensurePurchaseOnboarding.mockRejectedValue(
      new Error("ATLAS_SERVER_API_PROXY_TARGET is required for server-side Atlas API calls."),
    );
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: { activeOrganization: null },
      },
    });

    render(<SetupPage product="atlas_pro" />);

    expect(await screen.findByText("Atlas could not start that purchase.")).toBeInTheDocument();
    expect(screen.queryByText(/ATLAS_SERVER_API_PROXY_TARGET/)).not.toBeInTheDocument();
  });

  it("handles a rejection that is not an Error", async () => {
    mocks.ensurePurchaseOnboarding.mockRejectedValue("boom");
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: { activeOrganization: null },
      },
    });

    render(<SetupPage product="atlas_pro" />);

    expect(await screen.findByText("Atlas could not start that purchase.")).toBeInTheDocument();
  });

  it("does not set state after the page has unmounted", async () => {
    // React warns and leaks when an effect writes state post-unmount, and a
    // buyer who navigated away should not see a refusal for a page they left.
    let rejectPurchase: (reason: unknown) => void = () => undefined;
    mocks.ensurePurchaseOnboarding.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectPurchase = reject;
      }),
    );
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: { activeOrganization: null },
      },
    });

    const view = render(<SetupPage product="atlas_pro" />);
    view.unmount();
    rejectPurchase(new Error("Atlas is not selling subscriptions right now."));
    await waitFor(() => {
      expect(mocks.ensurePurchaseOnboarding).toHaveBeenCalled();
    });

    expect(screen.queryByText("Atlas is not selling subscriptions right now.")).toBeNull();
  });
});
