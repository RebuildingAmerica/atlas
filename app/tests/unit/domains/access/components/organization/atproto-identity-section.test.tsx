// @vitest-environment jsdom

import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ReactQuery from "@tanstack/react-query";
import type { AtprotoIdentityResponse } from "@rebuildingamerica/atlas-api-client/generated/atlas-schemas";
import type * as AtprotoIdentities from "@/domains/access/atproto-identities";
import { OrganizationAtprotoIdentitySection } from "@/domains/access/components/organization/atproto-identity-section";
import { renderWithProviders } from "../../../../../helpers/render-with-providers";
import {
  createAccountIdentity,
  createIdentityDelegation,
  createIdentityWorkspaceMembers,
  createOrganizationIdentity,
  stubOrganizationIdentityApi,
} from "./atproto-identity-section-test-support";

const mocks = vi.hoisted(() => ({
  provisionManagedIdentity: vi.fn<(handle: string) => Promise<AtprotoIdentityResponse>>(),
}));

vi.mock("@/domains/access/atproto-identities", async () => {
  const actual = await vi.importActual<typeof AtprotoIdentities>(
    "@/domains/access/atproto-identities",
  );
  const { useMutation } = await vi.importActual<typeof ReactQuery>("@tanstack/react-query");

  return {
    ...actual,
    useProvisionManagedAtprotoIdentity: () =>
      useMutation({
        mutationFn: (handle: string) => mocks.provisionManagedIdentity(handle),
      }),
  };
});

