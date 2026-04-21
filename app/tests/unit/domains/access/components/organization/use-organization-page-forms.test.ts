// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOrganizationPageForms } from "@/domains/access/components/organization/use-organization-page-forms";
import type { AtlasOrganizationDetails } from "@/domains/access/organization-contracts";

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
  });
});
