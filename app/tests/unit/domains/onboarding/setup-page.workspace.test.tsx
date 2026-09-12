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

    // Disabled, not merely inert: both handlers need a purchase id.
    const useWorkspace = await screen.findByRole("button", { name: "Use My Workspace" });
    expect(useWorkspace).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue to payment" })).toBeDisabled();

    fireEvent.click(useWorkspace);
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
});