describe("OrganizationAtprotoIdentitySection", () => {
  beforeEach(() => {
    mocks.provisionManagedIdentity.mockResolvedValue(
      createAccountIdentity({
        current_handle: "organization.atlas.test",
        did: "did:plc:managed",
        id: "identity-managed",
        pds_url: "https://pds.atlas.test",
      }),
    );
  });

  it("creates an Atlas-managed identity and puts it to work for the workspace", async () => {
    const api = stubOrganizationIdentityApi();

    renderWithProviders(
      <OrganizationAtprotoIdentitySection
        canManageOrganization
        currentUserId="owner-1"
        members={createIdentityWorkspaceMembers()}
        organizationId="org-1"
      />,
    );

    expect(screen.getByRole("heading", { name: "Organization identity" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Choose the DID Atlas presents for this workspace without moving account-level control.",
      ),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "New Atlas handle" }), {
      target: { value: "organization.atlas.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create and use Atlas identity" }));

    expect(await screen.findByText("Organization identity updated.")).toBeInTheDocument();
    expect(mocks.provisionManagedIdentity).toHaveBeenCalledWith("organization.atlas.test");
    const attachRequest = api.requests.find((request) => request.init?.method === "POST");
    expect(attachRequest?.url).toContain("/api/orgs/org-1/atproto-identities");
    expect(attachRequest?.init?.body).toBe(JSON.stringify({ identity_id: "identity-managed" }));
  });

  it("explains a handle the Atlas PDS will not take", async () => {
    stubOrganizationIdentityApi();
    mocks.provisionManagedIdentity.mockRejectedValue(new Error("handle taken"));

    renderWithProviders(
      <OrganizationAtprotoIdentitySection
        canManageOrganization
        currentUserId="owner-1"
        members={createIdentityWorkspaceMembers()}
        organizationId="org-1"
      />,
    );

    fireEvent.change(screen.getByRole("textbox", { name: "New Atlas handle" }), {
      target: { value: "taken.atlas.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create and use Atlas identity" }));

    expect(
      await screen.findByText("Atlas could not create that identity. Try a different handle."),
    ).toBeInTheDocument();
  });

  it("attaches whichever controlled identity the admin picks", async () => {
    const api = stubOrganizationIdentityApi({
      accountIdentities: {
        body: [
          createAccountIdentity(),
          createAccountIdentity({
            current_handle: "second.example",
            did: "did:plc:second",
            id: "identity-second",
          }),
        ],
      },
    });

    renderWithProviders(
      <OrganizationAtprotoIdentitySection
        canManageOrganization
        currentUserId="owner-1"
        members={createIdentityWorkspaceMembers()}
        organizationId="org-1"
      />,
    );

    const picker = await screen.findByRole("combobox", { name: "Existing controlled identity" });
    await waitFor(() => {
      expect(picker).toHaveValue("identity-existing");
    });

    fireEvent.change(picker, { target: { value: "identity-second" } });
    fireEvent.click(screen.getByRole("button", { name: "Use selected identity" }));

    expect(await screen.findByText("Organization identity updated.")).toBeInTheDocument();
    const attachRequest = api.requests.find((request) => request.init?.method === "POST");
    expect(attachRequest?.init?.body).toBe(JSON.stringify({ identity_id: "identity-second" }));
  });

  it("explains an identity the workspace is not allowed to use", async () => {
    stubOrganizationIdentityApi({
      accountIdentities: { body: [createAccountIdentity()] },
      attach: { body: { detail: "forbidden" }, status: 403 },
    });

    renderWithProviders(
      <OrganizationAtprotoIdentitySection
        canManageOrganization
        currentUserId="owner-1"
        members={createIdentityWorkspaceMembers()}
        organizationId="org-1"
      />,
    );

    const picker = await screen.findByRole("combobox", { name: "Existing controlled identity" });
    await waitFor(() => {
      expect(picker).toHaveValue("identity-existing");
    });
    fireEvent.click(screen.getByRole("button", { name: "Use selected identity" }));

    expect(
      await screen.findByText("Atlas could not use that identity for this organization."),
    ).toBeInTheDocument();
  });

  it("offers nothing to attach when the account controls no identities", async () => {
    stubOrganizationIdentityApi();

    renderWithProviders(
      <OrganizationAtprotoIdentitySection
        canManageOrganization
        currentUserId="owner-1"
        members={createIdentityWorkspaceMembers()}
        organizationId="org-1"
      />,
    );

    expect(await screen.findByText("No identities available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use selected identity" })).toBeDisabled();
  });

  it("says so when the account's controlled identities cannot be loaded", async () => {
    stubOrganizationIdentityApi({
      accountIdentities: { body: { detail: "boom" }, status: 500 },
    });

    renderWithProviders(
      <OrganizationAtprotoIdentitySection
        canManageOrganization
        currentUserId="owner-1"
        members={createIdentityWorkspaceMembers()}
        organizationId="org-1"
      />,
    );

    expect(
      await screen.findByText("Atlas could not load your controlled identities."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Existing controlled identity" })).toBeNull();
  });

  it("says so when the workspace's own identity cannot be loaded", async () => {
    stubOrganizationIdentityApi({
      organizationIdentity: { body: { detail: "boom" }, status: 500 },
    });

    renderWithProviders(
      <OrganizationAtprotoIdentitySection
        canManageOrganization
        currentUserId="owner-1"
        members={createIdentityWorkspaceMembers()}
        organizationId="org-1"
      />,
    );

    expect(
      await screen.findByText("Atlas could not load this organization identity."),
    ).toBeInTheDocument();
  });

  it("shows the active identity by handle and grants a member delegated administration", async () => {
    const api = stubOrganizationIdentityApi({
      accountIdentities: { body: [createAccountIdentity()] },
      organizationIdentity: { body: createOrganizationIdentity() },
    });

    renderWithProviders(
      <OrganizationAtprotoIdentitySection
        canManageOrganization
        currentUserId="owner-1"
        members={createIdentityWorkspaceMembers()}
        organizationId="org-1"
      />,
    );

    const activeIdentityBlock = (await screen.findByText("Active organization identity"))
      .parentElement;
    if (!activeIdentityBlock) throw new Error("Expected the active-identity block to render");
    expect(within(activeIdentityBlock).getByText("existing.example")).toBeInTheDocument();
    expect(await screen.findByText("No delegated administrators yet.")).toBeInTheDocument();

    const grantButton = screen.getByRole("button", { name: "Grant administration" });
    expect(grantButton).toBeDisabled();

    fireEvent.change(screen.getByRole("combobox", { name: "Delegate member" }), {
      target: { value: "delegate-1" },
    });
    fireEvent.click(grantButton);

    expect(await screen.findByText("Delegated administration granted.")).toBeInTheDocument();
    const grantRequest = api.requests.find(
      (request) =>
        request.init?.method === "POST" &&
        request.url.endsWith("/atproto-identities/identity-existing/delegations"),
    );
    expect(grantRequest?.init?.body).toBe(JSON.stringify({ delegate_user_id: "delegate-1" }));
  });

  it("falls back to the raw identity id when the handle is not in the account's list", async () => {
    stubOrganizationIdentityApi({
      organizationIdentity: { body: createOrganizationIdentity() },
    });

    renderWithProviders(
      <OrganizationAtprotoIdentitySection
        canManageOrganization
        currentUserId="owner-1"
        members={createIdentityWorkspaceMembers()}
        organizationId="org-1"
      />,
    );

    expect(await screen.findByText("identity-existing")).toBeInTheDocument();
  });

  it("explains a delegation grant the API refuses", async () => {
    stubOrganizationIdentityApi({
      grant: { body: { detail: "forbidden" }, status: 403 },
      organizationIdentity: { body: createOrganizationIdentity() },
    });

    renderWithProviders(
      <OrganizationAtprotoIdentitySection
        canManageOrganization
        currentUserId="owner-1"
        members={createIdentityWorkspaceMembers()}
        organizationId="org-1"
      />,
    );

    fireEvent.change(await screen.findByRole("combobox", { name: "Delegate member" }), {
      target: { value: "delegate-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Grant administration" }));

    expect(
      await screen.findByText("Atlas could not grant delegated administration."),
    ).toBeInTheDocument();
  });

  it("confirms a revocation by naming the member who lost the delegation", async () => {
    stubOrganizationIdentityApi({
      delegations: { body: [createIdentityDelegation()] },
      organizationIdentity: { body: createOrganizationIdentity() },
    });

    renderWithProviders(
      <OrganizationAtprotoIdentitySection
        canManageOrganization
        currentUserId="owner-1"
        members={createIdentityWorkspaceMembers()}
        organizationId="org-1"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Revoke Delegate" }));

    expect(
      await screen.findByText("Delegated administration revoked for Delegate."),
    ).toBeInTheDocument();
  });

  it("still names a delegation held by someone who has left the workspace", async () => {
    stubOrganizationIdentityApi({
      delegations: {
        body: [createIdentityDelegation({ delegate_user_id: "departed-1", id: "delegation-2" })],
      },
      organizationIdentity: { body: createOrganizationIdentity() },
    });

    renderWithProviders(
      <OrganizationAtprotoIdentitySection
        canManageOrganization
        currentUserId="owner-1"
        members={createIdentityWorkspaceMembers()}
        organizationId="org-1"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Revoke departed-1" }));

    expect(
      await screen.findByText("Delegated administration revoked for that member."),
    ).toBeInTheDocument();
  });

  it("explains a revocation the API refuses", async () => {
    stubOrganizationIdentityApi({
      delegations: { body: [createIdentityDelegation()] },
      organizationIdentity: { body: createOrganizationIdentity() },
      revoke: { body: { detail: "forbidden" }, status: 403 },
    });

    renderWithProviders(
      <OrganizationAtprotoIdentitySection
        canManageOrganization
        currentUserId="owner-1"
        members={createIdentityWorkspaceMembers()}
        organizationId="org-1"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Revoke Delegate" }));

    expect(
      await screen.findByText("Atlas could not revoke delegated administration."),
    ).toBeInTheDocument();
  });

  it("lets an active delegate remove the organization identity and then stands down", async () => {
    let identityAttached = true;
    stubOrganizationIdentityApi({
      delegations: () => ({ body: identityAttached ? [createIdentityDelegation()] : [] }),
      detach: () => {
        identityAttached = false;
        return { status: 204 };
      },
      organizationIdentity: () => ({
        body: identityAttached ? createOrganizationIdentity() : null,
      }),
    });

    renderWithProviders(
      <OrganizationAtprotoIdentitySection
        canManageOrganization={false}
        currentUserId="delegate-1"
        members={createIdentityWorkspaceMembers()}
        organizationId="org-1"
      />,
    );

    expect(
      await screen.findByText("An organization identity is currently set."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Use an Atlas identity")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Remove organization identity" }));

    expect(await screen.findByText("Organization identity removed.")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Organization identity" })).toBeNull();
    });
    expect(screen.getByText("Organization identity removed.")).toBeInTheDocument();
  });

  it("explains a removal the API refuses to a delegate whose access may be gone", async () => {
    stubOrganizationIdentityApi({
      delegations: { body: [createIdentityDelegation()] },
      detach: { body: { detail: "forbidden" }, status: 403 },
      organizationIdentity: { body: createOrganizationIdentity() },
    });

    renderWithProviders(
      <OrganizationAtprotoIdentitySection
        canManageOrganization={false}
        currentUserId="delegate-1"
        members={createIdentityWorkspaceMembers()}
        organizationId="org-1"
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Remove organization identity" }));

    expect(
      await screen.findByText(
        "Atlas could not remove this identity. Your delegated access may have been revoked.",
      ),
    ).toBeInTheDocument();
  });

  it("shows nothing at all to a member with no delegated authority", async () => {
    stubOrganizationIdentityApi({
      organizationIdentity: { body: createOrganizationIdentity() },
    });

    const { container } = renderWithProviders(
      <OrganizationAtprotoIdentitySection
        canManageOrganization={false}
        currentUserId="outsider-1"
        members={createIdentityWorkspaceMembers()}
        organizationId="org-1"
      />,
    );

    await waitFor(() => {
      expect(container.querySelector("section")).toBeNull();
    });
  });
});
