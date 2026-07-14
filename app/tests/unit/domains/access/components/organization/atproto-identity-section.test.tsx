// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attach: vi.fn(),
  detach: vi.fn(),
  getIdentity: vi.fn(),
  grant: vi.fn(),
  listDelegations: vi.fn(),
  provision: vi.fn(),
  revoke: vi.fn(),
  useAtprotoIdentities: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
  useQueryClient: mocks.useQueryClient,
}));

vi.mock("@/domains/access/atproto-identities", () => ({
  useAtprotoIdentities: mocks.useAtprotoIdentities,
  useProvisionManagedAtprotoIdentity: () => ({
    isPending: false,
    mutateAsync: mocks.provision,
  }),
}));

vi.mock("@/lib/generated/atlas/organization-identity/organization-identity", () => ({
  attachOrganizationAtprotoIdentity: mocks.attach,
  detachOrganizationAtprotoIdentity: mocks.detach,
  getOrganizationAtprotoIdentity: mocks.getIdentity,
  grantOrganizationAtprotoIdentityDelegation: mocks.grant,
  listOrganizationAtprotoIdentityDelegations: mocks.listDelegations,
  revokeOrganizationAtprotoIdentityDelegation: mocks.revoke,
}));

describe("OrganizationAtprotoIdentitySection", () => {
  beforeEach(() => {
    vi.resetModules();
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.useQueryClient.mockReturnValue({ invalidateQueries: mocks.invalidateQueries });
    mocks.useAtprotoIdentities.mockReturnValue({
      data: [
        {
          current_handle: "existing.example",
          did: "did:plc:existing",
          id: "identity-existing",
          pds_url: "https://pds.example",
        },
      ],
      isError: false,
      isPending: false,
    });
    mocks.useQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey.at(-1) === "identity") {
        return { data: null, isError: false, isPending: false };
      }
      return { data: [], isError: false, isPending: false };
    });
    mocks.useMutation.mockImplementation(
      (options: {
        mutationFn: (...args: never[]) => Promise<unknown>;
        onError?: () => void;
        onSuccess?: (...args: unknown[]) => void | Promise<void>;
      }) => ({
        isPending: false,
        mutate: (...args: never[]) => {
          void options
            .mutationFn(...args)
            .then((result) => options.onSuccess?.(result, ...args))
            .catch(() => options.onError?.());
        },
      }),
    );
    mocks.attach.mockResolvedValue({
      id: "organization-identity-1",
      identity_id: "identity-existing",
    });
  });

  it("defaults to creating and using an Atlas-managed identity while retaining the existing path", async () => {
    const members = [
      {
        createdAt: "2026-07-01T00:00:00.000Z",
        email: "owner@atlas.test",
        id: "membership-owner",
        image: null,
        name: "Owner",
        role: "owner",
        userId: "owner-1",
      },
      {
        createdAt: "2026-07-01T00:00:00.000Z",
        email: "delegate@atlas.test",
        id: "membership-delegate",
        image: null,
        name: "Delegate",
        role: "member",
        userId: "delegate-1",
      },
    ];
    mocks.provision.mockResolvedValue({
      current_handle: "organization.atlas.test",
      did: "did:plc:managed",
      id: "identity-managed",
      pds_url: "https://pds.atlas.test",
    });
    const { OrganizationAtprotoIdentitySection } =
      await import("@/domains/access/components/organization/atproto-identity-section");

    render(
      <OrganizationAtprotoIdentitySection
        canManageOrganization
        currentUserId="owner-1"
        members={members}
        organizationId="org-1"
      />,
    );

    expect(screen.getByRole("heading", { name: "Organization identity" })).not.toBeNull();
    expect(screen.getByText("Use an Atlas identity")).not.toBeNull();
    expect(screen.getByText("Use an existing controlled identity")).not.toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "New Atlas handle" }), {
      target: { value: "organization.atlas.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create and use Atlas identity" }));

    await waitFor(() => {
      expect(mocks.provision).toHaveBeenCalledWith("organization.atlas.test");
      expect(mocks.attach).toHaveBeenCalledWith("org-1", {
        identity_id: "identity-managed",
      });
    });
  });

  it("offers delegated administration and confirms a completed revocation", async () => {
    const members = [
      {
        createdAt: "2026-07-01T00:00:00.000Z",
        email: "owner@atlas.test",
        id: "membership-owner",
        image: null,
        name: "Owner",
        role: "owner",
        userId: "owner-1",
      },
      {
        createdAt: "2026-07-01T00:00:00.000Z",
        email: "delegate@atlas.test",
        id: "membership-delegate",
        image: null,
        name: "Delegate",
        role: "member",
        userId: "delegate-1",
      },
    ];
    mocks.useQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey.at(-1) === "identity") {
        return {
          data: { id: "organization-identity-1", identity_id: "identity-existing" },
          isError: false,
          isPending: false,
        };
      }
      return {
        data: [
          {
            delegate_user_id: "delegate-1",
            id: "delegation-1",
            identity_id: "identity-existing",
          },
        ],
        isError: false,
        isPending: false,
      };
    });
    mocks.revoke.mockResolvedValue({
      delegate_user_id: "delegate-1",
      status: "revoked",
    });
    const { OrganizationAtprotoIdentitySection } =
      await import("@/domains/access/components/organization/atproto-identity-section");

    render(
      <OrganizationAtprotoIdentitySection
        canManageOrganization
        currentUserId="owner-1"
        members={members}
        organizationId="org-1"
      />,
    );

    expect(screen.getByRole("combobox", { name: "Delegate member" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revoke Delegate" }));

    await waitFor(() => {
      expect(mocks.revoke).toHaveBeenCalledWith("org-1", "identity-existing", "delegate-1");
      expect(screen.getByText("Delegated administration revoked for Delegate.")).not.toBeNull();
    });
  });

  it("lets an active delegate remove the organization identity", async () => {
    const members = [
      {
        createdAt: "2026-07-01T00:00:00.000Z",
        email: "owner@atlas.test",
        id: "membership-owner",
        image: null,
        name: "Owner",
        role: "owner",
        userId: "owner-1",
      },
      {
        createdAt: "2026-07-01T00:00:00.000Z",
        email: "delegate@atlas.test",
        id: "membership-delegate",
        image: null,
        name: "Delegate",
        role: "member",
        userId: "delegate-1",
      },
    ];
    mocks.useQuery.mockImplementation(({ queryKey }: { queryKey: string[] }) => {
      if (queryKey.at(-1) === "identity") {
        return {
          data: { id: "organization-identity-1", identity_id: "identity-existing" },
          isError: false,
          isPending: false,
        };
      }
      return {
        data: [
          {
            delegate_user_id: "delegate-1",
            id: "delegation-1",
            identity_id: "identity-existing",
          },
        ],
        isError: false,
        isPending: false,
      };
    });
    mocks.detach.mockResolvedValue({
      detached_by: "delegate-1",
      identity_id: "identity-existing",
      status: "removed",
    });
    const { OrganizationAtprotoIdentitySection } =
      await import("@/domains/access/components/organization/atproto-identity-section");

    render(
      <OrganizationAtprotoIdentitySection
        canManageOrganization={false}
        currentUserId="delegate-1"
        members={members}
        organizationId="org-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove organization identity" }));

    await waitFor(() => {
      expect(mocks.detach).toHaveBeenCalledWith("org-1", "identity-existing");
      expect(screen.getByText("Organization identity removed.")).not.toBeNull();
    });
  });
});
