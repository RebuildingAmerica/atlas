// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  createWorkspaceSession,
  personal,
  team,
} from "../../../fixtures/onboarding/workspace-sessions";
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

describe("workspace selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAtlasSession.mockReturnValue(createWorkspaceSession([]));
    mocks.ensurePurchaseOnboarding.mockResolvedValue({ id: "pi_123", workspaceId: null });
    mocks.loadPurchaseOnboarding.mockResolvedValue(null);
    mocks.attachPurchaseWorkspace.mockResolvedValue({ id: "pi_123", workspaceId: "org_selected" });
  });
  afterEach(cleanup);

  it("defaults to the current workspace and offers one action without a new-name form", async () => {
    mocks.useAtlasSession.mockReturnValue(createWorkspaceSession([personal]));
    render(<SetupPage product="atlas_pro" interval="monthly" />);
    expect(screen.getByRole("radio", { name: "My Workspace" })).toBeChecked();
    expect(screen.queryByLabelText(/Workspace name/)).not.toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Review plan" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => {
      expect(mocks.attachPurchaseWorkspace).toHaveBeenCalledWith({
        data: { purchaseId: "pi_123", workspaceId: personal.id },
      });
    });
    expect(mocks.createWorkspace).not.toHaveBeenCalled();
    expect(await screen.findByRole("heading", { name: "Review your plan" })).toHaveFocus();
  });

  it("offers all manageable workspaces and never a member-only workspace", async () => {
    mocks.useAtlasSession.mockReturnValue(
      createWorkspaceSession(
        [team, personal, { ...team, id: "member_only", name: "Other team", role: "member" }],
        personal,
      ),
    );
    render(<SetupPage product="atlas_pro" />);
    expect(screen.getByRole("radio", { name: "My Workspace" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "Other team" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Transit Coalition" }));
    const button = screen.getByRole("button", { name: "Review plan" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => {
      expect(mocks.attachPurchaseWorkspace).toHaveBeenCalledWith({
        data: { purchaseId: "pi_123", workspaceId: team.id },
      });
    });
  });

  it("only offers team workspaces for Atlas Team", () => {
    mocks.useAtlasSession.mockReturnValue(createWorkspaceSession([personal, team], personal));
    render(<SetupPage product="atlas_team" />);
    expect(screen.queryByRole("radio", { name: "My Workspace" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Transit Coalition" })).toBeChecked();
  });

  it("shows a blank name only for a new workspace and preserves it while switching", async () => {
    mocks.useAtlasSession.mockReturnValue(createWorkspaceSession([personal]));
    render(<SetupPage product="atlas_pro" />);
    fireEvent.click(screen.getByRole("radio", { name: "New workspace" }));
    const input = screen.getByLabelText(/Workspace name/);
    expect(input).toHaveValue("");
    expect(screen.getByRole("button", { name: "Review plan" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "Housing research" } });
    fireEvent.click(screen.getByRole("radio", { name: "My Workspace" }));
    expect(screen.queryByLabelText(/Workspace name/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "New workspace" }));
    expect(screen.getByLabelText(/Workspace name/)).toHaveValue("Housing research");
    mocks.createWorkspace.mockResolvedValue({ id: "org_new", slug: "housing-research" });
    const button = screen.getByRole("button", { name: "Review plan" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => {
      expect(mocks.createWorkspace).toHaveBeenCalledWith({
        data: { name: "Housing research", slug: "housing-research", workspaceType: "individual" },
      });
    });
    expect(mocks.attachPurchaseWorkspace).toHaveBeenCalledWith({
      data: { purchaseId: "pi_123", workspaceId: "org_new" },
    });
  });

  it("creates a named team workspace without a slug field or an unnecessary selector", async () => {
    render(<SetupPage product="atlas_team" />);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Workspace slug/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Workspace name/), {
      target: { value: "Rebuilding Las Vegas!" },
    });
    mocks.createWorkspace.mockResolvedValue({ id: "org_new" });
    const button = screen.getByRole("button", { name: "Review plan" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await waitFor(() => {
      expect(mocks.createWorkspace).toHaveBeenCalledWith({
        data: {
          name: "Rebuilding Las Vegas!",
          slug: "rebuilding-las-vegas",
          workspaceType: "team",
        },
      });
    });
  });

  it("disables selection and continuation until the purchase is available", () => {
    mocks.useAtlasSession.mockReturnValue(createWorkspaceSession([personal]));
    mocks.ensurePurchaseOnboarding.mockReturnValue(new Promise(() => undefined));
    render(<SetupPage product="atlas_pro" />);
    expect(screen.getByRole("radio", { name: "My Workspace" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Review plan" })).toBeDisabled();
    expect(mocks.attachPurchaseWorkspace).not.toHaveBeenCalled();
  });

  it("preserves the chosen workspace after attachment fails", async () => {
    mocks.useAtlasSession.mockReturnValue(createWorkspaceSession([personal]));
    mocks.attachPurchaseWorkspace.mockRejectedValue(new Error("ATLAS_API_REQUEST_FAILED"));
    render(<SetupPage product="atlas_pro" />);
    const button = screen.getByRole("button", { name: "Review plan" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The workspace could not be selected. Try again.",
    );
    expect(screen.getByRole("radio", { name: "My Workspace" })).toBeChecked();
    expect(button).toBeEnabled();
  });

  it("preserves the entered name after creation fails without blaming the name", async () => {
    mocks.createWorkspace.mockRejectedValue(new Error("ATLAS_API_REQUEST_FAILED"));
    render(<SetupPage product="atlas_pro" />);
    fireEvent.change(screen.getByLabelText(/Workspace name/), {
      target: { value: "Housing research" },
    });
    const button = screen.getByRole("button", { name: "Review plan" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The workspace could not be created. Try again.",
    );
    expect(screen.getByLabelText(/Workspace name/)).toHaveValue("Housing research");
    expect(mocks.attachPurchaseWorkspace).not.toHaveBeenCalled();
  });

  it("does not create a workspace when the purchase link cannot be loaded", async () => {
    render(<SetupPage purchase="pi_missing" />);
    await screen.findByRole("heading", { name: "Purchase unavailable" });
    expect(screen.queryByLabelText(/Workspace name/)).not.toBeInTheDocument();
    expect(mocks.createWorkspace).not.toHaveBeenCalled();
  });
});
