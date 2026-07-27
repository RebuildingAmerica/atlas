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
        workspace: { activeOrganization: null },
      },
    });

    render(<SetupPage product="atlas_research_pass" />);

    expect(screen.getByText("Billing: once")).toBeInTheDocument();
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
        workspace: { activeOrganization: null },
      },
    });

    render(<SetupPage product="atlas_team" interval="weekly" />);

    expect(screen.getByText("Choose a billing option")).toBeInTheDocument();
    expect(
      screen.getByText("That billing interval is not available for Atlas Team."),
    ).toBeInTheDocument();
    expect(mocks.ensurePurchaseOnboarding).not.toHaveBeenCalled();
  });

  it("loads purchase intent details so Stripe cancel returns to the selected plan", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: { activeOrganization: null },
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
      expect(screen.getByText("Atlas Pro")).toBeInTheDocument();
    });
    expect(screen.getByText("Billing: yearly")).toBeInTheDocument();
    expect(mocks.ensurePurchaseOnboarding).not.toHaveBeenCalled();
  });

  it("does not skip workspace setup from a step param without a workspace-backed purchase", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: { activeOrganization: null },
      },
    });

    render(<SetupPage product="atlas_team" interval="monthly" step="payment" />);

    expect(await screen.findByLabelText(/Workspace name/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Workspace slug/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Stripe will handle/)).not.toBeInTheDocument();
  });

  it("creates a team workspace from the visible name without asking for a slug", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: { activeOrganization: null },
      },
    });
    mocks.ensurePurchaseOnboarding.mockResolvedValue({
      id: "pi_team",
      interval: "monthly",
      product: "atlas_team",
      status: "started",
      stripeCheckoutSessionId: null,
      userId: "user_123",
      workspaceId: null,
    });
    mocks.createWorkspace.mockResolvedValue({ id: "org_team", slug: "rebuilding-las-vegas" });
    mocks.attachPurchaseWorkspace.mockResolvedValue({
      id: "pi_team",
      interval: "monthly",
      product: "atlas_team",
      status: "workspace_ready",
      stripeCheckoutSessionId: null,
      userId: "user_123",
      workspaceId: "org_team",
    });

    render(<SetupPage product="atlas_team" interval="monthly" />);

    const nameInput = await screen.findByLabelText(/Workspace name/);
    expect(screen.queryByLabelText(/Workspace slug/)).not.toBeInTheDocument();
    fireEvent.change(nameInput, { target: { value: "Rebuilding Las Vegas!" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));

    await waitFor(() => {
      expect(mocks.createWorkspace).toHaveBeenCalledWith({
        data: {
          name: "Rebuilding Las Vegas!",
          slug: "rebuilding-las-vegas",
          workspaceType: "team",
        },
      });
    });
    expect(mocks.attachPurchaseWorkspace).toHaveBeenCalledWith({
      data: { purchaseId: "pi_team", workspaceId: "org_team" },
    });
  });

  it("does not create a workspace when the purchase param cannot be loaded", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: { activeOrganization: null },
      },
    });
    mocks.loadPurchaseOnboarding.mockResolvedValue(null);

    render(<SetupPage purchase="pi_missing" />);

    await waitFor(() => {
      expect(mocks.loadPurchaseOnboarding).toHaveBeenCalledWith({
        data: { purchaseId: "pi_missing" },
      });
    });
    expect(screen.queryByLabelText(/Workspace name/)).not.toBeInTheDocument();
    expect(mocks.createWorkspace).not.toHaveBeenCalled();
  });

  it("allows Pro purchases to use the automatic personal workspace", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: {
          activeOrganization: {
            id: "org_personal",
            name: "My Workspace",
            workspaceType: "individual",
          },
        },
      },
    });
    mocks.ensurePurchaseOnboarding.mockResolvedValue({
      id: "pi_pro",
      interval: "monthly",
      product: "atlas_pro",
      status: "started",
      stripeCheckoutSessionId: null,
      userId: "user_123",
      workspaceId: null,
    });
    mocks.attachPurchaseWorkspace.mockResolvedValue({
      id: "pi_pro",
      interval: "monthly",
      product: "atlas_pro",
      status: "workspace_ready",
      stripeCheckoutSessionId: null,
      userId: "user_123",
      workspaceId: "org_personal",
    });

    render(<SetupPage product="atlas_pro" interval="monthly" />);

    const useWorkspaceButton = await screen.findByRole("button", { name: "Use My Workspace" });
    fireEvent.click(useWorkspaceButton);

    await waitFor(() => {
      expect(mocks.attachPurchaseWorkspace).toHaveBeenCalledWith({
        data: { purchaseId: "pi_pro", workspaceId: "org_personal" },
      });
    });
    expect(mocks.createWorkspace).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to sign up while keeping their plan", () => {
    mocks.useAtlasSession.mockReturnValue({ data: null });

    render(<SetupPage product="atlas_pro" interval="monthly" />);

    expect(screen.getByRole("heading", { name: "Start with your account" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create account" })).toHaveAttribute(
      "href",
      "/sign-up?redirect=%2Fonboarding%3Fproduct%3Datlas_pro%26interval%3Dmonthly",
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in?redirect=%2Fonboarding%3Fproduct%3Datlas_pro%26interval%3Dmonthly",
    );
    expect(mocks.ensurePurchaseOnboarding).not.toHaveBeenCalled();
  });

  it("says the purchase link is unavailable when the lookup fails", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: { activeOrganization: null },
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
        workspace: { activeOrganization: null },
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
        workspace: { activeOrganization: null },
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
        workspace: { activeOrganization: null },
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

  it("waits for the purchase intent before attaching or creating a workspace", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: {
          activeOrganization: { id: "org_personal", name: "My Workspace", workspaceType: "team" },
        },
      },
    });
    mocks.ensurePurchaseOnboarding.mockReturnValue(new Promise(() => undefined));

    render(<SetupPage product="atlas_team" interval="monthly" />);

    fireEvent.click(await screen.findByRole("button", { name: "Use My Workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to payment" }));

    expect(mocks.attachPurchaseWorkspace).not.toHaveBeenCalled();
    expect(mocks.createWorkspace).not.toHaveBeenCalled();
  });

  it("keeps the visitor on the workspace step when attaching fails", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: {
          activeOrganization: {
            id: "org_personal",
            name: "My Workspace",
            workspaceType: "individual",
          },
        },
      },
    });
    mocks.ensurePurchaseOnboarding.mockResolvedValue({ id: "pi_pro", workspaceId: null });
    mocks.attachPurchaseWorkspace.mockRejectedValue(new Error("ATLAS_API_REQUEST_FAILED"));

    render(<SetupPage product="atlas_pro" interval="monthly" />);

    fireEvent.click(await screen.findByRole("button", { name: "Use My Workspace" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Atlas could not attach that workspace. Try again.",
    );
    expect(screen.queryByText(/ATLAS_API/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Workspace name/)).toBeInTheDocument();
  });

  it("asks for another workspace name when creation fails", async () => {
    mocks.useAtlasSession.mockReturnValue({
      data: {
        accountReady: true,
        hasPasskey: true,
        workspace: { activeOrganization: null },
      },
    });
    mocks.ensurePurchaseOnboarding.mockResolvedValue({ id: "pi_pro", workspaceId: null });
    mocks.createWorkspace.mockRejectedValue(new Error("ATLAS_API_REQUEST_FAILED"));

    render(<SetupPage product="atlas_pro" interval="monthly" />);

    fireEvent.click(await screen.findByRole("button", { name: "Continue to payment" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Atlas could not create that workspace. Try another name.",
    );
    expect(mocks.createWorkspace).toHaveBeenCalledWith({
      data: {
        name: "Team Workspace",
        slug: "team-workspace",
        workspaceType: "individual",
      },
    });
    expect(mocks.attachPurchaseWorkspace).not.toHaveBeenCalled();
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
});
