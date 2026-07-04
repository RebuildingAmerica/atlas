import { useEffect, useState } from "react";
import type { AtlasOrganizationDetails } from "@/domains/access/organization-contracts";
import type { WorkspaceDirectoryConfig } from "@/domains/workspace/server/directory-config";
import { buildWorkspaceSlugCandidate } from "./organization-page-helpers";
import type {
  WorkspaceOIDCSetupFormState,
  WorkspaceSAMLSetupFormState,
} from "./organization-page-controller";

/**
 * Form state and setters used by the organization-management page.
 */
export interface OrganizationPageForms {
  inviteEmail: string;
  inviteRole: "admin" | "member";
  directoryCorrectionPolicy: string;
  directoryEntryTypes: string;
  directoryGeographyLabels: string;
  directoryIssueAreaIds: string;
  directoryMethodologySummary: string;
  directoryReviewPolicy: string;
  directorySourcePolicy: string;
  directorySponsorLabel: string;
  directoryTitle: string;
  oidcSetupForm: WorkspaceOIDCSetupFormState;
  profileName: string;
  profileSlug: string;
  samlSetupForm: WorkspaceSAMLSetupFormState;
  selectedOrganizationId: string;
  setDirectoryCorrectionPolicy: (value: string) => void;
  setDirectoryEntryTypes: (value: string) => void;
  setDirectoryGeographyLabels: (value: string) => void;
  setDirectoryIssueAreaIds: (value: string) => void;
  setDirectoryMethodologySummary: (value: string) => void;
  setDirectoryReviewPolicy: (value: string) => void;
  setDirectorySourcePolicy: (value: string) => void;
  setDirectorySponsorLabel: (value: string) => void;
  setDirectoryTitle: (value: string) => void;
  setInviteEmail: (value: string) => void;
  setInviteRole: (value: "admin" | "member") => void;
  setOidcSetupForm: (
    updater: (current: WorkspaceOIDCSetupFormState) => WorkspaceOIDCSetupFormState,
  ) => void;
  setProfileName: (value: string) => void;
  setProfileSlug: (value: string) => void;
  setSamlSetupForm: (
    updater: (current: WorkspaceSAMLSetupFormState) => WorkspaceSAMLSetupFormState,
  ) => void;
  setSelectedOrganizationId: (value: string) => void;
  setWorkspaceDelegatedEmail: (value: string) => void;
  setWorkspaceDomain: (value: string) => void;
  setWorkspaceName: (value: string) => void;
  setWorkspaceSlug: (value: string) => void;
  setWorkspaceType: (value: "individual" | "team") => void;
  workspaceDelegatedEmail: string;
  workspaceDomain: string;
  workspaceName: string;
  workspaceSlug: string;
  workspaceType: "individual" | "team";
  onUpdateInviteRole: (value: string) => void;
  onUpdateWorkspaceName: (value: string) => void;
  onUpdateWorkspaceSlug: (value: string) => void;
  onUpdateWorkspaceType: (value: string) => void;
}

/**
 * Props used to synchronize the organization-page form state with current
 * query/session data.
 */
interface UseOrganizationPageFormsParams {
  activeOrganizationId: string | null | undefined;
  directoryConfig?: WorkspaceDirectoryConfig | undefined;
  needsWorkspace: boolean;
  organization: AtlasOrganizationDetails | null | undefined;
}

function joinDirectoryValues(values: string[] | undefined, separator = ", "): string {
  return values?.join(separator) ?? "";
}

/**
 * Local form state for the organization page.
 *
 * The page has several independent forms, so keeping them together in one
 * small hook makes the controller easier to read without hiding behavior.
 *
 * @param params - The current workspace/query values the forms depend on.
 * @param params.activeOrganizationId - The active workspace id.
 * @param params.needsWorkspace - Whether the user still needs a first workspace.
 * @param params.organization - The loaded organization details.
 */
