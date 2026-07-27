// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useOrganizationPageForms } from "@/domains/access/components/organization/use-organization-page-forms";
import type { AtlasOrganizationDetails } from "@rebuildingamerica/atlas-access/workspace/organization-contracts";
import type { WorkspaceDirectoryConfig } from "@/domains/workspace/server/directory-config";

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

  it("loads the saved public directory settings into their editors", () => {
    const { result } = renderHook(() =>
      useOrganizationPageForms({
        activeOrganizationId: "org_1",
        directoryConfig: {
          methodology: {
            correction_policy: "Email corrections@atlas.test.",
            review_policy: "Two reviewers per entry.",
            source_policy: "Public filings only.",
            summary: "How this directory is built.",
          },
          scope: {
            entry_types: ["person", "organization"],
            geography_labels: ["Dallas, TX", "Austin, TX"],
            issue_area_ids: ["housing", "transit"],
          },
          sponsor_label: "Rebuilding America",
          title: "Texas civic directory",
        } as unknown as WorkspaceDirectoryConfig,
        needsWorkspace: false,
        organization: null,
      }),
    );

    expect(result.current.directoryTitle).toBe("Texas civic directory");
    expect(result.current.directorySponsorLabel).toBe("Rebuilding America");
    expect(result.current.directoryIssueAreaIds).toBe("housing, transit");
    expect(result.current.directoryGeographyLabels).toBe("Dallas, TX; Austin, TX");
    expect(result.current.directoryEntryTypes).toBe("person, organization");
    expect(result.current.directoryMethodologySummary).toBe("How this directory is built.");
    expect(result.current.directorySourcePolicy).toBe("Public filings only.");
    expect(result.current.directoryReviewPolicy).toBe("Two reviewers per entry.");
    expect(result.current.directoryCorrectionPolicy).toBe("Email corrections@atlas.test.");
  });

  it("leaves the directory editors empty when nothing has been configured", () => {
    const { result } = renderHook(() =>
      useOrganizationPageForms({
        activeOrganizationId: "org_1",
        directoryConfig: {
          methodology: null,
          scope: null,
          sponsor_label: null,
          title: null,
        } as unknown as WorkspaceDirectoryConfig,
        needsWorkspace: false,
        organization: null,
      }),
    );

    expect(result.current.directoryTitle).toBe("");
    expect(result.current.directorySponsorLabel).toBe("");
    expect(result.current.directoryIssueAreaIds).toBe("");
    expect(result.current.directoryGeographyLabels).toBe("");
    expect(result.current.directoryEntryTypes).toBe("");
    expect(result.current.directoryMethodologySummary).toBe("");
    expect(result.current.directorySourcePolicy).toBe("");
    expect(result.current.directoryReviewPolicy).toBe("");
    expect(result.current.directoryCorrectionPolicy).toBe("");
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
