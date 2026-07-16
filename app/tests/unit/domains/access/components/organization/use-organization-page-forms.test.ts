// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOrganizationPageForms } from "@/domains/access/components/organization/use-organization-page-forms";
import type { AtlasOrganizationDetails } from "@rebuildingamerica/atlas-access/workspace/organization-contracts";

describe("useOrganizationPageForms", () => {
  const organization = {
    name: "Atlas Team",
    slug: "atlas-team",
    sso: {
      setup: {
        workspaceDomainSuggestion: "atlas.test",
        oidcProviderIdSuggestion: "google",
        samlProviderIdSuggestion: "saml",
      },
    },
  };

  it("synchronizes with active organization id", () => {
    const { result, rerender } = renderHook(
      ({ activeOrganizationId }) =>
        useOrganizationPageForms({
          activeOrganizationId,
          needsWorkspace: false,
          organization: null,
        }),
      { initialProps: { activeOrganizationId: "org_1" } },
    );
    expect(result.current.selectedOrganizationId).toBe("org_1");

    rerender({ activeOrganizationId: "org_2" });
    expect(result.current.selectedOrganizationId).toBe("org_2");
  });

  it("synchronizes with organization details", () => {
    const { result } = renderHook(() =>
      useOrganizationPageForms({
        activeOrganizationId: "org_1",
        needsWorkspace: false,
        organization: organization as unknown as AtlasOrganizationDetails,
      }),
    );
    expect(result.current.profileName).toBe("Atlas Team");
    expect(result.current.profileSlug).toBe("atlas-team");
    expect(result.current.oidcSetupForm.domain).toBe("atlas.test");
  });

  it("auto-generates workspace slug from name", () => {
    const { result } = renderHook(() =>
      useOrganizationPageForms({
        activeOrganizationId: null,
        needsWorkspace: true,
        organization: null,
      }),
    );

    act(() => {
      result.current.onUpdateWorkspaceName("New Workspace");
    });
    expect(result.current.workspaceName).toBe("New Workspace");
    expect(result.current.workspaceSlug).toBe("new-workspace");

    act(() => {
      result.current.onUpdateWorkspaceSlug("manual-slug");
    });
    act(() => {
      result.current.onUpdateWorkspaceName("Another Change");
    });
    expect(result.current.workspaceSlug).toBe("manual-slug");
  });

  it("updates workspace type and invite role", () => {
    const { result } = renderHook(() =>
      useOrganizationPageForms({
        activeOrganizationId: null,
        needsWorkspace: false,
        organization: null,
      }),
    );

    act(() => {
      result.current.onUpdateWorkspaceType("individual");
    });
    expect(result.current.workspaceType).toBe("individual");

    act(() => {
      result.current.onUpdateInviteRole("admin");
    });
    expect(result.current.inviteRole).toBe("admin");
  });

  it("updates complex form states", () => {
    const { result } = renderHook(() =>
      useOrganizationPageForms({
        activeOrganizationId: null,
        needsWorkspace: false,
        organization: null,
      }),
    );

    act(() => {
      result.current.setOidcSetupForm((curr) => ({ ...curr, clientId: "test-client" }));
    });
    expect(result.current.oidcSetupForm.clientId).toBe("test-client");

    act(() => {
      result.current.setSamlSetupForm((curr) => ({ ...curr, certificate: "PEM" }));
    });
    expect(result.current.samlSetupForm.certificate).toBe("PEM");
  });

  it("ignores unsupported workspace type and invite role values", () => {
    const { result } = renderHook(() =>
      useOrganizationPageForms({
        activeOrganizationId: null,
        needsWorkspace: false,
        organization: null,
      }),
    );

    act(() => {
      result.current.onUpdateWorkspaceType("nonsense");
    });
    expect(result.current.workspaceType).toBe("team");

    act(() => {
      result.current.onUpdateInviteRole("nonsense");
    });
    expect(result.current.inviteRole).toBe("member");
  });

  it("seeds the workspace type to team when needsWorkspace flips on", () => {
    const { result, rerender } = renderHook(
      ({ needsWorkspace }) =>
        useOrganizationPageForms({
          activeOrganizationId: null,
          needsWorkspace,
          organization: null,
        }),
      { initialProps: { needsWorkspace: false } },
    );

    act(() => {
      result.current.setWorkspaceType("individual");
    });
    expect(result.current.workspaceType).toBe("individual");

    rerender({ needsWorkspace: true });
    expect(result.current.workspaceType).toBe("team");
  });

  it("preserves operator-edited form values when organization details refresh", () => {
    const { result, rerender } = renderHook(
      ({ organization }) =>
        useOrganizationPageForms({
          activeOrganizationId: "org_1",
          needsWorkspace: false,
          organization,
        }),
      {
        initialProps: {
          organization: organization as unknown as AtlasOrganizationDetails,
        },
      },
    );

    act(() => {
      result.current.setOidcSetupForm((curr) => ({ ...curr, domain: "operator-typed.com" }));
    });

    rerender({
      organization: {
        ...organization,
        sso: {
          setup: {
            workspaceDomainSuggestion: "another.test",
            oidcProviderIdSuggestion: "another-google",
            samlProviderIdSuggestion: "another-saml",
          },
        },
      } as unknown as AtlasOrganizationDetails,
    });

    expect(result.current.oidcSetupForm.domain).toBe("operator-typed.com");
  });
});