export function useOrganizationPageForms(
  params: UseOrganizationPageFormsParams,
): OrganizationPageForms {
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(
    params.activeOrganizationId ?? "",
  );
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceSlug, setWorkspaceSlug] = useState("");
  const [workspaceType, setWorkspaceType] = useState<"individual" | "team">("team");
  const [workspaceDomain, setWorkspaceDomain] = useState("");
  const [workspaceDelegatedEmail, setWorkspaceDelegatedEmail] = useState("");
  const [isWorkspaceSlugManual, setIsWorkspaceSlugManual] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profileSlug, setProfileSlug] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [directoryTitle, setDirectoryTitle] = useState("");
  const [directorySponsorLabel, setDirectorySponsorLabel] = useState("");
  const [directoryIssueAreaIds, setDirectoryIssueAreaIds] = useState("");
  const [directoryGeographyLabels, setDirectoryGeographyLabels] = useState("");
  const [directoryEntryTypes, setDirectoryEntryTypes] = useState("");
  const [directoryMethodologySummary, setDirectoryMethodologySummary] = useState("");
  const [directorySourcePolicy, setDirectorySourcePolicy] = useState("");
  const [directoryReviewPolicy, setDirectoryReviewPolicy] = useState("");
  const [directoryCorrectionPolicy, setDirectoryCorrectionPolicy] = useState("");
  const [oidcSetupForm, setOidcSetupFormState] = useState<WorkspaceOIDCSetupFormState>({
    clientId: "",
    clientSecret: "",
    domain: "",
    providerId: "",
    setAsPrimary: false,
  });
  const [samlSetupForm, setSamlSetupFormState] = useState<WorkspaceSAMLSetupFormState>({
    certificate: "",
    domain: "",
    entryPoint: "",
    issuer: "",
    providerId: "",
    setAsPrimary: true,
  });

  useEffect(() => {
    setSelectedOrganizationId(params.activeOrganizationId ?? "");
  }, [params.activeOrganizationId]);

  useEffect(() => {
    if (!params.needsWorkspace) {
      return;
    }

    setWorkspaceType("team");
  }, [params.needsWorkspace]);

  useEffect(() => {
    if (!params.organization) {
      return;
    }

    const { setup } = params.organization.sso;

    setProfileName(params.organization.name);
    setProfileSlug(params.organization.slug);
    setOidcSetupFormState((current) => ({
      ...current,
      domain: current.domain || setup.workspaceDomainSuggestion,
      providerId: current.providerId || setup.oidcProviderIdSuggestion,
    }));
    setSamlSetupFormState((current) => ({
      ...current,
      domain: current.domain || setup.workspaceDomainSuggestion,
      providerId: current.providerId || setup.samlProviderIdSuggestion,
    }));
  }, [params.organization]);

  useEffect(() => {
    if (!params.directoryConfig) {
      return;
    }

    setDirectoryTitle(params.directoryConfig.title ?? "");
    setDirectorySponsorLabel(params.directoryConfig.sponsor_label ?? "");
    setDirectoryIssueAreaIds(joinDirectoryValues(params.directoryConfig.scope?.issue_area_ids));
    setDirectoryGeographyLabels(
      joinDirectoryValues(params.directoryConfig.scope?.geography_labels, "; "),
    );
    setDirectoryEntryTypes(joinDirectoryValues(params.directoryConfig.scope?.entry_types));
    setDirectoryMethodologySummary(params.directoryConfig.methodology?.summary ?? "");
    setDirectorySourcePolicy(params.directoryConfig.methodology?.source_policy ?? "");
    setDirectoryReviewPolicy(params.directoryConfig.methodology?.review_policy ?? "");
    setDirectoryCorrectionPolicy(params.directoryConfig.methodology?.correction_policy ?? "");
  }, [params.directoryConfig]);

  /**
   * Updates the workspace-name field and auto-generates a slug until the user
   * takes over the slug manually.
   *
   * @param value - The next workspace name value.
   */
  function handleWorkspaceNameChange(value: string) {
    setWorkspaceName(value);

    if (isWorkspaceSlugManual) {
      return;
    }

    const slugCandidate = buildWorkspaceSlugCandidate(value);

    setWorkspaceSlug(slugCandidate);
  }

  /**
   * Updates the workspace-slug field and marks it as manually controlled.
   *
   * @param value - The next workspace slug value.
   */
  function handleWorkspaceSlugChange(value: string) {
    setIsWorkspaceSlugManual(true);
    setWorkspaceSlug(value);
  }

  /**
   * Updates the workspace type selector when the value is supported.
   *
   * @param value - The raw select value.
   */
  function handleWorkspaceTypeChange(value: string) {
    if (value === "individual" || value === "team") {
      setWorkspaceType(value);
    }
  }

  /**
   * Updates the invitation-role selector when the value is supported.
   *
   * @param value - The raw select value.
   */
  function handleInviteRoleChange(value: string) {
    if (value === "admin" || value === "member") {
      setInviteRole(value);
    }
  }

  /**
   * Applies one updater function to the OIDC setup form.
   *
   * @param updater - The updater callback.
   */
  function setOidcSetupForm(
    updater: (current: WorkspaceOIDCSetupFormState) => WorkspaceOIDCSetupFormState,
  ) {
    setOidcSetupFormState(updater);
  }

  /**
   * Applies one updater function to the SAML setup form.
   *
   * @param updater - The updater callback.
   */
  function setSamlSetupForm(
    updater: (current: WorkspaceSAMLSetupFormState) => WorkspaceSAMLSetupFormState,
  ) {
    setSamlSetupFormState(updater);
  }

  return {
    directoryCorrectionPolicy,
    directoryEntryTypes,
    directoryGeographyLabels,
    directoryIssueAreaIds,
    directoryMethodologySummary,
    directoryReviewPolicy,
    directorySourcePolicy,
    directorySponsorLabel,
    directoryTitle,
    inviteEmail,
    inviteRole,
    oidcSetupForm,
    profileName,
    profileSlug,
    samlSetupForm,
    selectedOrganizationId,
    setDirectoryCorrectionPolicy,
    setDirectoryEntryTypes,
    setDirectoryGeographyLabels,
    setDirectoryIssueAreaIds,
    setDirectoryMethodologySummary,
    setDirectoryReviewPolicy,
    setDirectorySourcePolicy,
    setDirectorySponsorLabel,
    setDirectoryTitle,
    setInviteEmail,
    setInviteRole,
    setOidcSetupForm,
    setProfileName,
    setProfileSlug,
    setSamlSetupForm,
    setSelectedOrganizationId,
    setWorkspaceDelegatedEmail,
    setWorkspaceDomain,
    setWorkspaceName,
    setWorkspaceSlug,
    setWorkspaceType,
    workspaceDelegatedEmail,
    workspaceDomain,
    workspaceName,
    workspaceSlug,
    workspaceType,
    onUpdateInviteRole: handleInviteRoleChange,
    onUpdateWorkspaceName: handleWorkspaceNameChange,
    onUpdateWorkspaceSlug: handleWorkspaceSlugChange,
    onUpdateWorkspaceType: handleWorkspaceTypeChange,
  };
}
