// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { WorkspaceMembershipSection } from "@/domains/access/components/organization/workspace-membership-section";
import { ConfirmDialogProvider } from "@rebuildingamerica/atlas-ui/ui/confirm-dialog";

describe("WorkspaceMembershipSection", () => {
  type MembershipOrganization = Parameters<typeof WorkspaceMembershipSection>[0]["organization"];

  const organization = {
    id: "org_1",
    name: "Atlas",
    slug: "atlas",
    workspaceType: "team",
    role: "member",
    members: [{ role: "member" }],
    capabilities: { canUseTeamFeatures: true },
  };

  const defaultProps = {
    isPending: false,
    onLeave: vi.fn(),
    organization: organization as unknown as MembershipOrganization,
  };

  function renderMembership(
    props: Parameters<typeof WorkspaceMembershipSection>[0] = defaultProps,
  ) {
    return render(<WorkspaceMembershipSection {...props} />, { wrapper: ConfirmDialogProvider });
  }

  afterEach(() => {
    cleanup();
  });

  it("renders the membership info", () => {
    renderMembership();
    expect(screen.getByText("Atlas")).toBeInTheDocument();
    expect(screen.getByText(/Role: member/i)).toBeInTheDocument();
  });

  it("reviews the loss of shared access before leaving", async () => {
    const onLeave = vi.fn();
    renderMembership({ ...defaultProps, onLeave });
    expect(screen.getByText(/Leave this workspace/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Leave workspace" }));
    expect(onLeave).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent("lose access to shared work");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onLeave).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Leave workspace" }));
    fireEvent.click(screen.getByRole("button", { name: "Leave this workspace" }));
    await waitFor(() => {
      expect(onLeave).toHaveBeenCalledOnce();
    });
  });

  it("blocks owners from leaving the workspace", () => {
    const ownerOrg = { ...organization, role: "owner" };
    renderMembership({
      ...defaultProps,
      organization: ownerOrg as unknown as MembershipOrganization,
    });

    expect(screen.getByText(/Another owner is needed/i)).toBeInTheDocument();
    expect(screen.queryByText(/Leave workspace/i)).not.toBeInTheDocument();
  });

  it("lets an owner leave after another owner has accepted ownership", () => {
    const ownerOrg = {
      ...organization,
      role: "owner",
      members: [{ role: "owner" }, { role: "owner" }],
    };
    renderMembership({
      ...defaultProps,
      organization: ownerOrg as unknown as MembershipOrganization,
    });

    expect(screen.getByRole("button", { name: "Leave workspace" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Leave workspace" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "does not cancel its subscription or change its billing contact",
    );
  });

  it("shows leaving state when pending", () => {
    renderMembership({ ...defaultProps, isPending: true });
    expect(screen.getByText(/Leaving.../i)).toBeDisabled();
  });
});
