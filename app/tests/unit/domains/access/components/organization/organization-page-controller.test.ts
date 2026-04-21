// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useOrganizationPageController } from "@/domains/access/components/organization/organization-page-controller";

const mocks = vi.hoisted(() => ({
  useOrganizationPageData: vi.fn(),
  useOrganizationPageForms: vi.fn(),
  useOrganizationPageSSOActions: vi.fn(),
  useOrganizationPageWorkspaceActions: vi.fn(),
}));

vi.mock("@/domains/access/components/organization/use-organization-page-data", () => ({
  useOrganizationPageData: mocks.useOrganizationPageData,
}));

vi.mock("@/domains/access/components/organization/use-organization-page-forms", () => ({
  useOrganizationPageForms: mocks.useOrganizationPageForms,
}));

vi.mock("@/domains/access/components/organization/use-organization-page-sso-actions", () => ({
  useOrganizationPageSSOActions: mocks.useOrganizationPageSSOActions,
}));

vi.mock("@/domains/access/components/organization/use-organization-page-workspace-actions", () => ({
  useOrganizationPageWorkspaceActions: mocks.useOrganizationPageWorkspaceActions,
}));

describe("useOrganizationPageController", () => {
  beforeEach(() => {
    mocks.useOrganizationPageData.mockReturnValue({
      activeWorkspace: { id: "org_1" },
      organization: { capabilities: { canManageOrganization: true, canUseTeamFeatures: true } },
    });
    mocks.useOrganizationPageForms.mockReturnValue({});
    mocks.useOrganizationPageSSOActions.mockReturnValue({});
    mocks.useOrganizationPageWorkspaceActions.mockReturnValue({});
  });

  it("composes the organization page view model", () => {
    const { result } = renderHook(() => useOrganizationPageController());
    expect(result.current.canManageOrganization).toBe(true);
    expect(result.current.canUseTeamFeatures).toBe(true);
    expect(mocks.useOrganizationPageData).toHaveBeenCalled();
  });

  it("handles missing organization data", () => {
    mocks.useOrganizationPageData.mockReturnValue({
      activeWorkspace: null,
      organization: null,
    });
    const { result } = renderHook(() => useOrganizationPageController());
    expect(result.current.canManageOrganization).toBe(false);
    expect(result.current.canUseTeamFeatures).toBe(false);
  });

  it("passes initialOrganization to data hook", () => {
    const initialOrg = { id: "org_init" } as unknown as NonNullable<
      Parameters<typeof useOrganizationPageController>[0]
    >["initialOrganization"];
    renderHook(() => useOrganizationPageController({ initialOrganization: initialOrg }));
    expect(mocks.useOrganizationPageData).toHaveBeenCalledWith(
      expect.objectContaining({
        initialOrganization: initialOrg,
      }),
    );
  });
});
